import test from "node:test";
import assert from "node:assert/strict";
import {
  AIRTABLE_DIVIDER_TABLE_NAMES, AIRTABLE_TABLE_NAMES, appStatusToAirtable, airtableStatusToApp,
  assertWorkWriteFields, fetchAirtableRecords, fetchAirtableSchema, linkedRecordIds,
  updateAirtableRecords, workDueDate
} from "../airtable-sync.js";

const config = { apiKey: "test-token", baseId: "appTest", apiRoot: "http://127.0.0.1:3210/v0" };
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" }
});

test("discovers table metadata and linked-record targets", async () => {
  let calledUrl;
  const schema = await fetchAirtableSchema(config, async (url, options) => {
    calledUrl = String(url);
    assert.equal(options.headers.Authorization, "Bearer test-token");
    return jsonResponse({ tables: [{
      id: "tblWork", name: "Work",
      fields: [{ id: "fldSession", name: "Session", type: "multipleRecordLinks", options: { linkedTableId: "tblSession" } }]
    }] });
  });
  assert.equal(calledUrl, "http://127.0.0.1:3210/v0/meta/bases/appTest/tables");
  assert.deepEqual(schema[0].fields[0], {
    id: "fldSession", name: "Session", type: "multipleRecordLinks",
    linkedTableId: "tblSession", choices: []
  });
  assert.equal(AIRTABLE_TABLE_NAMES.length, 9);
  for (const divider of AIRTABLE_DIVIDER_TABLE_NAMES) assert.ok(!AIRTABLE_TABLE_NAMES.includes(divider));
});

test("paginates Airtable records using the returned offset", async () => {
  const calls = [];
  const records = await fetchAirtableRecords(config, "tbl Work", async (url) => {
    calls.push(String(url));
    if (calls.length === 1) return jsonResponse({ records: [{ id: "rec1" }], offset: "next page" });
    return jsonResponse({ records: [{ id: "rec2" }] });
  });
  assert.deepEqual(records.map((record) => record.id), ["rec1", "rec2"]);
  assert.match(calls[0], /tbl%20Work$/);
  assert.match(calls[1], /offset=next\+page$/);
});

test("batches writes in Airtable's ten-record limit", async () => {
  const batches = [];
  const records = Array.from({ length: 11 }, (_, index) => ({ id: `rec${index}`, fields: { Status: "Complete" } }));
  const updated = await updateAirtableRecords(config, "tblWork", records, async (url, options) => {
    const body = JSON.parse(options.body);
    batches.push(body.records);
    assert.equal(options.method, "PATCH");
    assert.match(String(url), /tblWork$/);
    return jsonResponse({ records: body.records });
  });
  assert.deepEqual(batches.map((batch) => batch.length), [10, 1]);
  assert.equal(updated.length, 11);
});

test("maps linked values and task statuses without broadening write scope", () => {
  assert.deepEqual(linkedRecordIds([{ id: "recA" }, { id: "recB" }, { name: "not a linked record" }]), ["recA", "recB"]);
  assert.equal(airtableStatusToApp("Done"), "Completed");
  assert.equal(airtableStatusToApp("Started"), "In Progress");
  assert.equal(appStatusToAirtable("Completed", ["Not started", "In progress", "Done"]), "Done");
  assert.throws(() => appStatusToAirtable("Completed", ["Open", "In progress"]), /no option matching/);
});

test("reports missing config and Airtable permission errors explicitly", async () => {
  await assert.rejects(() => fetchAirtableSchema({}), /AIRTABLE_API_KEY and AIRTABLE_BASE_ID/);
  await assert.rejects(
    () => fetchAirtableSchema(config, async () => jsonResponse({ error: { type: "INVALID_PERMISSIONS" } }, 403)),
    /base access and schema\/record scopes/
  );
});

test("reads Effective Due Date, then Due Date Override, then Due Date", () => {
  assert.equal(workDueDate({ "Effective Due Date": "2027-01-05", "Due Date Override": "2027-01-04", "Due Date": "2027-01-03" }), "2027-01-05");
  assert.equal(workDueDate({ "Due Date Override": "2027-01-04", "Due Date": "2027-01-03" }), "2027-01-04");
  assert.equal(workDueDate({ "Due Date": ["2027-01-03"] }), "2027-01-03");
  assert.equal(workDueDate({}), null);
});

test("refuses to write formula and lookup Work fields", () => {
  assert.doesNotThrow(() => assertWorkWriteFields([{ id: "rec1", fields: {
    "Task Status": "Done", "Due Date Override": "2027-01-01", "Assigned To": [{ id: "recU" }], "Completed Date": null
  } }]));
  for (const name of ["Due Date", "Status", "Assignee", "Notes"]) {
    assert.throws(() => assertWorkWriteFields([{ id: "rec1", fields: { [name]: "x" } }]), /may not write Work/);
  }
});
