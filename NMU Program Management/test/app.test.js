import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createMockAirtable } from "./helpers/mock-airtable.js";
import { SCHEMA, T } from "../airtable-schema.js";
import { demoRows, templateRows } from "../seed-data.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
let serverProcess;
let baseUrl;
let mockAirtable;

// Starts server.js against an in-memory Airtable base.
function airtableEnv(apiRoot) {
  return { AIRTABLE_API_KEY: "test-token", AIRTABLE_BASE_ID: "appMock", AIRTABLE_API_ROOT: apiRoot, NMU_AIRTABLE_CACHE_MS: "0", NMU_AIRTABLE_MIN_INTERVAL_MS: "0" };
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function request(path, userId = "u-catalina", options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", "x-demo-user": userId, ...(options.headers || {}) }
  });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  mockAirtable = createMockAirtable({ tables: SCHEMA, rows: demoRows() });
  const apiRoot = await mockAirtable.start();
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port), NODE_ENV: "test", NMU_AUTH_MODE: "", ...airtableEnv(apiRoot) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  serverProcess.stdout.on("data", (chunk) => { output += chunk.toString(); });
  serverProcess.stderr.on("data", (chunk) => { output += chunk.toString(); });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (serverProcess.exitCode !== null) throw new Error(`Test server exited early:\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/api/bootstrap`, { headers: { "x-demo-user": "u-catalina" } });
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Test server did not start:\n${output}`);
});

after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill("SIGTERM");
    await new Promise((resolve) => serverProcess.once("exit", resolve));
  }
  if (mockAirtable) await mockAirtable.close();
});

test("NMU project, dependency, access, and timeline workflows", async (t) => {
  const plusDays = (days) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  let createdProjectId;
  let createdTasks;

  await t.test("seeds realistic demo data and template workflows", async () => {
    const result = await request("/api/bootstrap");
    assert.equal(result.status, 200);
    assert.equal(result.body.users.length, 7);
    assert.equal(result.body.templates.length, 3);
    assert.equal(result.body.projects.length, 6);
    assert.ok(result.body.tasks.length >= 40 && result.body.tasks.length <= 60);
    assert.ok(result.body.tasks.some((task) => task.isBlocked));
  });

  await t.test("creates a program and generates relative tasks", async () => {
    const startDate = plusDays(250);
    const result = await request("/api/projects", "u-jordan", {
      method: "POST",
      body: JSON.stringify({
        name: "Test community swim program", programType: "Community", location: "Bellingham, WA",
        hostOrganization: "Demo Host", startDate, endDate: plusDays(264),
        templateId: "tpl-community", projectManagerId: "u-jordan",
        primaryContact: "Morgan Lee", participants: 32, notes: "Created by automated test"
      })
    });
    assert.equal(result.status, 201);
    createdProjectId = result.body.projectId;
    assert.equal(result.body.taskCount, 16);
    const project = await request(`/api/projects/${createdProjectId}`, "u-jordan");
    createdTasks = project.body.tasks;
    assert.equal(project.status, 200);
    assert.equal(createdTasks[0].dueDate, plusDays(130));
    assert.ok(createdTasks.some((task) => task.dependencies.length > 0));
    assert.equal(project.body.project.details.primaryContact, "Morgan Lee");
    assert.equal(result.body.taskCount, project.body.tasks.length);
  });

  await t.test("creates a program from scratch without template tasks", async () => {
    const programDate = plusDays(310);
    const result = await request("/api/projects", "u-jordan", {
      method: "POST",
      body: JSON.stringify({
        name: "Swim Safely Series – Bellevue Bellevue YMCA",
        programType: "Swim Safely Series",
        deliveryType: "Community",
        city: "Bellevue",
        state: "WA",
        location: "Bellevue, WA",
        hostOrganization: "Bellevue YMCA",
        startDate: programDate,
        projectManagerId: "u-jordan",
        creationMode: "scratch",
        programHours: 24,
        leadInstructors: "Alex Rivera, Sam Okafor"
      })
    });
    assert.equal(result.status, 201);
    assert.equal(result.body.taskCount, 0);
    const project = await request(`/api/projects/${result.body.projectId}`, "u-jordan");
    assert.equal(project.status, 200);
    assert.equal(project.body.project.endDate, programDate);
    assert.equal(project.body.project.city, "Bellevue");
    assert.equal(project.body.project.state, "WA");
    assert.equal(project.body.project.deliveryType, "Community");
    assert.equal(project.body.project.details.programHours, 24);
    assert.equal(project.body.project.details.leadInstructors, "Alex Rivera, Sam Okafor");
    assert.equal(project.body.tasks.length, 0);
    const firstTask = await request(`/api/projects/${result.body.projectId}/tasks`, "u-jordan", {
      method: "POST",
      body: JSON.stringify({
        title: "Confirm instructor availability", description: "Contact the selected instructors.",
        dueDate: programDate, milestone: "Staffing", priority: "High", assignedUserId: "u-casey"
      })
    });
    assert.equal(firstTask.status, 201);
    const followupTask = await request(`/api/projects/${result.body.projectId}/tasks`, "u-jordan", {
      method: "POST",
      body: JSON.stringify({
        title: "Prepare instructor schedule", dueDate: programDate, milestone: "Staffing",
        priority: "Medium", dependencyIds: [firstTask.body.taskId]
      })
    });
    assert.equal(followupTask.status, 201);
    const populatedProject = await request(`/api/projects/${result.body.projectId}`, "u-jordan");
    assert.equal(populatedProject.body.tasks.length, 2);
    assert.equal(populatedProject.body.tasks.find((task) => task.id === firstTask.body.taskId).assigneeName, "Casey Nguyen");
    assert.equal(populatedProject.body.tasks.find((task) => task.id === followupTask.body.taskId).isBlocked, true);
    assert.ok(populatedProject.body.members.some((member) => member.id === "u-casey"));
    const foreignDependency = await request(`/api/projects/${result.body.projectId}/tasks`, "u-jordan", {
      method: "POST",
      body: JSON.stringify({ title: "Invalid dependency", dueDate: programDate, dependencyIds: [createdTasks[0].id] })
    });
    assert.equal(foreignDependency.status, 400);
    const unauthorizedCreate = await request(`/api/projects/${result.body.projectId}/tasks`, "u-mary", {
      method: "POST",
      body: JSON.stringify({ title: "Unauthorized task", dueDate: programDate })
    });
    assert.equal(unauthorizedCreate.status, 404);
  });

  await t.test("reassigns tasks, notifies the new owner, and records notes", async () => {
    const task = createdTasks.find((item) => item.title === "Research funding opportunities");
    const reassigned = await request(`/api/tasks/${task.id}/assignee`, "u-jordan", {
      method: "PATCH", body: JSON.stringify({ assignedUserId: "u-mary" })
    });
    assert.equal(reassigned.status, 200);
    const previousOwner = await request("/api/bootstrap", "u-casey");
    const newOwner = await request("/api/bootstrap", "u-mary");
    assert.ok(!previousOwner.body.tasks.some((item) => item.id === task.id && item.assignedUserId === "u-casey"));
    assert.ok(newOwner.body.tasks.some((item) => item.id === task.id && item.assignedUserId === "u-mary"));
    assert.ok(newOwner.body.notifications.some((item) => item.message.includes(task.title)));
    const comment = await request(`/api/tasks/${task.id}/comments`, "u-mary", {
      method: "POST", body: JSON.stringify({ content: "Contacted the regional grant office." })
    });
    assert.equal(comment.status, 201);
    const project = await request(`/api/projects/${createdProjectId}`, "u-jordan");
    assert.ok(project.body.activities.some((item) => item.action === "Task reassigned"));
    assert.ok(project.body.comments.some((item) => item.content === "Contacted the regional grant office."));
  });

  await t.test("supports several owners per task with valid relationships", async () => {
    const task = createdTasks.find((item) => item.title === "Research funding opportunities");
    const patchOwners = (ids, user = "u-jordan") => request(`/api/tasks/${task.id}/assignees`, user, {
      method: "PATCH", body: JSON.stringify({ assignedUserIds: ids })
    });
    assert.equal((await patchOwners(["u-casey"], "u-casey")).status, 403, "employees cannot change owners");
    assert.equal((await patchOwners([])).status, 400);
    assert.equal((await patchOwners(["u-missing"])).status, 400);
    assert.equal((await patchOwners(["u-partner"])).status, 400, "external partners cannot own internal tasks");
    const updated = await patchOwners(["u-mary", "u-casey"]);
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    const project = await request(`/api/projects/${createdProjectId}`, "u-jordan");
    const stored = project.body.tasks.find((item) => item.id === task.id);
    assert.deepEqual(stored.assigneeIds, ["u-mary", "u-casey"]);
    assert.equal(stored.assignedUserId, "u-mary", "first owner stays the lead");
    assert.equal(stored.assigneeName, "Mary, Casey Nguyen");
    const casey = await request("/api/bootstrap", "u-casey");
    const caseyTask = casey.body.tasks.find((item) => item.id === task.id);
    assert.ok(caseyTask, "second owner sees the task");
    assert.equal(caseyTask.canEdit, true, "second owner can update it");
    assert.ok(casey.body.notifications.some((item) => item.message === `New task assigned: ${task.title}`));
    const caseyStatus = await request(`/api/tasks/${task.id}/status`, "u-casey", { method: "PATCH", body: JSON.stringify({ status: "In Progress" }) });
    assert.equal(caseyStatus.status, 200);
    assert.ok(project.body.activities.some((item) => item.action === "Task owners updated"));
    const unchanged = await patchOwners(["u-mary", "u-casey"]);
    assert.equal(unchanged.body.unchanged, true);
    // The single-owner endpoint and the owners list stay consistent.
    assert.equal((await request(`/api/tasks/${task.id}/assignee`, "u-jordan", { method: "PATCH", body: JSON.stringify({ assignedUserId: "u-sam" }) })).status, 200);
    const afterReassign = (await request(`/api/projects/${createdProjectId}`, "u-jordan")).body.tasks.find((item) => item.id === task.id);
    assert.equal(afterReassign.assignedUserId, "u-sam");
    assert.deepEqual([...afterReassign.assigneeIds].sort(), ["u-casey", "u-sam"]);
    assert.equal((await patchOwners(["u-mary"])).status, 200);
    const caseyAfter = await request("/api/bootstrap", "u-casey");
    assert.equal(caseyAfter.body.tasks.find((item) => item.id === task.id)?.canEdit ?? false, false, "removed owner loses edit rights");
  });

  await t.test("edits task name, description and priority", async () => {
    const task = createdTasks.find((item) => item.title === "Research funding opportunities");
    const edit = (body, user = "u-jordan") => request(`/api/tasks/${task.id}`, user, { method: "PATCH", body: JSON.stringify(body) });
    assert.equal((await edit({ priority: "Urgent" })).status, 400);
    assert.equal((await edit({ title: " " })).status, 400);
    assert.equal((await edit({ title: "x".repeat(201) })).status, 400);
    assert.equal((await edit({ priority: "Low" }, "u-casey")).status, 404, "a non-owner employee cannot edit");
    const saved = await edit({ title: "Research grant funding", description: "Shortlist 3 regional grants.", priority: "High" });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const ownerEdit = await edit({ priority: "Medium" }, "u-mary");
    assert.equal(ownerEdit.status, 200, "an owner can edit their task");
    const project = await request(`/api/projects/${createdProjectId}`, "u-jordan");
    const stored = project.body.tasks.find((item) => item.id === task.id);
    assert.equal(stored.title, "Research grant funding");
    assert.equal(stored.description, "Shortlist 3 regional grants.");
    assert.equal(stored.priority, "Medium");
    assert.ok(project.body.activities.some((item) => item.action === "Task edited" && item.details.includes("priority Medium → High")));
    assert.equal((await edit({ priority: "Medium" })).body.unchanged, true);
    createdTasks.find((item) => item.id === task.id).title = stored.title;
  });

  await t.test("stores program and task files and links in Airtable", async () => {
    const task = createdTasks.find((item) => item.title === "Recruit instructors");
    const addLink = (body, user = "u-jordan", taskId = "") => request(`/api/projects/${createdProjectId}/resources/links${taskId ? `?taskId=${taskId}` : ""}`, user, { method: "POST", body: JSON.stringify(body) });
    assert.equal((await addLink({ title: "Bad", url: "javascript:alert(1)" })).status, 400);
    assert.equal((await addLink({ title: "Folder", url: "https://drive.google.com/drive/folders/abc" }, "u-partner")).status, 404, "partners can't add to programs they don't own tasks in");
    const programLink = await addLink({ title: "Shared folder", url: "https://drive.google.com/drive/folders/abc" });
    assert.equal(programLink.status, 201, JSON.stringify(programLink.body));
    assert.equal((await addLink({ url: "https://www.redcross.org/wsi" }, "u-jordan", task.id)).status, 201);

    const upload = (bytes, { user = "u-jordan", name = "Instructor certifications.pdf", taskId = task.id } = {}) =>
      fetch(`${baseUrl}/api/projects/${createdProjectId}/resources/files?taskId=${taskId}&name=${encodeURIComponent(name)}`, {
        method: "POST", headers: { "content-type": "application/pdf", "x-demo-user": user }, body: bytes
      });
    const pdf = Buffer.from("%PDF-1.4 test certificate");
    const uploaded = await upload(pdf);
    assert.equal(uploaded.status, 201, await uploaded.clone().text());
    const tooBig = await upload(Buffer.alloc(5 * 1024 * 1024 + 1));
    assert.equal(tooBig.status, 413);
    assert.match((await tooBig.json()).error, /5 MB/);

    const project = await request(`/api/projects/${createdProjectId}`, "u-jordan");
    const resources = project.body.resources;
    assert.equal(resources.length, 3);
    const file = resources.find((item) => item.kind === "File");
    assert.equal(file.fileName, "Instructor certifications.pdf");
    assert.equal(file.size, pdf.length);
    assert.equal(file.taskId, task.id);
    assert.equal(file.taskTitle, "Recruit instructors");
    assert.equal(file.addedBy, "Jordan Ellis");
    assert.equal(resources.find((item) => item.title === "redcross.org").host, "redcross.org", "a link without a title uses its site name");
    assert.equal(mockAirtable.uploads.length, 1);
    assert.equal(mockAirtable.uploads[0].field, "File");
    // Downloads go through the app, which fetches a fresh Airtable URL.
    const download = await fetch(`${baseUrl}${file.downloadUrl}`, { headers: { "x-demo-user": "u-jordan" } });
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
    assert.ok(project.body.activities.some((item) => item.action === "File uploaded"));

    // Only the person who added it or a manager can remove it.
    const employeeView = await request(`/api/projects/${createdProjectId}`, "u-mary");
    assert.equal(employeeView.body.resources.find((item) => item.id === file.id).canRemove, false);
    assert.equal((await request(`/api/resources/${file.id}`, "u-mary", { method: "DELETE" })).status, 403);
    assert.equal((await request(`/api/resources/${programLink.body.id}`, "u-jordan", { method: "DELETE" })).status, 200);
    const after = await request(`/api/projects/${createdProjectId}`, "u-jordan");
    assert.equal(after.body.resources.length, 2);
  });

  await t.test("blocks task completion until prerequisites are complete", async () => {
    const backgroundCheck = createdTasks.find((task) => task.title === "Complete background checks");
    const recruitInstructors = createdTasks.find((task) => task.title === "Recruit instructors");
    const blocked = await request(`/api/tasks/${backgroundCheck.id}/status`, "u-jordan", {
      method: "PATCH", body: JSON.stringify({ status: "Completed" })
    });
    assert.equal(blocked.status, 409);
    const prerequisite = await request(`/api/tasks/${recruitInstructors.id}/status`, "u-jordan", {
      method: "PATCH", body: JSON.stringify({ status: "Completed" })
    });
    assert.equal(prerequisite.status, 200);
    const nowReady = await request(`/api/projects/${createdProjectId}`, "u-jordan");
    assert.equal(nowReady.body.tasks.find((task) => task.id === backgroundCheck.id).isBlocked, false);
    const completed = await request(`/api/tasks/${backgroundCheck.id}/status`, "u-jordan", {
      method: "PATCH", body: JSON.stringify({ status: "Completed" })
    });
    assert.equal(completed.status, 200);
  });

  await t.test("previews and applies date shifts without moving completed tasks", async () => {
    const before = await request(`/api/projects/${createdProjectId}`, "u-jordan");
    const completedTask = before.body.tasks.find((task) => task.title === "Complete background checks");
    const openTask = before.body.tasks.find((task) => task.status !== "Completed");
    const manualDeadline = plusDays(300);
    const override = await request(`/api/tasks/${openTask.id}/due-date`, "u-jordan", {
      method: "PATCH", body: JSON.stringify({ dueDate: manualDeadline })
    });
    assert.equal(override.status, 200);
    const updatedBefore = await request(`/api/projects/${createdProjectId}`, "u-jordan");
    const overriddenTask = updatedBefore.body.tasks.find((task) => task.id === openTask.id);
    const newStartDate = plusDays(260);
    const preview = await request("/api/projects/date-preview", "u-jordan", {
      method: "POST", body: JSON.stringify({ projectId: createdProjectId, startDate: newStartDate })
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.shiftDays, 10);
    assert.ok(!preview.body.changes.some((change) => change.id === openTask.id));
    assert.ok(!preview.body.changes.some((change) => change.id === completedTask.id));
    const update = await request(`/api/projects/${createdProjectId}/start-date`, "u-jordan", {
      method: "PATCH", body: JSON.stringify({ startDate: newStartDate })
    });
    assert.equal(update.status, 200);
    const afterUpdate = await request(`/api/projects/${createdProjectId}`, "u-jordan");
    assert.equal(afterUpdate.body.tasks.find((task) => task.id === completedTask.id).dueDate, completedTask.dueDate);
    assert.equal(overriddenTask.dueDate, manualDeadline);
    assert.equal(afterUpdate.body.tasks.find((task) => task.id === openTask.id).dueDate, manualDeadline);
    assert.equal(afterUpdate.body.tasks.find((task) => task.id === openTask.id).dueDateOverride, true);
    assert.ok(afterUpdate.body.activities.some((activity) => activity.action === "Timeline updated"));
    assert.ok(afterUpdate.body.activities.some((activity) => activity.action === "Deadline overridden"));
    const employeeOverride = await request(`/api/tasks/${openTask.id}/due-date`, "u-mary", {
      method: "PATCH", body: JSON.stringify({ dueDate: plusDays(301) })
    });
    assert.equal(employeeOverride.status, 403);
  });

  await t.test("enforces role permissions and partner project/task visibility", async () => {
    const cannotCreate = await request("/api/projects", "u-mary", {
      method: "POST", body: JSON.stringify({})
    });
    assert.equal(cannotCreate.status, 403);
    const partnerBootstrap = await request("/api/bootstrap", "u-partner");
    assert.equal(partnerBootstrap.body.users.length, 7);
    assert.ok(partnerBootstrap.body.users.every((user) => !("email" in user)));
    assert.deepEqual(partnerBootstrap.body.projects.map((project) => project.id), ["p-seattle"]);
    assert.deepEqual(partnerBootstrap.body.tasks.map((task) => task.assignedUserId), ["u-partner"]);
    const unrelated = await request("/api/projects/p-tacoma", "u-partner");
    assert.equal(unrelated.status, 404);
    const partnerTask = partnerBootstrap.body.tasks[0];
    const partnerUpdate = await request(`/api/tasks/${partnerTask.id}/status`, "u-partner", {
      method: "PATCH", body: JSON.stringify({ status: "In Progress" })
    });
    assert.equal(partnerUpdate.status, 200);
    const unrelatedTaskComment = await request("/api/tasks/p-seattle-task-2/comments", "u-partner", {
      method: "POST", body: JSON.stringify({ content: "Comment on an unassigned internal task" })
    });
    assert.equal(unrelatedTaskComment.status, 404);
    const partnerProject = await request("/api/projects/p-seattle", "u-partner");
    assert.equal(partnerProject.body.members.length, 1);
    assert.equal(partnerProject.body.tasks.length, 1);
    assert.deepEqual(partnerProject.body.project.details, {});
    const programManagerBootstrap = await request("/api/bootstrap", "u-jordan");
    assert.equal(programManagerBootstrap.body.projects.length, 8);
    assert.ok(programManagerBootstrap.body.projects.some((project) => project.id === "p-portland"));
    const organizationProject = await request("/api/projects/p-portland", "u-jordan");
    assert.equal(organizationProject.status, 200);
    assert.ok(organizationProject.body.tasks.every((task) => task.canEdit === false));
    const forbiddenUpdate = await request(`/api/tasks/${organizationProject.body.tasks[0].id}/status`, "u-jordan", {
      method: "PATCH", body: JSON.stringify({ status: "In Progress" })
    });
    assert.equal(forbiddenUpdate.status, 404);
  });

  await t.test("allows administrators to change reusable template tasks", async () => {
    const before = await request("/api/templates/tpl-clinic", "u-catalina");
    assert.equal(before.status, 200);
    const changed = structuredClone(before.body);
    changed.name = "Updated Swim Safety Clinic";
    changed.tasks[0].title = "Confirm local clinic host";
    changed.tasks[0].relativeDueDays = -61;
    const saved = await request("/api/templates/tpl-clinic", "u-catalina", {
      method: "PATCH", body: JSON.stringify({ name: changed.name, description: changed.description, tasks: changed.tasks })
    });
    assert.equal(saved.status, 200);
    const afterSave = await request("/api/templates/tpl-clinic", "u-catalina");
    assert.equal(afterSave.body.name, changed.name);
    assert.equal(afterSave.body.tasks[0].title, changed.tasks[0].title);
    const programManagerCanRead = await request("/api/templates/tpl-clinic", "u-jordan");
    assert.equal(programManagerCanRead.status, 200);
    const programManagerCanEdit = await request("/api/templates/tpl-clinic", "u-jordan", {
      method: "PATCH", body: JSON.stringify({ name: changed.name, description: changed.description, tasks: changed.tasks })
    });
    assert.equal(programManagerCanEdit.status, 200);
    const unauthorized = await request("/api/templates/tpl-clinic", "u-mary", {
      method: "PATCH", body: JSON.stringify({ name: changed.name, description: changed.description, tasks: changed.tasks })
    });
    assert.equal(unauthorized.status, 403);
  });

  await t.test("requires production sign-in and protects administrator actions", async () => {
    const authAirtable = createMockAirtable({ tables: SCHEMA, rows: templateRows() });
    const authApiRoot = await authAirtable.start();
    const authPort = await availablePort();
    const authUrl = `http://127.0.0.1:${authPort}`;
    const adminEmail = "initial-admin@nmu.test";
    const adminPassword = "test-admin-password-123";
    const authServer = spawn(process.execPath, ["server.js"], {
      cwd: projectRoot,
      env: {
        ...process.env, NODE_ENV: "production", NMU_AUTH_MODE: "required",
        NMU_ADMIN_EMAIL: adminEmail, NMU_ADMIN_PASSWORD: adminPassword, NMU_ADMIN_NAME: "Initial Admin",
        ...airtableEnv(authApiRoot), PORT: String(authPort)
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let serverOutput = "";
    authServer.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
    authServer.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
    const authRequest = async (path, { method = "GET", cookie = "", body, origin = `${authUrl}` } = {}) => {
      const response = await fetch(`${authUrl}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(cookie ? { cookie } : {}),
          ...(origin ? { origin } : {}),
          "x-demo-user": "u-catalina"
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      return { status: response.status, body: await response.json().catch(() => ({})), setCookie: response.headers.get("set-cookie") || "" };
    };
    try {
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        if (authServer.exitCode !== null) throw new Error(`Auth test server exited early:\n${serverOutput}`);
        try {
          const response = await fetch(`${authUrl}/api/auth/config`);
          if (response.ok) { ready = true; break; }
        } catch {}
        await delay(100);
      }
      assert.equal(ready, true, `Auth test server did not start:\n${serverOutput}`);

      const config = await authRequest("/api/auth/config");
      assert.equal(config.body.required, true);
      assert.equal(config.body.administratorConfigured, true);
      const spoofed = await authRequest("/api/bootstrap");
      assert.equal(spoofed.status, 401);
      const wrongOrigin = await authRequest("/api/auth/login", {
        method: "POST", body: { email: adminEmail, password: adminPassword }, origin: "https://attacker.example"
      });
      assert.equal(wrongOrigin.status, 403);
      const badLogin = await authRequest("/api/auth/login", {
        method: "POST", body: { email: adminEmail, password: "incorrect-password" }
      });
      assert.equal(badLogin.status, 401);
      const login = await authRequest("/api/auth/login", {
        method: "POST", body: { email: adminEmail, password: adminPassword }
      });
      assert.equal(login.status, 200);
      assert.match(login.setCookie, /HttpOnly/);
      assert.match(login.setCookie, /SameSite=Strict/);
      assert.match(login.setCookie, /Secure/);
      const adminCookie = login.setCookie.split(";")[0];
      const bootstrap = await authRequest("/api/bootstrap", { cookie: adminCookie });
      assert.equal(bootstrap.status, 200);
      assert.equal(bootstrap.body.currentUser.email, adminEmail);
      assert.equal(bootstrap.body.projects.length, 0);
      const browserBootstrap = await authRequest("/api/bootstrap", { cookie: adminCookie, origin: "" });
      assert.equal(browserBootstrap.status, 200);

      const created = await authRequest("/api/users", {
        method: "POST", cookie: adminCookie,
        body: { name: "Team Member", email: "member@nmu.test", role: "employee", password: "member-test-password-456" }
      });
      assert.equal(created.status, 201);
      assert.ok(!JSON.stringify(created.body).includes("password_hash"));
      const productionProgram = await authRequest("/api/projects", {
        method: "POST", cookie: adminCookie,
        body: {
          name: "Authenticated template program", programType: "Learn to Swim",
          city: "Bellevue", state: "WA", location: "Bellevue, WA",
          hostOrganization: "Bellevue YMCA", deliveryType: "Community",
          startDate: "2030-06-01", endDate: "2030-06-01", templateId: "tpl-community",
          projectManagerId: bootstrap.body.currentUser.id, creationMode: "template",
          programHours: 18, leadInstructors: "Alex Rivera"
        }
      });
      assert.equal(productionProgram.status, 201, JSON.stringify(productionProgram.body));
      assert.equal(productionProgram.body.taskCount, 16);
      const productionDetail = await authRequest(`/api/projects/${productionProgram.body.projectId}`, { cookie: adminCookie });
      assert.equal(productionDetail.status, 200);
      assert.ok(productionDetail.body.tasks.every((task) => task.assigneeName));
      const accountList = await authRequest("/api/users", { cookie: adminCookie });
      assert.equal(accountList.status, 200);
      assert.equal(accountList.body.users.find((item) => item.email === "member@nmu.test").active, true);
      const duplicate = await authRequest("/api/users", {
        method: "POST", cookie: adminCookie,
        body: { name: "Team Member", email: "member@nmu.test", role: "employee", password: "member-test-password-456" }
      });
      assert.equal(duplicate.status, 409);

      const memberLogin = await authRequest("/api/auth/login", {
        method: "POST", body: { email: "member@nmu.test", password: "member-test-password-456" }
      });
      assert.equal(memberLogin.status, 200);
      assert.equal(memberLogin.body.user.role, "employee");
      const memberCookie = memberLogin.setCookie.split(";")[0];
      const changedPassword = await authRequest("/api/auth/password", {
        method: "PATCH", cookie: memberCookie,
        body: { currentPassword: "member-test-password-456", newPassword: "member-updated-password-789" }
      });
      assert.equal(changedPassword.status, 200);
      const oldPasswordLogin = await authRequest("/api/auth/login", {
        method: "POST", body: { email: "member@nmu.test", password: "member-test-password-456" }
      });
      assert.equal(oldPasswordLogin.status, 401);
      const updatedPasswordLogin = await authRequest("/api/auth/login", {
        method: "POST", body: { email: "member@nmu.test", password: "member-updated-password-789" }
      });
      assert.equal(updatedPasswordLogin.status, 200);
      const updatedMemberCookie = updatedPasswordLogin.setCookie.split(";")[0];
      const forbidden = await authRequest("/api/users", {
        method: "POST", cookie: updatedMemberCookie,
        body: { name: "Admin Two", email: "admin-two@nmu.test", role: "admin", password: "another-test-password-789" }
      });
      assert.equal(forbidden.status, 403);
      const disableSelf = await authRequest(`/api/users/${encodeURIComponent(created.body.user.id)}/active`, {
        method: "PATCH", cookie: updatedMemberCookie, body: { active: false }
      });
      assert.equal(disableSelf.status, 403);
      const disableMember = await authRequest(`/api/users/${encodeURIComponent(created.body.user.id)}/active`, {
        method: "PATCH", cookie: adminCookie, body: { active: false }
      });
      assert.equal(disableMember.status, 200);
      const revokedSession = await authRequest("/api/bootstrap", { cookie: updatedMemberCookie });
      assert.equal(revokedSession.status, 401);
      const enableMember = await authRequest(`/api/users/${encodeURIComponent(created.body.user.id)}/active`, {
        method: "PATCH", cookie: adminCookie, body: { active: true }
      });
      assert.equal(enableMember.status, 200);
      const logout = await authRequest("/api/auth/logout", { method: "POST", cookie: adminCookie });
      assert.equal(logout.status, 200);
      const afterLogout = await authRequest("/api/bootstrap", { cookie: adminCookie });
      assert.equal(afterLogout.status, 401);
    } finally {
      if (authServer.exitCode === null) {
        authServer.kill("SIGTERM");
        await new Promise((resolve) => authServer.once("exit", resolve));
      }
      await authAirtable.close();
    }
  });

  await t.test("reads and writes Airtable live, never touching formula or lookup fields", async () => {
    // The NMU base's own Work formulas and lookups, plus a divider table.
    const tables = [
      ...SCHEMA.map((table) => table.name !== T.work ? table : { ...table, fields: [...table.fields,
        { name: "Due Date", type: "formula" }, { name: "Effective Due Date", type: "formula" },
        { name: "Status", type: "multipleLookupValues" }, { name: "Assignee", type: "multipleLookupValues" }] }),
      { name: "Templates ->", fields: [{ name: "Name", type: "singleLineText" }] }
    ];
    const rows = demoRows();
    // Older Work rows have no Planned Due Date and rely on the base's formula.
    const formulaTask = rows[T.work].find((record) => record.id === "p-olympia-task-2");
    delete formulaTask.fields["Planned Due Date"];
    const computed = {
      [T.work]: (fields, { get }) => {
        const session = get(T.sessions, fields.Session?.[0]);
        const step = get(T.steps, fields.Steps?.[0]);
        let due = null;
        if (session?.fields["Start Date"] && step) {
          const date = new Date(`${session.fields["Start Date"]}T12:00:00Z`);
          date.setUTCDate(date.getUTCDate() + step.fields.Days);
          due = date.toISOString().slice(0, 10);
        }
        return { "Due Date": due, "Effective Due Date": fields["Due Date Override"] || due, Status: fields["Task Status"] ? [fields["Task Status"]] : [] };
      }
    };
    const base = createMockAirtable({ tables, rows, computed });
    const apiRoot = await base.start();
    const port = await availablePort();
    const url = `http://127.0.0.1:${port}`;
    const app = spawn(process.execPath, ["server.js"], {
      cwd: projectRoot, env: { ...process.env, NODE_ENV: "test", NMU_AUTH_MODE: "", PORT: String(port), ...airtableEnv(apiRoot) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    app.stdout.on("data", (chunk) => { output += chunk; });
    app.stderr.on("data", (chunk) => { output += chunk; });
    const call = async (path, user = "u-catalina", options = {}) => {
      const response = await fetch(`${url}${path}`, { ...options, headers: { "content-type": "application/json", "x-demo-user": user } });
      return { status: response.status, body: await response.json() };
    };
    try {
      for (let attempt = 0; attempt < 60; attempt++) {
        if (app.exitCode !== null) throw new Error(`Server exited early:\n${output}`);
        try { if ((await fetch(`${url}/api/auth/config`)).ok) break; } catch {}
        await delay(100);
      }
      const olympia = await call("/api/projects/p-olympia", "u-jordan");
      const fromFormula = olympia.body.tasks.find((task) => task.id === "p-olympia-task-2");
      assert.equal(fromFormula.dueDate, base.read(T.work, "p-olympia-task-2").fields["Effective Due Date"]);

      // Status, owners, edits, deadline overrides and timeline shifts all go to Airtable.
      const task = olympia.body.tasks.find((item) => item.id === "p-olympia-task-3");
      assert.equal((await call(`/api/tasks/${task.id}/status`, "u-jordan", { method: "PATCH", body: JSON.stringify({ status: "In Progress" }) })).status, 200);
      assert.equal(base.record(T.work, task.id).fields["Task Status"], "In Progress");
      assert.equal((await call(`/api/tasks/${task.id}/assignees`, "u-jordan", { method: "PATCH", body: JSON.stringify({ assignedUserIds: ["u-sam", "u-mary"] }) })).status, 200);
      assert.deepEqual(base.record(T.work, task.id).fields["Assigned To"], ["u-sam", "u-mary"]);
      assert.equal((await call(`/api/tasks/${task.id}/due-date`, "u-jordan", { method: "PATCH", body: JSON.stringify({ dueDate: "2031-01-15" }) })).status, 200);
      assert.equal(base.record(T.work, task.id).fields["Due Date Override"], "2031-01-15");
      assert.equal((await call(`/api/tasks/${task.id}/status`, "u-jordan", { method: "PATCH", body: JSON.stringify({ status: "Completed" }) })).status, 200);
      assert.match(base.record(T.work, task.id).fields["Completed Date"], /^\d{4}-\d{2}-\d{2}/);
      const start = olympia.body.project.startDate;
      const newStart = new Date(Date.parse(`${start}T12:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
      assert.equal((await call("/api/projects/p-olympia/start-date", "u-jordan", { method: "PATCH", body: JSON.stringify({ startDate: newStart }) })).status, 200);
      assert.equal(base.record(T.sessions, "p-olympia").fields["Start Date"], newStart);
      // The formula-based task now has a Planned Due Date a week later.
      assert.equal(base.record(T.work, "p-olympia-task-2").fields["Planned Due Date"],
        new Date(Date.parse(`${fromFormula.dueDate}T12:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10));

      const workWrites = base.writes.filter((write) => write.table === T.work && write.method !== "DELETE");
      assert.ok(workWrites.length >= 5);
      const written = new Set(workWrites.flatMap((write) => write.records.flatMap((record) => Object.keys(record.fields))));
      for (const forbidden of ["Due Date", "Effective Due Date", "Status", "Assignee"]) assert.ok(!written.has(forbidden), `${forbidden} must never be written`);
      assert.ok(workWrites.every((write) => write.records.length <= 10), "writes are batched by 10");

      // A change made directly in Airtable shows up on the next request.
      base.record(T.work, "p-olympia-task-1").fields["Task Name"] = "Edited in Airtable";
      const live = await call("/api/bootstrap", "u-jordan");
      assert.ok(live.body.tasks.some((item) => item.id === "p-olympia-task-1" && item.title === "Edited in Airtable"));
      assert.ok(live.body.integration.lastWrite);
      assert.equal(live.body.integration.airtableConfigured, true);

      // A rate-limited request is retried rather than failing.
      base.failNext(1, 429);
      assert.equal((await call("/api/bootstrap")).status, 200);

      const schema = await call("/api/integrations/airtable/schema");
      assert.equal(schema.status, 200);
      assert.deepEqual(schema.body.missingTables, []);
      assert.deepEqual(schema.body.missingFields, []);
      assert.deepEqual(schema.body.readOnlyConflicts, []);
      const status = await call("/api/integrations/airtable/status", "u-mary");
      assert.equal(status.status, 200);
      assert.deepEqual(status.body.recentFailures, []);
      const browse = await call("/api/integrations/airtable/tables");
      assert.equal(browse.status, 200);
      const steps = browse.body.tables.find((table) => table.name === T.steps);
      assert.equal(steps.recordCount, 34);
      const records = await call(`/api/integrations/airtable/tables/${steps.id}/records?limit=5&q=instructors`);
      assert.equal(records.status, 200);
      assert.ok(records.body.total >= 3 && records.body.records.length <= 5);
      assert.equal(records.body.recordLabels["tpl-community"], "Community Swim Program");
      assert.equal((await call("/api/integrations/airtable/tables", "u-mary")).status, 403);
    } finally {
      if (app.exitCode === null) {
        app.kill("SIGTERM");
        await new Promise((resolve) => app.once("exit", resolve));
      }
      await base.close();
    }
  });
});
