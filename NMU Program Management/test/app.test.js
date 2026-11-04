import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
let serverProcess;
let baseUrl;
let temporaryDirectory;

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
  temporaryDirectory = await mkdtemp(join(tmpdir(), "nmu-pm-test-"));
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port), NMU_DATABASE_PATH: join(temporaryDirectory, "test.sqlite") },
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
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
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
    const unauthorized = await request("/api/templates/tpl-clinic", "u-jordan", {
      method: "PATCH", body: JSON.stringify({ name: changed.name, description: changed.description, tasks: changed.tasks })
    });
    assert.equal(unauthorized.status, 403);
  });
});
