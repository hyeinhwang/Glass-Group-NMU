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
    const id = await store.createProject({ name: "Typed name", startDate: "2030-05-01", endDate: "2030-05-10", programType: "Community" });
    await store.updateProject(id, { startDate: "2030-05-08", endDate: "2030-05-17" });
    const written = base.writes.filter((write) => write.table === T.sessions).flatMap((write) => write.records.flatMap((record) => Object.keys(record.fields)));
    assert.ok(written.includes("Start Date") && written.includes("Program Type"));
    assert.equal(base.record(T.sessions, id).fields["Duration (Days)"], 9, "End Date comes from Start Date + Duration (Days)");
    assert.ok(!written.includes("Session Name") && !written.includes("End Date"));
  } finally {
    await base.close();
  }
});

test("against the real NMU base layout, setup adds only the app's own fields", async () => {
  const { NMU_BASE_2026_11_18 } = await import("./fixtures/nmu-base.js");
  const { compareSchema } = await import("../airtable-schema.js");
  const live = NMU_BASE_2026_11_18.map((table) => ({ ...table, fields: table.fields.map((field) => ({ ...field })) }));
  const result = compareSchema(live);
  assert.deepEqual(result.missingTables, ["Resources"]);
  assert.deepEqual(result.missingFields.sort(), [
    "Notifications.Session",
    "Session.Description", "Session.Details", "Session.Program Type", "Session.Project Manager", "Session.Team",
    "Steps.Milestone", "Steps.Priority",
    "Template List.Description", "Template List.Program Type",
    "Users.App Access Disabled", "Users.Password Hash",
    "Work.Description", "Work.Milestone", "Work.Planned Due Date", "Work.Prerequisites", "Work.Priority", "Work.Task Name"
  ]);
  assert.deepEqual(result.readOnlyConflicts, []);
  assert.deepEqual(result.computedInBase, ["Session.Session Name", "Session.End Date"]);
});

test("reads the real NMU base layout: Site location, Roles, Unique task names, formula dates", async () => {
  const { NMU_BASE_2026_11_18 } = await import("./fixtures/nmu-base.js");
  // The base after `airtable:setup -- --apply`: its own fields plus the app's.
  const tables = NMU_BASE_2026_11_18.map((table) => {
    const app = SCHEMA.find((item) => item.name === table.name);
    const extra = (app?.fields || []).filter((field) => !field.readOnly && !table.fields.some((own) => own.name === field.name));
    return { ...table, fields: [...table.fields, ...extra] };
  }).concat(SCHEMA.filter((table) => table.name === T.resources));
  const rows = {
    Roles: [{ id: "recRolePM", fields: { Name: "Program Manager" } }, { id: "recRoleShip", fields: { Name: "Shipping Coordinator" } }],
    Users: [
      { id: "recAdmin", fields: { "Email Address": "admin@nmu.org", "First Name": "Ana", Rights: ["Admin"], Status: "Active" } },
      { id: "recShip", fields: { "Email Address": "ship@nmu.org", "First Name": "Sol", Rights: ["Employee"], Roles: ["recRoleShip"] } },
      { id: "recGone", fields: { "Email Address": "old@nmu.org", "First Name": "Old", Rights: ["Employee"], Status: "Inactive" } }
    ],
    "Template List": [{ id: "recTpl", fields: { "List Name (Unique)": "Learn to Swim", Steps: ["recStep1", "recStep2"] } }],
    Steps: [
      { id: "recStep2", fields: { "Short Description": "Ship equipment", Days: -10, Template: ["recTpl"], Roles: ["recRoleShip"], Dependencies: ["recStep1"], ID: 2 } },
      { id: "recStep1", fields: { "Short Description": "Confirm pool", Days: -30, Template: ["recTpl"], Roles: ["recRolePM"], ID: 1 } }
    ],
    Region: [{ id: "recRegion", fields: { Name: "Pacific Northwest" } }],
    Site: [{ id: "recSite", fields: { "Program Name": "Rainier Community Center", "Program Location": "Seattle, WA", Region: ["recRegion"] } }],
    Session: [{ id: "recSession", fields: { "Start Date": "2030-06-01", "Duration (Days)": 14, Site: ["recSite"], Status: "Active", "Program Hours": "24", Template: ["recTpl"] } }],
    Work: [
      { id: "recWork1", fields: { Steps: ["recStep1"], Session: ["recSession"], "Task Status": "Complete", "Assigned To": ["recAdmin"] } },
      { id: "recWork2", fields: { Steps: ["recStep2"], Session: ["recSession"], "Assigned To": ["recShip"] } }
    ]
  };
  const day = (start, days) => new Date(Date.parse(`${start}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const computed = {
    Session: (fields, { get }) => ({
      "Session Name": `${get("Site", fields.Site?.[0])?.fields["Program Name"]} ${fields["Start Date"]}`,
      "End Date": day(fields["Start Date"], fields["Duration (Days)"] || 0)
    }),
    Work: (fields, { get }) => {
      const step = get("Steps", fields.Steps?.[0]);
      const due = day(get("Session", fields.Session?.[0]).fields["Start Date"], step.fields.Days);
      return { Unique: step.fields["Short Description"], "Due Date": due, "Effective Due Date": fields["Due Date Override"] || due };
    }
  };
  const base = createMockAirtable({ tables, rows, computed });
  const apiRoot = await base.start();
  try {
    const store = createAirtableStore({ client: createAirtableClient({ apiKey: "test-token", baseId: "appMock", apiRoot, minIntervalMs: 0 }), cacheMs: 0 });
    const model = await store.model();
    assert.deepEqual(model.users.filter((user) => user.is_active).map((user) => user.id), ["recAdmin", "recShip"]);
    const [project] = model.projects;
    assert.equal(project.name, "Rainier Community Center 2030-06-01");
    assert.equal(project.end_date, "2030-06-15");
    assert.equal(project.location, "Seattle, WA");
    assert.equal(project.host_organization, "Rainier Community Center");
    assert.equal(project.region, "Pacific Northwest");
    assert.equal(project.details.programHours, 24);
    const steps = model.templateTasks.filter((step) => step.template_id === "recTpl");
    assert.deepEqual(steps.map((step) => step.title), ["Confirm pool", "Ship equipment"]);
    assert.equal(steps[0].default_role, "program_manager");
    assert.deepEqual(steps[1].role_ids, ["recRoleShip"]);
    assert.equal(steps[1].dependency_index, 1);
    const ship = model.tasksById.get("recWork2");
    assert.equal(ship.title, "Ship equipment");
    assert.equal(ship.due_date, "2030-05-22");
    assert.deepEqual(ship.prerequisite_ids, ["recWork1"], "prerequisites come from the Steps' Dependencies");
    assert.equal(model.tasksById.get("recWork1").status, "Completed");

    // Writing: a new program at a new site, and a status change.
    const siteId = await store.createSite({ name: "Tacoma YMCA", location: "Tacoma, WA", regionId: "recRegion" });
    const id = await store.createProject({ name: "ignored", programType: "Learn to Swim", siteId, startDate: "2030-07-01", endDate: "2030-07-10", programHours: 18, status: "Planning" });
    await store.updateTasks([{ id: "recWork2", status: "In Progress", completedAt: null }]);
    const after = await store.model();
    assert.equal(after.projectsById.get(id).location, "Tacoma, WA");
    assert.equal(after.projectsById.get(id).end_date, "2030-07-10");
    assert.equal(after.tasksById.get("recWork2").status, "In Progress");
    assert.equal(base.record("Session", id).fields["Program Hours"], "18");
  } finally {
    await base.close();
  }
});

test("sees a field added in Airtable after start-up without a restart", async () => {
  const tables = SCHEMA.map((table) => table.name !== T.users ? table : { ...table, fields: table.fields.filter((field) => field.name !== "Password Hash") });
  const base = createMockAirtable({ tables, rows: {} });
  const apiRoot = await base.start();
  try {
    const store = createAirtableStore({ client: createAirtableClient({ apiKey: "test-token", baseId: "appMock", apiRoot, minIntervalMs: 0 }), cacheMs: 0 });
    await assert.rejects(store.createUser({ name: "Ana", email: "ana@nmu.org", role: "admin", passwordHash: "x:y" }), /no "Password Hash" field/);
    base.addField(T.users, { name: "Password Hash", type: "singleLineText" });
    await store.createUser({ name: "Ana", email: "ana@nmu.org", role: "admin", passwordHash: "x:y" });
    assert.equal((await store.model()).users[0].password_hash, "x:y");
  } finally {
    await base.close();
  }
});
