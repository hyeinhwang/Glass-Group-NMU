import test from "node:test";
import assert from "node:assert/strict";
import { AirtableError, chunk, createAirtableClient } from "../airtable-client.js";

const jsonResponse = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", ...headers }
});
const noSleep = async () => {};
const makeClient = (fetcher, extra = {}) => createAirtableClient({
  apiKey: "secret-test-token", baseId: "appTest", apiRoot: "http://127.0.0.1:1/v0",
  fetch: fetcher, minIntervalMs: 0, sleep: noSleep, ...extra
});

test("splits records into batches of ten", () => {
  assert.deepEqual(chunk(Array.from({ length: 23 }, (_, i) => i)).map((batch) => batch.length), [10, 10, 3]);
});

test("creates, updates and deletes in batches of at most ten records", async () => {
  const calls = [];
  const client = makeClient(async (url, options) => {
    const parsed = new URL(url);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ method: options.method, size: body?.records?.length ?? parsed.searchParams.getAll("records[]").length });
    if (options.method === "DELETE") {
      return jsonResponse({ records: parsed.searchParams.getAll("records[]").map((id) => ({ id, deleted: true })) });
    }
    return jsonResponse({ records: body.records.map((record, index) => ({ id: record.id || `recNew${index}`, fields: record.fields })) });
  });
  const created = await client.createRecords("Comments", Array.from({ length: 12 }, (_, i) => ({ fields: { Comment: `c${i}` } })));
  const updated = await client.updateRecords("Work", Array.from({ length: 21 }, (_, i) => ({ id: `rec${i}`, fields: { "Task Status": "Done" } })));
  const deleted = await client.deleteRecords("Notifications", Array.from({ length: 11 }, (_, i) => `rec${i}`));
  assert.equal(created.length, 12);
  assert.equal(updated.length, 21);
  assert.equal(deleted.length, 11);
  assert.deepEqual(calls.map((call) => `${call.method}:${call.size}`), [
    "POST:10", "POST:2", "PATCH:10", "PATCH:10", "PATCH:1", "DELETE:10", "DELETE:1"
  ]);
});

test("paginates list requests and passes filters and fields", async () => {
  const urls = [];
  const client = makeClient(async (url) => {
    urls.push(new URL(url));
    return urls.length === 1
      ? jsonResponse({ records: [{ id: "rec1" }], offset: "page 2" })
      : jsonResponse({ records: [{ id: "rec2" }] });
  });
  const records = await client.listRecords("Work", { filterByFormula: "{Task Status}='Done'", fields: ["Task Status", "Assigned To"] });
  assert.deepEqual(records.map((record) => record.id), ["rec1", "rec2"]);
  assert.equal(urls[0].searchParams.get("filterByFormula"), "{Task Status}='Done'");
  assert.deepEqual(urls[0].searchParams.getAll("fields[]"), ["Task Status", "Assigned To"]);
  assert.equal(urls[1].searchParams.get("offset"), "page 2");
});

test("retries 429 responses, honouring Retry-After, for reads and writes", async () => {
  const waits = [];
  let attempts = 0;
  const client = makeClient(async (url, options) => {
    attempts++;
    if (attempts <= 2) return jsonResponse({ errors: [{ error: "RATE_LIMIT_REACHED" }] }, 429, attempts === 1 ? { "retry-after": "2" } : {});
    return jsonResponse({ records: JSON.parse(options.body).records.map((record) => ({ id: record.id, fields: record.fields })) });
  }, { sleep: async (ms) => { waits.push(ms); }, retryBaseMs: 100 });
  const result = await client.updateRecords("Work", [{ id: "rec1", fields: { "Task Status": "Done" } }]);
  assert.equal(result.length, 1);
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [2000, 200]);
  assert.equal(client.stats.retries, 2);
});

test("gives up after the retry limit with a clear 429 error", async () => {
  const client = makeClient(async () => jsonResponse({}, 429), { maxRetries: 2 });
  await assert.rejects(() => client.listRecords("Work"), (error) => {
    assert.ok(error instanceof AirtableError);
    assert.equal(error.status, 429);
    assert.match(error.message, /rate limit/);
    return true;
  });
});

test("retries 5xx only for GET so creates are never duplicated", async () => {
  let getAttempts = 0;
  const reader = makeClient(async () => (++getAttempts < 3 ? jsonResponse({}, 503) : jsonResponse({ records: [] })));
  assert.deepEqual(await reader.listRecords("Work"), []);
  assert.equal(getAttempts, 3);
  let postAttempts = 0;
  const writer = makeClient(async () => { postAttempts++; return jsonResponse({ error: { type: "SERVER_ERROR" } }, 503); });
  await assert.rejects(() => writer.createRecords("Comments", [{ fields: { Comment: "x" } }]), /SERVER_ERROR/);
  assert.equal(postAttempts, 1);
});

test("spaces requests to respect Airtable's per-base rate limit", async () => {
  const waits = [];
  const client = makeClient(async () => jsonResponse({ records: [] }), {
    minIntervalMs: 200, sleep: async (ms) => { waits.push(ms); }
  });
  await Promise.all([client.listRecords("A"), client.listRecords("B"), client.listRecords("C")]);
  assert.equal(waits.length, 2);
  assert.ok(waits[0] > 150 && waits[1] > 350, JSON.stringify(waits));
});

test("never exposes the token in errors and reports missing configuration", async () => {
  const client = makeClient(async () => jsonResponse({ error: { type: "AUTHENTICATION_REQUIRED" } }, 401));
  await assert.rejects(() => client.getSchema(), (error) => {
    assert.match(error.message, /rejected the token/);
    assert.ok(!error.message.includes("secret-test-token"));
    return true;
  });
  const unconfigured = createAirtableClient({});
  assert.equal(unconfigured.configured, false);
  await assert.rejects(() => unconfigured.listRecords("Work"), /AIRTABLE_API_KEY and AIRTABLE_BASE_ID/);
  await assert.rejects(() => createAirtableClient({ apiKey: "k", baseId: "b", apiRoot: "http://example.com/v0", minIntervalMs: 0 }).listRecords("x"), /HTTPS/);
});
