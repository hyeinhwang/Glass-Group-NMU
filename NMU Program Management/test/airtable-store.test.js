import test from "node:test";
import assert from "node:assert/strict";
import {
  REQUIRED_TABLES, DIVIDER_TABLES, appStatusToAirtable, airtableStatusToApp, assertWorkWriteFields,
  createAirtableStore, linkedRecordIds, rightsToRole, workDueDate
} from "../airtable-store.js";

test("divider tables are never required", () => {
  for (const divider of DIVIDER_TABLES) assert.ok(!REQUIRED_TABLES.includes(divider));
  assert.ok(REQUIRED_TABLES.includes("Comments") && REQUIRED_TABLES.includes("Activity Log") && REQUIRED_TABLES.includes("Notifications"));
});

test("reads linked records as REST record-ID strings or { id } objects", () => {
  assert.deepEqual(linkedRecordIds(["recA", { id: "recB" }, { name: "x" }, "not-a-record"]), ["recA", "recB"]);
  assert.deepEqual(linkedRecordIds(undefined), []);
});

test("reads Effective Due Date, then Due Date Override, then Due Date", () => {
  assert.equal(workDueDate({ "Effective Due Date": "2027-01-05", "Due Date Override": "2027-01-04", "Due Date": "2027-01-03" }), "2027-01-05");
  assert.equal(workDueDate({ "Due Date Override": "2027-01-04", "Due Date": "2027-01-03" }), "2027-01-04");
  assert.equal(workDueDate({ "Due Date": ["2027-01-03"] }), "2027-01-03");
  assert.equal(workDueDate({ "Due Date": "#ERROR!" }), null);
});

test("only Task Status, Due Date Override, Assigned To and Completed Date are writable on Work", () => {
  assert.doesNotThrow(() => assertWorkWriteFields([{ id: "rec1", fields: {
    "Task Status": "Done", "Due Date Override": "2027-01-01", "Assigned To": ["recU"], "Completed Date": null
  } }]));
  for (const name of ["Due Date", "Status", "Assignee", "Effective Due Date", "Steps"]) {
    assert.throws(() => assertWorkWriteFields([{ id: "rec1", fields: { [name]: "x" } }]), /may not write Work/);
  }
  assert.doesNotThrow(() => assertWorkWriteFields([{ fields: { Steps: ["recS"], Session: ["recX"] } }], { creating: true }));
});

test("maps Users.Rights to roles and denies anything else", () => {
  assert.equal(rightsToRole("Admin"), "admin");
  assert.equal(rightsToRole(["Contributor", "Manager"]), "manager");
  assert.equal(rightsToRole({ name: "Contributor" }), "contributor");
  assert.equal(rightsToRole(""), null);
  assert.equal(rightsToRole("Viewer"), null);
});

test("maps task statuses onto the base's Task Status choices", () => {
  assert.equal(airtableStatusToApp("Done"), "Completed");
  assert.equal(airtableStatusToApp(["In progress"]), "In Progress");
  assert.equal(appStatusToAirtable("Completed", ["Not started", "In progress", "Done"]), "Done");
  assert.throws(() => appStatusToAirtable("Completed", ["Open"]), /Task Status has no option/);
});

test("refuses to write computed fields before calling Airtable", async () => {
  const calls = [];
  const client = {
    configured: true,
    getSchema: async () => [{ id: "tblWork", name: "Work", fields: [
      { name: "Task Status", type: "formula", choices: [] }, { name: "Due Date Override", type: "date", choices: [] }
    ] }],
    listRecords: async () => [],
    updateRecords: async (...args) => { calls.push(args); return []; }
  };
  const store = createAirtableStore({ client, cacheMs: 0 });
  await assert.rejects(() => store.setTaskStatus("recW", "Completed"), /Work.Task Status is computed \(formula\)/);
  await assert.rejects(() => store.assignTask("recW", "recU"), /no field "Assigned To"/);
  await store.setDueDateOverride("recW", "2027-01-01");
  assert.equal(calls.length, 1);
  const check = await store.checkSchema();
  assert.ok(check.missingTables.includes("Users"));
  assert.deepEqual(check.computedWriteFields, ["Work.Task Status"]);
  assert.ok(check.missingFields.includes("Work.Assigned To"));
});

test("shares one in-flight Airtable read between concurrent callers", async () => {
  let listCalls = 0;
  const client = { listRecords: async () => { listCalls++; await new Promise((resolve) => setTimeout(resolve, 10)); return [{ id: "rec1", fields: {} }]; } };
  const store = createAirtableStore({ client, cacheMs: 1000 });
  const [a, b] = await Promise.all([store.loadTable("Users"), store.loadTable("Users")]);
  assert.equal(listCalls, 1);
  assert.equal(a, b);
  store.invalidate("Users");
  await store.loadTable("Users");
  assert.equal(listCalls, 2);
});
