import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { AirtableError, airtableClientFromEnv } from "./airtable-client.js";
import { createAirtableStore, DIVIDER_TABLES, isValidDate, addDays, daysBetween, ROLES } from "./airtable-store.js";
import { createAuth } from "./auth.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const env = process.env;
const numberEnv = (name, fallback) => (env[name] !== undefined && env[name] !== "" ? Number(env[name]) : fallback);

const client = airtableClientFromEnv(env, {
  minIntervalMs: numberEnv("NMU_AIRTABLE_MIN_INTERVAL_MS", 210),
  retryBaseMs: numberEnv("NMU_AIRTABLE_RETRY_BASE_MS", 1000)
});
const store = createAirtableStore({
  client,
  cacheMs: numberEnv("NMU_AIRTABLE_CACHE_MS", 15_000),
  schemaCacheMs: numberEnv("NMU_AIRTABLE_SCHEMA_CACHE_MS", 300_000)
});
let auth;
try {
  auth = createAuth({ env, findUserByEmail: (email) => store.findUserByEmail(email) });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const roleLabel = { admin: ROLES.admin, manager: ROLES.manager, contributor: ROLES.contributor };
const isManager = (user) => user.role === "admin" || user.role === "manager";
const isAdmin = (user) => user.role === "admin";
const canSeeProject = (user, projectId, tasks) => isManager(user)
  || tasks.some((task) => task.projectId === projectId && task.assignedUserId === user.id);
const canEditTaskStatus = (user, task) => isManager(user) || task.assignedUserId === user.id;

function send(response, status, body, contentType = "application/json; charset=utf-8") {
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  response.end(contentType.startsWith("application/json") ? JSON.stringify(body) : body);
}
function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 })); }
    });
    request.on("error", reject);
  });
}
function verifySameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return ["GET", "HEAD", "OPTIONS"].includes(request.method) || auth.mode === "dev";
  try { return new URL(origin).host === request.headers.host; } catch { return false; }
}
// Activity and notifications are secondary: a failure there must not undo the
// primary Airtable write that already succeeded, so it is logged instead.
async function sideEffect(label, action) {
  try { await action(); } catch (error) { console.error(`${label} failed: ${error.message}`); }
}
const decodeSegment = (value) => { try { return decodeURIComponent(value); } catch { return null; } };
const routeId = (path, prefix, suffix = "") => path.startsWith(prefix) && path.endsWith(suffix) && path.length > prefix.length + suffix.length
  ? decodeSegment(path.slice(prefix.length, suffix ? -suffix.length : undefined)) : null;

const publicUser = (user) => ({ id: user.id, name: user.name, role: user.role });
function visibleProjects(user, model) {
  return model.projects.filter((project) => canSeeProject(user, project.id, model.tasks));
}
function taskResponse(task, user, project) {
  return { ...task, projectName: project?.name, projectStatus: project?.status, canEdit: canEditTaskStatus(user, task) };
}

async function handleApi(request, response, url) {
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/auth/config") {
    return send(response, 200, auth.publicConfig());
  }
  if (!verifySameOrigin(request)) return send(response, 403, { error: "Request origin was not allowed." });
  if (request.method === "POST" && path === "/api/auth/logout") {
    auth.clearSession(response);
    return send(response, 200, { ok: true });
  }
  const user = await auth.currentUser(request);
  if (!user) return send(response, 401, { error: "Sign in to continue." });

  if (request.method === "GET" && path === "/api/bootstrap") {
    const model = await store.workspace();
    const projects = visibleProjects(user, model);
    const visible = new Set(projects.map((project) => project.id));
    const tasks = model.tasks.filter((task) => visible.has(task.projectId))
      .map((task) => taskResponse(task, user, model.projectsById.get(task.projectId)));
    return send(response, 200, {
      currentUser: { ...user, roleLabel: roleLabel[user.role] },
      users: model.users.filter((item) => item.role).map(publicUser),
      projects, tasks,
      notifications: await store.notificationsForUser(user.id),
      templates: model.templates.map(({ id, name, steps }) => ({ id, name, stepCount: steps.length, steps: steps.map(({ title, days }) => ({ title, days })) })),
      sites: model.sites,
      integration: { airtableConfigured: client.configured }
    });
  }
  if (request.method === "GET" && path === "/api/projects") {
    return send(response, 200, visibleProjects(user, await store.workspace()));
  }
  if (request.method === "GET" && path === "/api/users") {
    if (!isAdmin(user)) return send(response, 403, { error: "Only administrators can view team access." });
    return send(response, 200, { users: (await store.users()).map((item) => ({ ...item, roleLabel: roleLabel[item.role] || "No access" })) });
  }
  if (request.method === "POST" && path === "/api/projects/date-preview") {
    if (!isManager(user)) return send(response, 403, { error: "You cannot adjust this program timeline." });
    const input = await readBody(request);
    const model = await store.workspace();
    const project = model.projectsById.get(input.projectId);
    if (!project) return send(response, 404, { error: "Project not found." });
    if (!isValidDate(input.startDate) || !project.startDate) return send(response, 400, { error: "Enter a valid program start date." });
    const shift = daysBetween(project.startDate, input.startDate);
    const changes = model.tasks.filter((task) => task.projectId === project.id && task.status !== "Completed" && !task.dueDateOverride && task.dueDate)
      .map((task) => ({ id: task.id, title: task.title, oldDate: task.dueDate, newDate: addDays(task.dueDate, shift) }));
    return send(response, 200, { shiftDays: shift, changes });
  }
  if (request.method === "POST" && path === "/api/projects") {
    if (!isManager(user)) return send(response, 403, { error: "You do not have permission to create programs." });
    const input = await readBody(request);
    const sessionName = String(input.name || "").trim();
    if (!sessionName || sessionName.length > 200 || !input.siteId || !input.templateId) {
      return send(response, 400, { error: "Enter a session name and choose a site and template." });
    }
    if (!isValidDate(input.startDate) || !isValidDate(input.endDate) || input.endDate < input.startDate) {
      return send(response, 400, { error: "Enter valid program dates; the end date must be on or after the start date." });
    }
    const result = await store.createProject({
      sessionName, siteId: input.siteId, startDate: input.startDate, endDate: input.endDate, templateId: input.templateId
    });
    await sideEffect("Activity log", () => store.logActivity({
      projectId: result.projectId, userId: user.id, action: "Project created",
      details: `${sessionName} created from ${result.template.name} with ${result.tasks.length} tasks.`
    }));
    await sideEffect("Notifications", () => store.notify(result.tasks
      .filter((task) => task.assignedUserId && task.assignedUserId !== user.id)
      .map((task) => ({ userId: task.assignedUserId, projectId: result.projectId, message: `New task assigned: ${task.title} — ${sessionName}` }))));
    return send(response, 201, { projectId: result.projectId, taskCount: result.tasks.length });
  }
  const startDateProjectId = request.method === "PATCH" ? routeId(path, "/api/projects/", "/start-date") : null;
  if (startDateProjectId) {
    if (!isManager(user)) return send(response, 403, { error: "You cannot adjust this program timeline." });
    const input = await readBody(request);
    if (!isValidDate(input.startDate)) return send(response, 400, { error: "Enter a valid program start date." });
    const model = await store.workspace();
    const project = model.projectsById.get(startDateProjectId);
    if (!project || !project.startDate) return send(response, 404, { error: "Project not found." });
    const projectTasks = model.tasks.filter((task) => task.projectId === project.id);
    const moved = projectTasks.filter((task) => task.status !== "Completed" && !task.dueDateOverride).length;
    await store.shiftProjectStart(project, projectTasks, input.startDate);
    await sideEffect("Activity log", () => store.logActivity({
      projectId: project.id, userId: user.id, action: "Timeline updated",
      details: `Program start date changed from ${project.startDate} to ${input.startDate}. ${moved} task dates follow the new start; completed and manually overridden dates are preserved.`
    }));
    const members = new Set(projectTasks.map((task) => task.assignedUserId).filter((id) => id && id !== user.id));
    await sideEffect("Notifications", () => store.notify([...members].map((memberId) => ({
      userId: memberId, projectId: project.id, message: `Program timeline updated: ${project.name}`
    }))));
    return send(response, 200, { ok: true });
  }
  if (request.method === "GET" && path.startsWith("/api/projects/")) {
    const projectId = routeId(path, "/api/projects/");
    const model = await store.workspace();
    const project = model.projectsById.get(projectId);
    if (!project || !canSeeProject(user, project.id, model.tasks)) return send(response, 404, { error: "Project not found." });
    const tasks = model.tasks.filter((task) => task.projectId === project.id).map((task) => taskResponse(task, user, project));
    const memberIds = [...new Set(tasks.map((task) => task.assignedUserId).filter(Boolean))];
    const members = memberIds.map((id) => model.usersById.get(id)).filter(Boolean)
      .map((member) => ({ ...publicUser(member), email: member.email, projectRole: roleLabel[member.role] || "Team member" }));
    const [activities, comments] = await Promise.all([
      store.activityForProject(project.id, model.usersById),
      store.commentsForTasks(tasks.map((task) => task.id), model.usersById)
    ]);
    return send(response, 200, { project, members, tasks, activities, comments: comments.slice(0, 30) });
  }

  const taskRoute = (suffix) => (path.startsWith("/api/tasks/") ? routeId(path, "/api/tasks/", suffix) : null);
  const loadTask = async (taskId) => {
    const model = await store.workspace();
    const task = model.tasks.find((item) => item.id === taskId);
    const visible = task && canSeeProject(user, task.projectId, model.tasks);
    return { model, task: visible ? task : null };
  };

  const statusTaskId = request.method === "PATCH" ? taskRoute("/status") : null;
  if (statusTaskId) {
    const { model, task } = await loadTask(statusTaskId);
    if (!task || !canEditTaskStatus(user, task)) return send(response, 404, { error: "Task not found or you do not have permission to update it." });
    const input = await readBody(request);
    if (!["Not Started", "In Progress", "Completed"].includes(input.status)) return send(response, 400, { error: "Choose a valid task status." });
    const overrideReason = String(input.overrideReason || "").trim().slice(0, 500);
    if (input.status === "Completed") {
      const incomplete = task.dependencies.filter((item) => item.status !== "Completed");
      if (incomplete.length && !(isAdmin(user) && overrideReason)) {
        return send(response, 409, { error: "Complete prerequisite tasks before marking this task done.", prerequisites: incomplete.map((item) => item.title) });
      }
      if (incomplete.length) {
        await sideEffect("Activity log", () => store.logActivity({
          projectId: task.projectId, taskId: task.id, userId: user.id, action: "Dependency override", details: `Authorized override: ${overrideReason}`
        }));
      }
    }
    if (input.status === task.status) return send(response, 200, { ok: true, unchanged: true });
    await store.setTaskStatus(task.id, input.status);
    await sideEffect("Activity log", () => store.logActivity({
      projectId: task.projectId, taskId: task.id, userId: user.id, action: "Status changed", details: `${task.title}: ${task.status} → ${input.status}.`
    }));
    if (input.status === "Completed") {
      const ready = model.tasks.filter((item) => item.projectId === task.projectId && item.status === "Not Started"
        && item.dependencies.some((dependency) => dependency.id === task.id)
        && item.dependencies.every((dependency) => dependency.status === "Completed" || dependency.id === task.id));
      await sideEffect("Notifications", () => store.notify(ready.map((item) => ({
        userId: item.assignedUserId || user.id, projectId: task.projectId, message: `Task is now ready: ${item.title}`
      }))));
    }
    return send(response, 200, { ok: true });
  }
  const dueDateTaskId = request.method === "PATCH" ? taskRoute("/due-date") : null;
  if (dueDateTaskId) {
    if (!isManager(user)) return send(response, 403, { error: "Only managers can override task deadlines." });
    const { task } = await loadTask(dueDateTaskId);
    if (!task) return send(response, 404, { error: "Task not found." });
    const input = await readBody(request);
    if (input.dueDate !== null && !isValidDate(input.dueDate)) return send(response, 400, { error: "Enter a valid task deadline." });
    await store.setDueDateOverride(task.id, input.dueDate);
    await sideEffect("Activity log", () => store.logActivity({
      projectId: task.projectId, taskId: task.id, userId: user.id,
      action: input.dueDate ? "Deadline overridden" : "Deadline override cleared",
      details: input.dueDate
        ? `${task.title}: ${task.dueDate || "no date"} → ${input.dueDate}. This date is kept when the program timeline changes.`
        : `${task.title} follows the template due date again.`
    }));
    return send(response, 200, { ok: true });
  }
  const assigneeTaskId = request.method === "PATCH" ? taskRoute("/assignee") : null;
  if (assigneeTaskId) {
    if (!isManager(user)) return send(response, 403, { error: "Only managers can reassign tasks." });
    const { model, task } = await loadTask(assigneeTaskId);
    if (!task) return send(response, 404, { error: "Task not found." });
    const input = await readBody(request);
    const assignee = model.usersById.get(input.assignedUserId);
    if (!assignee || !assignee.role) return send(response, 400, { error: "Choose a team member with access to the app." });
    if (assignee.id === task.assignedUserId) return send(response, 200, { ok: true, unchanged: true });
    await store.assignTask(task.id, assignee.id);
    await sideEffect("Activity log", () => store.logActivity({
      projectId: task.projectId, taskId: task.id, userId: user.id, action: "Task reassigned", details: `${task.title} reassigned to ${assignee.name}.`
    }));
    await sideEffect("Notifications", () => store.notify([{ userId: assignee.id, projectId: task.projectId, message: `New task assigned: ${task.title}` }]));
    return send(response, 200, { ok: true });
  }
  const commentTaskId = request.method === "POST" ? taskRoute("/comments") : null;
  if (commentTaskId) {
    const { task } = await loadTask(commentTaskId);
    if (!task) return send(response, 404, { error: "Task not found." });
    const input = await readBody(request);
    const content = String(input.content || "").trim();
    if (!content || content.length > 2000) return send(response, 400, { error: "Enter a comment of 1–2,000 characters." });
    await store.addComment({ taskId: task.id, userId: user.id, content });
    await sideEffect("Activity log", () => store.logActivity({
      projectId: task.projectId, taskId: task.id, userId: user.id, action: "Comment added", details: content
    }));
    return send(response, 201, { ok: true });
  }
  const notificationId = request.method === "PATCH" ? routeId(path, "/api/notifications/") : null;
  if (notificationId) {
    return (await store.markNotificationRead(notificationId, user.id))
      ? send(response, 200, { ok: true })
      : send(response, 404, { error: "Notification not found." });
  }

  if (path.startsWith("/api/integrations/airtable/") && !isAdmin(user)) {
    return send(response, 403, { error: "Only administrators can inspect the Airtable connection." });
  }
  if (request.method === "GET" && path === "/api/integrations/airtable/schema") {
    const result = await store.checkSchema();
    return send(response, 200, { ...result, dividerTables: DIVIDER_TABLES });
  }
  if (request.method === "GET" && path === "/api/integrations/airtable/tables") {
    const tables = (await store.schema()).filter((table) => !DIVIDER_TABLES.includes(table.name));
    return send(response, 200, { tables: tables.map(({ id, name, fields }) => ({ id, name, fields })) });
  }
  const browseTableId = request.method === "GET" ? routeId(path, "/api/integrations/airtable/tables/", "/records") : null;
  if (browseTableId) {
    const limitValue = Number.parseInt(url.searchParams.get("limit") || "25", 10);
    const offsetValue = Number.parseInt(url.searchParams.get("offset") || "0", 10);
    const limit = Number.isSafeInteger(limitValue) ? Math.min(100, Math.max(1, limitValue)) : 25;
    const offset = Number.isSafeInteger(offsetValue) ? Math.max(0, offsetValue) : 0;
    const query = String(url.searchParams.get("q") || "").trim().slice(0, 200);
    const result = await store.browseTable(browseTableId, { query, limit, offset });
    if (!result) return send(response, 404, { error: "Airtable table not found." });
    return send(response, 200, { ...result, limit, offset, query });
  }
  return send(response, 404, { error: "API route not found." });
}

function apiError(response, error) {
  if (error instanceof AirtableError) {
    const status = [401, 403, 404, 422].includes(error.status) ? 502 : error.status === 429 ? 503 : error.status || 502;
    console.error(`Airtable request failed (${error.status}): ${error.message}`);
    return send(response, status, { error: error.message });
  }
  if (error.status && error.status < 500) return send(response, error.status, { error: error.message });
  console.error(error);
  return send(response, 500, { error: error.message || "Unexpected server error." });
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml"
};
const server = createServer(async (request, response) => {
  let pathname = "";
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    pathname = url.pathname;
    if (pathname.startsWith("/api/")) return await handleApi(request, response, url);
    if (pathname.startsWith("/auth/")) {
      if (await auth.handleRoute(request, response, url)) return;
      return send(response, 404, "Not found.", "text/plain; charset=utf-8");
    }
    const requestedPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
    const filePath = normalize(join(publicDir, requestedPath));
    if (filePath !== publicDir && !filePath.startsWith(`${publicDir}/`)) return send(response, 403, "Forbidden", "text/plain; charset=utf-8");
    const content = await readFile(filePath);
    return send(response, 200, content, mimeTypes[extname(filePath)] || "application/octet-stream");
  } catch (error) {
    if (error.code === "ENOENT" && pathname && !pathname.startsWith("/api/")) {
      return send(response, 404, "Not found.", "text/plain; charset=utf-8");
    }
    if (response.headersSent) return response.end();
    if (pathname.startsWith("/api/") || pathname.startsWith("/auth/")) return apiError(response, error);
    console.error(error);
    return send(response, 500, "Unexpected server error.", "text/plain; charset=utf-8");
  }
});
const port = Number(env.PORT || 3000);
server.listen(port, "0.0.0.0", () => console.log(`NMU Program Management running at http://localhost:${port} (auth: ${auth.mode})`));
