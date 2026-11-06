import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createFixtureAirtable, WRITABLE_WORK_FIELDS } from "./helpers/fixture.js";
import { startApp } from "./helpers/server.js";

let airtable;
let app;
const today = () => new Date().toISOString().slice(0, 10);

async function request(path, email = "admin@nmu.test", options = {}) {
  const response = await fetch(`${app.url}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(email ? { "x-dev-user": email } : {}), ...(options.headers || {}) },
    ...(options.body && typeof options.body !== "string" ? { body: JSON.stringify(options.body) } : {})
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
const patch = (path, email, body) => request(path, email, { method: "PATCH", body });
const post = (path, email, body) => request(path, email, { method: "POST", body });

before(async () => {
  airtable = createFixtureAirtable();
  const apiRoot = await airtable.start();
  app = await startApp({
    NMU_AUTH_MODE: "dev", AIRTABLE_API_KEY: "test-token", AIRTABLE_BASE_ID: airtable.baseId, AIRTABLE_API_ROOT: apiRoot
  });
  assert.equal(app.child.exitCode, null, app.output());
});
after(async () => {
  await app?.stop();
  await airtable?.close();
});

test("NMU workflows read and write Airtable directly", async (t) => {
  await t.test("loads projects, tasks, users, sites and templates from Airtable", async () => {
    const result = await request("/api/bootstrap");
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.currentUser.role, "admin");
    assert.equal(result.body.currentUser.roleLabel, "Admin");
    assert.deepEqual(result.body.users.map((user) => user.role).sort(), ["admin", "admin", "contributor", "contributor", "manager"]);
    assert.ok(result.body.users.every((user) => !("email" in user)));
    assert.equal(result.body.projects.length, 2);
    const winter = result.body.projects.find((project) => project.id === "recSessionWinter");
    assert.equal(winter.name, "Everett Swim · Winter Session");
    assert.equal(winter.location, "Everett, WA");
    assert.equal(winter.progress, 33);
    assert.equal(result.body.tasks.length, 4);
    const host = result.body.tasks.find((task) => task.id === "recWorkHost");
    assert.equal(host.status, "Completed");
    assert.equal(host.dueDate, "2026-12-16", "due date comes from the Effective Due Date formula");
    assert.equal(host.assigneeName, "Jordan Ellis", "assignee comes from Assigned To, not the Assignee lookup");
    const clearances = result.body.tasks.find((task) => task.id === "recWorkClear");
    assert.equal(clearances.isBlocked, true);
    assert.deepEqual(clearances.dependencies.map((item) => item.id), ["recWorkRecruit"]);
    assert.equal(result.body.templates[0].stepCount, 3);
    assert.deepEqual(result.body.sites.map((site) => site.id), ["recSiteEverett"]);
  });

  await t.test("assigns roles from Users.Rights and rejects unknown or unprivileged emails", async () => {
    assert.equal((await request("/api/bootstrap", "norights@nmu.test")).status, 401);
    assert.equal((await request("/api/bootstrap", "nobody@nmu.test")).status, 401);
    assert.equal((await request("/api/bootstrap", null)).status, 401);
    const manager = await request("/api/bootstrap", "manager@nmu.test");
    assert.equal(manager.body.currentUser.role, "manager");
    assert.equal(manager.body.projects.length, 2);
  });

  await t.test("contributors only see programs where they have assigned work", async () => {
    const casey = await request("/api/bootstrap", "casey@nmu.test");
    assert.equal(casey.body.currentUser.role, "contributor");
    assert.deepEqual(casey.body.projects.map((project) => project.id), ["recSessionWinter"]);
    assert.equal(casey.body.tasks.length, 3);
    assert.equal((await request("/api/projects/recSessionSpring", "casey@nmu.test")).status, 404);
    assert.equal((await request("/api/integrations/airtable/tables", "casey@nmu.test")).status, 403);
    assert.equal((await request("/api/users", "casey@nmu.test")).status, 403);
    assert.equal((await post("/api/projects", "casey@nmu.test", {})).status, 403);
  });

  await t.test("enforces prerequisites and writes Task Status and Completed Date", async () => {
    assert.equal((await patch("/api/tasks/recWorkClear/status", "casey@nmu.test", { status: "Completed" })).status, 404, "not Casey's task");
    const blocked = await patch("/api/tasks/recWorkClear/status", "mary@nmu.test", { status: "Completed" });
    assert.equal(blocked.status, 409);
    assert.deepEqual(blocked.body.prerequisites, ["Recruit instructors"]);
    const done = await patch("/api/tasks/recWorkRecruit/status", "casey@nmu.test", { status: "Completed" });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const work = airtable.record("Work", "recWorkRecruit").fields;
    assert.equal(work["Task Status"], "Done");
    assert.equal(work["Completed Date"], today());
    const mary = await request("/api/bootstrap", "mary@nmu.test");
    assert.ok(mary.body.notifications.some((item) => item.message === "Task is now ready: Complete clearances"));
    assert.equal(mary.body.tasks.find((task) => task.id === "recWorkClear").isBlocked, false);
    const reopened = await patch("/api/tasks/recWorkRecruit/status", "casey@nmu.test", { status: "In Progress" });
    assert.equal(reopened.status, 200);
    assert.equal(airtable.record("Work", "recWorkRecruit").fields["Completed Date"], null);
    assert.equal(airtable.record("Work", "recWorkRecruit").fields["Task Status"], "In Progress");
    const override = await patch("/api/tasks/recWorkClear/status", "admin@nmu.test", { status: "Completed", overrideReason: "Host confirmed clearances directly" });
    assert.equal(override.status, 200);
    const project = await request("/api/projects/recSessionWinter", "admin@nmu.test");
    assert.ok(project.body.activities.some((item) => item.action === "Dependency override" && item.userName === "Ada Admin"));
    assert.ok(project.body.activities.some((item) => item.action === "Status changed"));
  });

  await t.test("stores comments and activity in Airtable", async () => {
    const comment = await post("/api/tasks/recWorkRecruit/comments", "casey@nmu.test", { content: "Two instructor referrals from the host." });
    assert.equal(comment.status, 201);
    const stored = airtable.records("Comments").at(-1).fields;
    assert.deepEqual(stored, { Comment: "Two instructor referrals from the host.", Work: ["recWorkRecruit"], Author: ["recCasey"] });
    const activity = airtable.records("Activity Log").at(-1).fields;
    assert.equal(activity.Action, "Comment added");
    assert.deepEqual(activity.Session, ["recSessionWinter"]);
    const project = await request("/api/projects/recSessionWinter", "manager@nmu.test");
    assert.equal(project.body.comments[0].userName, "Casey Nguyen");
    assert.equal(project.body.comments[0].taskId, "recWorkRecruit");
    assert.equal((await post("/api/tasks/recWorkSpringHost/comments", "casey@nmu.test", { content: "x" })).status, 404);
    assert.equal((await post("/api/tasks/recWorkRecruit/comments", "casey@nmu.test", { content: " " })).status, 400);
  });

  await t.test("reassigns with Assigned To and notifies the new owner", async () => {
    assert.equal((await patch("/api/tasks/recWorkRecruit/assignee", "casey@nmu.test", { assignedUserId: "recMary" })).status, 403);
    assert.equal((await patch("/api/tasks/recWorkRecruit/assignee", "manager@nmu.test", { assignedUserId: "recNoRights" })).status, 400);
    const result = await patch("/api/tasks/recWorkRecruit/assignee", "manager@nmu.test", { assignedUserId: "recMary" });
    assert.equal(result.status, 200);
    assert.deepEqual(airtable.record("Work", "recWorkRecruit").fields["Assigned To"], ["recMary"]);
    const mary = await request("/api/bootstrap", "mary@nmu.test");
    const notice = mary.body.notifications.find((item) => item.message === "New task assigned: Recruit instructors");
    assert.ok(notice);
    assert.equal((await patch(`/api/notifications/${notice.id}`, "casey@nmu.test", {})).status, 404, "cannot mark someone else's notification");
    assert.equal((await patch(`/api/notifications/${notice.id}`, "mary@nmu.test", {})).status, 200);
    assert.equal(airtable.record("Notifications", notice.id).fields.Read, true);
  });

  await t.test("overrides deadlines with Due Date Override", async () => {
    assert.equal((await patch("/api/tasks/recWorkRecruit/due-date", "mary@nmu.test", { dueDate: "2027-01-01" })).status, 403);
    const result = await patch("/api/tasks/recWorkRecruit/due-date", "manager@nmu.test", { dueDate: "2027-01-02" });
    assert.equal(result.status, 200);
    assert.equal(airtable.record("Work", "recWorkRecruit").fields["Due Date Override"], "2027-01-02");
    const task = (await request("/api/bootstrap", "manager@nmu.test")).body.tasks.find((item) => item.id === "recWorkRecruit");
    assert.equal(task.dueDate, "2027-01-02");
    assert.equal(task.dueDateOverride, true);
  });

  let newProjectId;
  await t.test("creates a Session and its Work rows from a template", async () => {
    const result = await post("/api/projects", "manager@nmu.test", {
      name: "Clinic Session", siteId: "recSiteEverett", templateId: "recTplClinic", startDate: "2027-03-01", endDate: "2027-03-03"
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.body.taskCount, 3);
    newProjectId = result.body.projectId;
    assert.deepEqual(airtable.record("Session", newProjectId).fields, {
      "Session Name": "Clinic Session", "Start Date": "2027-03-01", Site: ["recSiteEverett"], "End Date": "2027-03-03"
    });
    const created = airtable.records("Work").filter((record) => record.fields.Session[0] === newProjectId);
    assert.equal(created.length, 3);
    assert.deepEqual(created.map((record) => record.fields["Assigned To"]), [["recManager"], ["recManager"], ["recCasey"]]);
    assert.ok(created.every((record) => record.fields["Task Status"] === "Not Started"));
    const project = await request(`/api/projects/${newProjectId}`, "manager@nmu.test");
    assert.deepEqual(project.body.tasks.map((task) => task.dueDate).sort(), ["2027-01-30", "2027-02-09", "2027-02-19"]);
    const casey = await request("/api/bootstrap", "casey@nmu.test");
    assert.ok(casey.body.notifications.some((item) => item.message === "New task assigned: Complete clearances — Clinic Session"));
    assert.equal((await post("/api/projects", "manager@nmu.test", { name: "Bad", siteId: "recSiteEverett", templateId: "recTplClinic", startDate: "2027-03-05", endDate: "2027-03-01" })).status, 400);
  });

  await t.test("previews and applies a timeline shift without moving completed or overridden tasks", async () => {
    const project = await request(`/api/projects/${newProjectId}`, "manager@nmu.test");
    const [first, second, third] = project.body.tasks.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    assert.equal((await patch(`/api/tasks/${first.id}/status`, "manager@nmu.test", { status: "Completed" })).status, 200);
    assert.equal((await patch(`/api/tasks/${second.id}/due-date`, "manager@nmu.test", { dueDate: "2027-02-14" })).status, 200);
    const preview = await post("/api/projects/date-preview", "manager@nmu.test", { projectId: newProjectId, startDate: "2027-03-11" });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.shiftDays, 10);
    assert.deepEqual(preview.body.changes, [{ id: third.id, title: third.title, oldDate: "2027-02-19", newDate: "2027-03-01" }]);
    assert.equal((await patch(`/api/projects/${newProjectId}/start-date`, "casey@nmu.test", { startDate: "2027-03-11" })).status, 403);
    const applied = await patch(`/api/projects/${newProjectId}/start-date`, "manager@nmu.test", { startDate: "2027-03-11" });
    assert.equal(applied.status, 200);
    assert.equal(airtable.record("Session", newProjectId).fields["Start Date"], "2027-03-11");
    assert.equal(airtable.record("Session", newProjectId).fields["End Date"], "2027-03-13");
    assert.equal(airtable.record("Work", first.id).fields["Due Date Override"], "2027-01-30", "completed task is pinned");
    const after = await request(`/api/projects/${newProjectId}`, "manager@nmu.test");
    const dates = Object.fromEntries(after.body.tasks.map((task) => [task.id, task.dueDate]));
    assert.deepEqual(dates, { [first.id]: "2027-01-30", [second.id]: "2027-02-14", [third.id]: "2027-03-01" });
    assert.ok(after.body.activities.some((item) => item.action === "Timeline updated"));
  });

  await t.test("never writes Work formula or lookup fields", () => {
    const workWrites = airtable.writes.filter((write) => write.table === "Work");
    assert.ok(workWrites.length > 5);
    for (const write of workWrites) {
      for (const record of write.records) {
        const allowed = write.method === "POST" ? [...WRITABLE_WORK_FIELDS, "Steps", "Session"] : WRITABLE_WORK_FIELDS;
        for (const name of Object.keys(record.fields)) assert.ok(allowed.includes(name), `${write.method} wrote Work.${name}`);
      }
    }
    assert.ok(airtable.writes.every((write) => write.records.length <= 10));
  });

  await t.test("administrators browse live Airtable tables and check the schema", async () => {
    const schema = await request("/api/integrations/airtable/schema");
    assert.equal(schema.status, 200);
    assert.deepEqual(schema.body.missingTables, []);
    assert.deepEqual(schema.body.missingFields, []);
    assert.deepEqual(schema.body.computedWriteFields, []);
    const tables = await request("/api/integrations/airtable/tables");
    assert.equal(tables.body.tables.length, 12, "divider tables are hidden");
    assert.ok(!tables.body.tables.some((table) => table.name.endsWith("->")));
    const steps = tables.body.tables.find((table) => table.name === "Steps");
    const records = await request(`/api/integrations/airtable/tables/${steps.id}/records?limit=2&q=instructors`);
    assert.equal(records.status, 200);
    assert.equal(records.body.total, 1);
    assert.equal(records.body.records[0].id, "recStepRecruit");
    assert.equal(records.body.recordLabels.recTplClinic, "Swim Safety Clinic");
    assert.equal((await request("/api/integrations/airtable/tables/tblMissing/records")).status, 404);
    const users = await request("/api/users");
    assert.equal(users.body.users.find((item) => item.id === "recNoRights").roleLabel, "No access");
  });

  await t.test("recovers from Airtable 429 rate limits", async () => {
    airtable.failNext(3, 429);
    const result = await request("/api/bootstrap", "manager@nmu.test");
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.projects.length, 3);
  });
});
