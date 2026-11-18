import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createAirtableStore, assertWorkWriteFields, workDueDate, rightsToRole, taskStatusToApp } from "../airtable-store.js";
import { createAirtableClient } from "../airtable-client.js";
import { createMockAirtable } from "./helpers/mock-airtable.js";
import { SCHEMA, T } from "../airtable-schema.js";
import { demoRows } from "../seed-data.js";

test("Work write guard allows only the approved fields", () => {
  assert.doesNotThrow(() => assertWorkWriteFields([{ fields: { "Task Status": "Completed", "Due Date Override": "2030-01-01", "Assigned To": [], "Completed Date": "2030-01-01" } }]));
  for (const name of ["Due Date", "Status", "Assignee", "Effective Due Date", "Session"]) {
    assert.throws(() => assertWorkWriteFields([{ fields: { [name]: "x" } }]), new RegExp(name));
  }
  assert.doesNotThrow(() => assertWorkWriteFields([{ fields: { Session: ["rec1"], Steps: ["rec2"] } }], { creating: true }));
});

test("due date precedence and value mapping", () => {
  assert.equal(workDueDate({ "Due Date Override": "2030-01-03", "Planned Due Date": "2030-01-02", "Effective Due Date": "2030-01-01" }), "2030-01-03");
  assert.equal(workDueDate({ "Planned Due Date": "2030-01-02", "Effective Due Date": "2030-01-01" }), "2030-01-02");
  assert.equal(workDueDate({ "Effective Due Date": "2030-01-01", "Due Date": "2029-12-31" }), "2030-01-01");
  assert.equal(workDueDate({ "Due Date": ["2029-12-31"] }), "2029-12-31");
  assert.equal(rightsToRole(["Program Manager"]), "program_manager");
  assert.equal(rightsToRole("Contributor"), "employee");
  assert.equal(rightsToRole(""), null);
  assert.equal(taskStatusToApp("Done"), "Completed");
});

test("serves cached data while refreshing, and re-reads after its own writes", async () => {
  const base = createMockAirtable({ tables: SCHEMA, rows: demoRows() });
  const apiRoot = await base.start();
  try {
    const client = createAirtableClient({ apiKey: "test-token", baseId: "appMock", apiRoot, minIntervalMs: 0 });
    const store = createAirtableStore({ client, cacheMs: 50 });
    const first = await store.model();
    assert.equal(first.users.length, 7);
    assert.equal(first.tasks.length, 50);
    base.record(T.users, "u-mary").fields["First Name"] = "Maria";
    assert.equal((await store.model()).usersById.get("u-mary").name, "Mary", "fresh cache is reused");
    await delay(60);
    assert.equal((await store.model()).usersById.get("u-mary").name, "Mary", "stale copy served while refreshing");
    await delay(20);
    assert.equal((await store.model()).usersById.get("u-mary").name, "Maria", "refreshed copy");
    await store.updateTasks([{ id: "p-seattle-task-2", status: "In Progress" }]);
    assert.equal((await store.model()).tasksById.get("p-seattle-task-2").status, "In Progress", "own write visible at once");
    assert.equal(store.status().lastWrite.table, T.work);
  } finally {
    await base.close();
  }
});

test("keeps working before the Resources table has been created", async () => {
  const rows = demoRows();
  delete rows[T.resources];
  const base = createMockAirtable({ tables: SCHEMA.filter((table) => table.name !== T.resources), rows });
  const apiRoot = await base.start();
  try {
    const store = createAirtableStore({ client: createAirtableClient({ apiKey: "test-token", baseId: "appMock", apiRoot, minIntervalMs: 0 }), cacheMs: 0 });
    const model = await store.model();
    assert.equal(model.projects.length, 6);
    assert.deepEqual(model.resources, []);
    assert.deepEqual(store.status().missingTables, [T.resources]);
  } finally {
    await base.close();
  }
});

test("leaves Session Name and End Date to the base when they are formulas", async () => {
  const tables = SCHEMA.map((table) => table.name !== T.sessions ? table : { ...table, fields: table.fields.map((field) =>
    ["Session Name", "End Date"].includes(field.name) ? { name: field.name, type: "formula" } : field) });
  const base = createMockAirtable({ tables, rows: {} });
  const apiRoot = await base.start();
  try {
    const store = createAirtableStore({ client: createAirtableClient({ apiKey: "test-token", baseId: "appMock", apiRoot, minIntervalMs: 0 }), cacheMs: 0 });
    const check = await store.checkSchema();
    assert.deepEqual(check.readOnlyConflicts, []);
    assert.deepEqual(check.computedInBase, ["Session.Session Name", "Session.End Date"]);
    const id = await store.createProject({ name: "Typed name", startDate: "2030-05-01", endDate: "2030-05-10", city: "Seattle" });
    await store.updateProject(id, { startDate: "2030-05-08", endDate: "2030-05-17" });
    const written = base.writes.filter((write) => write.table === T.sessions).flatMap((write) => write.records.flatMap((record) => Object.keys(record.fields)));
    assert.ok(written.includes("Start Date") && written.includes("City"));
    assert.ok(!written.includes("Session Name") && !written.includes("End Date"));
  } finally {
    await base.close();
  }
});
