// The only module in the app that talks to the Airtable HTTP API.
//
// - Writes are sent in batches of at most 10 records (Airtable's per-request limit).
// - Requests are spaced out to stay under Airtable's 5 requests/second/base limit.
// - HTTP 429 responses are retried with backoff (honouring Retry-After when present).
//   Airtable did not process a 429'd request, so this is safe for writes too.
// - Other 5xx/network failures are retried only for idempotent GET requests, so a
//   create is never duplicated.
// The token is read from the environment by the caller and only ever sent in the
// Authorization header; it is never logged or included in error messages.

export const AIRTABLE_BATCH_SIZE = 10;
const DEFAULT_API_ROOT = "https://api.airtable.com/v0";
const RETRYABLE_GET_STATUSES = new Set([500, 502, 503, 504]);

export class AirtableError extends Error {
  constructor(message, { status = 0, type = "" } = {}) {
    super(message);
    this.name = "AirtableError";
    this.status = status;
    this.type = type;
  }
}

export function chunk(items, size = AIRTABLE_BATCH_SIZE) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

function resolveRoot(apiRoot) {
  const url = new URL(apiRoot || DEFAULT_API_ROOT);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new AirtableError("AIRTABLE_API_ROOT must use HTTPS.");
  }
  return url.toString().replace(/\/$/, "");
}

function errorMessage(status, body) {
  if (status === 401) return "Airtable rejected the token. Check AIRTABLE_API_KEY.";
  if (status === 403) return "Airtable denied access. Check this token's base access and schema/record scopes.";
  if (status === 404) return body.error?.message || "Airtable could not find that base, table, or record.";
  if (status === 429) return "Airtable rate limit was still exceeded after retrying. Try again in 30 seconds.";
  return body.error?.message || body.error?.type || `Airtable returned HTTP ${status}.`;
}

function retryAfterMs(response) {
  const header = response.headers?.get?.("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export function createAirtableClient(options = {}) {
  const {
    apiKey = "", baseId = "", apiRoot = "", fetch: fetcher = globalThis.fetch,
    minIntervalMs = 210, maxRetries = 5, retryBaseMs = 1000, maxRetryDelayMs = 30_000,
    timeoutMs = 30_000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  } = options;
  const configured = Boolean(apiKey && baseId);
  let nextSlot = 0;
  const stats = { requests: 0, retries: 0 };

  function requireConfig() {
    if (!configured) throw new AirtableError("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID in the service environment.", { status: 503 });
  }

  async function throttle() {
    if (!minIntervalMs) return;
    const now = Date.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + minIntervalMs;
    if (slot > now) await sleep(slot - now);
  }

  async function request(url, { method = "GET", body } = {}) {
    requireConfig();
    for (let attempt = 0; ; attempt++) {
      await throttle();
      stats.requests++;
      let response;
      try {
        response = await fetcher(url, {
          method,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(body ? { "content-type": "application/json" } : {})
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (error) {
        if (method === "GET" && attempt < maxRetries) {
          stats.retries++;
          await sleep(Math.min(maxRetryDelayMs, retryBaseMs * 2 ** attempt));
          continue;
        }
        throw new AirtableError(`Could not reach Airtable: ${error.message}`, { status: 503 });
      }
      const retryable = response.status === 429 || (method === "GET" && RETRYABLE_GET_STATUSES.has(response.status));
      if (retryable && attempt < maxRetries) {
        stats.retries++;
        await response.body?.cancel?.().catch(() => {});
        await sleep(Math.min(maxRetryDelayMs, retryAfterMs(response) ?? retryBaseMs * 2 ** attempt));
        continue;
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new AirtableError(errorMessage(response.status, result), { status: response.status, type: result.error?.type || "" });
      }
      return result;
    }
  }

  const root = () => resolveRoot(apiRoot);
  const tableUrl = (table) => new URL(`${root()}/${encodeURIComponent(baseId)}/${encodeURIComponent(table)}`);

  async function getSchema() {
    const metaRoot = root().replace(/\/v0$/, "");
    const result = await request(`${metaRoot}/v0/meta/bases/${encodeURIComponent(baseId)}/tables`);
    return (result.tables || []).map((table) => ({
      id: table.id,
      name: table.name,
      primaryFieldId: table.primaryFieldId || null,
      fields: (table.fields || []).map((field) => ({
        id: field.id,
        name: field.name,
        type: field.type,
        linkedTableId: field.options?.linkedTableId || null,
        choices: field.options?.choices?.map((choice) => choice.name) || []
      }))
    }));
  }

  async function listRecords(table, { fields, filterByFormula, sort, pageSize = 100, maxRecords } = {}) {
    const records = [];
    let offset = "";
    do {
      const url = tableUrl(table);
      url.searchParams.set("pageSize", String(pageSize));
      if (maxRecords) url.searchParams.set("maxRecords", String(maxRecords));
      if (filterByFormula) url.searchParams.set("filterByFormula", filterByFormula);
      for (const name of fields || []) url.searchParams.append("fields[]", name);
      for (const [index, item] of (sort || []).entries()) {
        url.searchParams.set(`sort[${index}][field]`, item.field);
        if (item.direction) url.searchParams.set(`sort[${index}][direction]`, item.direction);
      }
      if (offset) url.searchParams.set("offset", offset);
      const page = await request(url);
      records.push(...(page.records || []));
      offset = page.offset || "";
    } while (offset);
    return records;
  }

  async function getRecord(table, recordId) {
    return request(`${tableUrl(table)}/${encodeURIComponent(recordId)}`);
  }

  async function createRecords(table, records, { typecast = false } = {}) {
    const created = [];
    for (const batch of chunk(records)) {
      const result = await request(tableUrl(table), {
        method: "POST",
        body: { records: batch.map((record) => ({ fields: record.fields || record })), typecast }
      });
      created.push(...(result.records || []));
    }
    return created;
  }

  async function updateRecords(table, records, { typecast = false } = {}) {
    const updated = [];
    for (const batch of chunk(records)) {
      const result = await request(tableUrl(table), {
        method: "PATCH",
        body: { records: batch.map(({ id, fields }) => ({ id, fields })), typecast }
      });
      updated.push(...(result.records || []));
    }
    return updated;
  }

  async function deleteRecords(table, recordIds) {
    const deleted = [];
    for (const batch of chunk(recordIds)) {
      const url = tableUrl(table);
      for (const id of batch) url.searchParams.append("records[]", id);
      const result = await request(url, { method: "DELETE" });
      deleted.push(...(result.records || []));
    }
    return deleted;
  }

  return { configured, stats, getSchema, listRecords, getRecord, createRecords, updateRecords, deleteRecords };
}

export function airtableClientFromEnv(env = process.env, overrides = {}) {
  return createAirtableClient({
    apiKey: env.AIRTABLE_API_KEY,
    baseId: env.AIRTABLE_BASE_ID,
    apiRoot: env.AIRTABLE_API_ROOT,
    ...overrides
  });
}
