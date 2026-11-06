// In-memory Airtable REST API for tests. It behaves like the real API where the app
// depends on it: linked records are arrays of record-ID strings, list results page
// with an opaque offset, writes are limited to 10 records, unknown and computed
// fields are rejected with 422, select values must match a choice, and formula
// fields are recomputed on every read.
import { createServer } from "node:http";

const COMPUTED = new Set(["formula", "rollup", "multipleLookupValues", "count", "autoNumber", "createdTime", "lastModifiedTime"]);

export function createMockAirtable({ baseId = "appMock", tables: tableDefs, rows = {}, computed = {}, pageSize = 100 }) {
  const tableIds = new Map(tableDefs.map((table, index) => [table.name, `tbl${String(index + 1).padStart(3, "0")}`]));
  const schema = tableDefs.map((table) => ({
    id: tableIds.get(table.name),
    name: table.name,
    primaryFieldId: `fld${tableIds.get(table.name)}0`,
    fields: table.fields.map((field, index) => ({
      id: `fld${tableIds.get(table.name)}${index}`,
      name: field.name,
      type: field.type,
      options: {
        ...(field.link ? { linkedTableId: tableIds.get(field.link) } : {}),
        ...(field.choices ? { choices: field.choices.map((name) => ({ name })) } : {})
      }
    }))
  }));
  const data = new Map(tableDefs.map((table) => [table.name, []]));
  let clock = Date.parse("2026-11-01T00:00:00Z");
  let counter = 0;
  const nextCreatedTime = () => new Date(clock += 1000).toISOString();
  const nextId = () => `recMock${String(++counter).padStart(7, "0")}`;
  for (const [name, records] of Object.entries(rows)) {
    data.set(name, records.map((record) => ({ id: record.id || nextId(), createdTime: nextCreatedTime(), fields: structuredClone(record.fields || {}) })));
  }

  const requests = [];
  const writes = [];
  let failures = [];
  const resolveTable = (key) => {
    const name = tableIds.has(key) ? key : [...tableIds].find(([, id]) => id === key)?.[0];
    return name ? { name, schema: schema.find((table) => table.name === name) } : null;
  };
  const withComputed = (tableName, record) => {
    const fields = { ...record.fields, ...(computed[tableName]?.(record.fields, { get: (table, id) => data.get(table).find((item) => item.id === id) }) || {}) };
    for (const [key, value] of Object.entries(fields)) if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) delete fields[key];
    return { id: record.id, createdTime: record.createdTime, fields };
  };
  function validate(table, fields) {
    for (const [name, value] of Object.entries(fields)) {
      const field = table.schema.fields.find((item) => item.name === name);
      if (!field) return { type: "UNKNOWN_FIELD_NAME", message: `Unknown field name: "${name}"` };
      if (COMPUTED.has(field.type)) return { type: "INVALID_VALUE_FOR_COLUMN", message: `Field "${name}" cannot accept a value because the field is computed` };
      if (field.type === "multipleRecordLinks" && value !== null && (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id.startsWith("rec")))) {
        return { type: "INVALID_VALUE_FOR_COLUMN", message: `Field "${name}" expects an array of record IDs` };
      }
      if (field.type === "singleSelect" && value !== null && !field.options.choices.some((choice) => choice.name === value)) {
        return { type: "INVALID_MULTIPLE_CHOICE_OPTIONS", message: `Insufficient permissions to create new select option "${value}"` };
      }
    }
    return null;
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const json = (status, body) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    requests.push({ method: request.method, path: url.pathname });
    if (request.headers.authorization !== "Bearer test-token") return json(401, { error: { type: "AUTHENTICATION_REQUIRED" } });
    if (failures.length) {
      const status = failures.shift();
      return json(status, { errors: [{ error: status === 429 ? "RATE_LIMIT_REACHED" : "SERVER_ERROR" }] });
    }
    if (url.pathname === `/v0/meta/bases/${baseId}/tables`) return json(200, { tables: schema });
    const [, version, base, tableKey, recordId] = url.pathname.split("/").map(decodeURIComponent);
    const table = resolveTable(tableKey);
    if (version !== "v0" || base !== baseId || !table) return json(404, { error: { type: "NOT_FOUND" } });
    const records = data.get(table.name);
    let body = {};
    if (["POST", "PATCH"].includes(request.method)) {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      body = JSON.parse(raw || "{}");
      if (!Array.isArray(body.records) || body.records.length > 10) {
        return json(422, { error: { type: "INVALID_RECORDS", message: "You can write at most 10 records per request" } });
      }
      for (const item of body.records) {
        const problem = validate(table, item.fields || {});
        if (problem) return json(422, { error: problem });
      }
    }
    if (request.method === "GET" && recordId) {
      const record = records.find((item) => item.id === recordId);
      return record ? json(200, withComputed(table.name, record)) : json(404, { error: { type: "NOT_FOUND" } });
    }
    if (request.method === "GET") {
      const size = Math.min(Number(url.searchParams.get("pageSize") || pageSize), pageSize);
      const start = Number(url.searchParams.get("offset") || 0);
      const page = records.slice(start, start + size).map((record) => withComputed(table.name, record));
      return json(200, { records: page, ...(start + size < records.length ? { offset: String(start + size) } : {}) });
    }
    if (request.method === "POST") {
      const created = body.records.map((item) => ({ id: nextId(), createdTime: nextCreatedTime(), fields: structuredClone(item.fields || {}) }));
      records.push(...created);
      writes.push({ table: table.name, method: "POST", records: body.records });
      return json(200, { records: created.map((record) => withComputed(table.name, record)) });
    }
    if (request.method === "PATCH") {
      const missing = body.records.find((item) => !records.some((record) => record.id === item.id));
      if (missing) return json(404, { error: { type: "NOT_FOUND", message: `Record ${missing.id} not found` } });
      for (const item of body.records) Object.assign(records.find((record) => record.id === item.id).fields, structuredClone(item.fields));
      writes.push({ table: table.name, method: "PATCH", records: body.records });
      return json(200, { records: body.records.map((item) => withComputed(table.name, records.find((record) => record.id === item.id))) });
    }
    if (request.method === "DELETE") {
      const ids = url.searchParams.getAll("records[]");
      if (ids.length > 10) return json(422, { error: { type: "INVALID_RECORDS" } });
      data.set(table.name, records.filter((record) => !ids.includes(record.id)));
      writes.push({ table: table.name, method: "DELETE", records: ids });
      return json(200, { records: ids.map((id) => ({ id, deleted: true })) });
    }
    return json(405, { error: { type: "METHOD_NOT_ALLOWED" } });
  });

  return {
    baseId, requests, writes,
    records: (tableName) => data.get(tableName),
    record: (tableName, id) => data.get(tableName).find((record) => record.id === id),
    read: (tableName, id) => withComputed(tableName, data.get(tableName).find((record) => record.id === id)),
    failNext: (count, status = 429) => { failures = Array.from({ length: count }, () => status); },
    async start() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      return `http://127.0.0.1:${server.address().port}/v0`;
    },
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}
