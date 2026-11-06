// Airtable is the system of record. This module maps Airtable tables to the app's
// projects, tasks, comments, activity log, notifications and users. It never calls
// the Airtable HTTP API itself; every request goes through airtable-client.js.
//
// Table and field names live in TABLES/FIELDS below. If a name in the base differs,
// change it here; "Check schema access" in Settings reports anything missing.

export const TABLES = Object.freeze({
  users: "Users",
  templates: "Template List",
  roles: "Roles",
  steps: "Steps",
  region: "Region",
  sites: "Site",
  sessions: "Session",
  instructors: "Instructors",
  work: "Work",
  comments: "Comments",
  activity: "Activity Log",
  notifications: "Notifications"
});
// "Templates ->", "Programs ->" and "WIP ->" only group the Airtable sidebar.
export const DIVIDER_TABLES = Object.freeze(["Templates ->", "Programs ->", "WIP ->"]);
export const REQUIRED_TABLES = Object.freeze(Object.values(TABLES));

// Work fields. "Due Date", "Status" and "Assignee" are formula/lookup fields: the app
// reads Due Date only as a fallback and never writes any of the three.
export const WORK_FIELDS = Object.freeze({
  unique: "Unique",
  steps: "Steps",
  session: "Session",
  status: "Task Status",
  effectiveDueDate: "Effective Due Date",
  dueDateOverride: "Due Date Override",
  dueDate: "Due Date",
  assignedTo: "Assigned To",
  completedDate: "Completed Date"
});
export const WORK_WRITABLE_FIELDS = Object.freeze([
  WORK_FIELDS.status, WORK_FIELDS.dueDateOverride, WORK_FIELDS.assignedTo, WORK_FIELDS.completedDate
]);
// New Work rows also need their Steps and Session links.
const WORK_CREATE_FIELDS = Object.freeze([...WORK_WRITABLE_FIELDS, WORK_FIELDS.steps, WORK_FIELDS.session]);
export const WORK_COMPUTED_FIELDS = Object.freeze(["Due Date", "Status", "Assignee"]);

export const FIELDS = Object.freeze({
  users: { email: "Email Address", firstName: "First Name", lastName: "Last Name", rights: "Rights" },
  templates: { name: "List Name (Unique)", steps: "Steps" },
  roles: { name: "Role Name", users: "Users" },
  steps: {
    unique: "Unique", title: "Short Description", description: "Long Description", days: "Days",
    dependencies: ["Dependencies", "Dependancies"], roles: "Roles", template: "Template"
  },
  sites: { programName: "Program Name", location: "Program Location", regionSite: "Region Site" },
  sessions: {
    name: "Session Name", startDate: "Start Date", endDate: "End Date",
    duration: "Duration (Days)", site: "Site", status: "Status"
  },
  work: WORK_FIELDS,
  comments: { text: "Comment", work: "Work", author: "Author" },
  activity: { action: "Action", details: "Details", session: "Session", work: "Work", user: "User" },
  notifications: { message: "Message", user: "User", session: "Session", read: "Read" }
});

// Fields that must exist for the app to work, checked by "Check schema access".
export const REQUIRED_FIELDS = Object.freeze({
  [TABLES.users]: [FIELDS.users.email, FIELDS.users.firstName, FIELDS.users.lastName, FIELDS.users.rights],
  [TABLES.templates]: [FIELDS.templates.steps],
  [TABLES.steps]: [FIELDS.steps.title, FIELDS.steps.description, FIELDS.steps.days],
  [TABLES.sites]: [FIELDS.sites.programName, FIELDS.sites.location],
  [TABLES.sessions]: [FIELDS.sessions.name, FIELDS.sessions.startDate, FIELDS.sessions.site],
  [TABLES.work]: [WORK_FIELDS.steps, WORK_FIELDS.session, WORK_FIELDS.status, WORK_FIELDS.dueDateOverride,
    WORK_FIELDS.assignedTo, WORK_FIELDS.completedDate],
  [TABLES.comments]: Object.values(FIELDS.comments),
  [TABLES.activity]: Object.values(FIELDS.activity),
  [TABLES.notifications]: Object.values(FIELDS.notifications)
});

const COMPUTED_TYPES = new Set([
  "formula", "rollup", "multipleLookupValues", "lookup", "count", "autoNumber", "createdTime",
  "lastModifiedTime", "createdBy", "lastModifiedBy", "button", "externalSyncSource", "aiText"
]);
export const ROLES = Object.freeze({ admin: "Admin", manager: "Manager", contributor: "Contributor" });

// ---------------------------------------------------------------- value helpers

// The REST API returns linked records as ["recXXX"]; some tools return [{ id }].
export function linkedRecordIds(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item : item?.id))
    .filter((id) => typeof id === "string" && id.startsWith("rec"));
}
export function textValue(value) {
  if (Array.isArray(value)) return textValue(value[0]);
  if (value && typeof value === "object") return String(value.name ?? value.email ?? "").trim();
  return value === null || value === undefined ? "" : String(value).trim();
}
export function dateValue(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const date = String(raw).slice(0, 10);
  return isValidDate(date) ? date : null;
}
function numberValue(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}
export function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function addDays(date, days) {
  const result = new Date(`${date}T12:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + Number(days));
  return result.toISOString().slice(0, 10);
}
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

// Effective Due Date, then Due Date Override, then the formula Due Date.
export function workDueDate(fields = {}) {
  return dateValue(fields[WORK_FIELDS.effectiveDueDate])
    || dateValue(fields[WORK_FIELDS.dueDateOverride])
    || dateValue(fields[WORK_FIELDS.dueDate]);
}

export function assertWorkWriteFields(records, { creating = false } = {}) {
  const allowed = creating ? WORK_CREATE_FIELDS : WORK_WRITABLE_FIELDS;
  for (const record of records) {
    for (const name of Object.keys(record.fields || {})) {
      if (!allowed.includes(name)) {
        throw new Error(`The app may not write Work.${name}; writable fields are ${allowed.join(", ")}.`);
      }
    }
  }
}

export function airtableStatusToApp(value) {
  const normalized = textValue(value).toLowerCase();
  if (["complete", "completed", "done"].includes(normalized)) return "Completed";
  if (["in progress", "in-progress", "started", "active"].includes(normalized)) return "In Progress";
  if (["blocked", "on hold", "on-hold"].includes(normalized)) return "Blocked";
  return "Not Started";
}

export function appStatusToAirtable(value, choices = []) {
  const expected = String(value || "").toLowerCase();
  const aliases = {
    "not started": ["not started", "not begun", "to do", "todo", "open"],
    "in progress": ["in progress", "started", "active"],
    blocked: ["blocked", "on hold", "on-hold"],
    completed: ["completed", "complete", "done"]
  };
  const allowed = choices.map((choice) => String(choice));
  if (!allowed.length) return value;
  const match = allowed.find((choice) => (aliases[expected] || [expected]).includes(choice.toLowerCase()));
  if (!match) throw new Error(`Airtable Work.${WORK_FIELDS.status} has no option matching "${value}".`);
  return match;
}

export function sessionStatusToApp(value) {
  const status = textValue(value).toLowerCase();
  if (status.includes("complete") || status.includes("done")) return "Completed";
  if (status.includes("risk")) return "At Risk";
  if (status.includes("track") || status.includes("active")) return "On Track";
  return "Planning";
}

// Users.Rights → app role. Unknown or empty rights grant no access.
export function rightsToRole(value) {
  const values = (Array.isArray(value) ? value : [value]).map((item) => textValue(item).toLowerCase());
  if (values.includes("admin")) return "admin";
  if (values.includes("manager")) return "manager";
  if (values.includes("contributor")) return "contributor";
  return null;
}

// ---------------------------------------------------------------- store

export function createAirtableStore({ client, cacheMs = 15_000, schemaCacheMs = 300_000, now = () => new Date() }) {
  const cache = new Map();
  let schemaCache = null;

  async function loadTable(table) {
    const cached = cache.get(table);
    if (cached && (cached.promise || cached.expires > Date.now())) return cached.promise || cached.records;
    const promise = client.listRecords(table).then((records) => {
      cache.set(table, { records, expires: Date.now() + cacheMs });
      return records;
    }, (error) => {
      cache.delete(table);
      throw error;
    });
    cache.set(table, { promise });
    return promise;
  }
  const invalidate = (...tables) => tables.forEach((table) => cache.delete(table));

  async function schema() {
    if (schemaCache && schemaCache.expires > Date.now()) return schemaCache.tables;
    const tables = await client.getSchema();
    schemaCache = { tables, expires: Date.now() + schemaCacheMs };
    return tables;
  }
  async function tableSchema(name) {
    return (await schema()).find((table) => table.name === name || table.id === name) || null;
  }
  async function fieldSchema(tableName, fieldName) {
    return (await tableSchema(tableName))?.fields.find((field) => field.name === fieldName) || null;
  }
  // Refuse to write fields that are missing or computed in the live schema.
  async function assertWritable(tableName, fieldNames) {
    const table = await tableSchema(tableName);
    if (!table) throw new Error(`The Airtable base has no "${tableName}" table.`);
    for (const name of fieldNames) {
      const field = table.fields.find((item) => item.name === name);
      if (!field) throw new Error(`Airtable table "${tableName}" has no field "${name}".`);
      if (COMPUTED_TYPES.has(field.type)) throw new Error(`Airtable field ${tableName}.${name} is computed (${field.type}) and cannot be written.`);
    }
  }
  async function create(tableName, records, { creatingWork = false } = {}) {
    if (tableName === TABLES.work) assertWorkWriteFields(records, { creating: creatingWork });
    await assertWritable(tableName, [...new Set(records.flatMap((record) => Object.keys(record.fields)))]);
    try { return await client.createRecords(tableName, records); } finally { invalidate(tableName); }
  }
  async function update(tableName, records) {
    if (!records.length) return [];
    if (tableName === TABLES.work) assertWorkWriteFields(records);
    await assertWritable(tableName, [...new Set(records.flatMap((record) => Object.keys(record.fields)))]);
    try { return await client.updateRecords(tableName, records); } finally { invalidate(tableName); }
  }
  async function dateForField(tableName, fieldName) {
    const field = await fieldSchema(tableName, fieldName);
    const timestamp = now().toISOString();
    return field?.type === "dateTime" ? timestamp : timestamp.slice(0, 10);
  }

  // ------------------------------------------------------------ users

  function toUser(record) {
    const fields = record.fields || {};
    const email = textValue(fields[FIELDS.users.email]).toLowerCase();
    const name = [textValue(fields[FIELDS.users.firstName]), textValue(fields[FIELDS.users.lastName])]
      .filter(Boolean).join(" ") || email || record.id;
    return { id: record.id, email, name, role: rightsToRole(fields[FIELDS.users.rights]) };
  }
  async function users() {
    return (await loadTable(TABLES.users)).map(toUser);
  }
  async function findUserByEmail(email) {
    const wanted = String(email || "").trim().toLowerCase();
    if (!wanted) return null;
    return (await users()).find((user) => user.email === wanted) || null;
  }

  // ------------------------------------------------------------ workspace

  async function workspace() {
    const [userRecords, siteRecords, sessionRecords, stepRecords, workRecords, templateRecords] = await Promise.all([
      loadTable(TABLES.users), loadTable(TABLES.sites), loadTable(TABLES.sessions),
      loadTable(TABLES.steps), loadTable(TABLES.work), loadTable(TABLES.templates)
    ]);
    const allUsers = userRecords.map(toUser);
    const usersById = new Map(allUsers.map((user) => [user.id, user]));
    const sitesById = new Map(siteRecords.map((record) => [record.id, record]));
    const stepsById = new Map(stepRecords.map((record) => [record.id, record]));
    const dependencyField = (fields) => FIELDS.steps.dependencies.find((name) => name in fields);

    const sites = siteRecords.map((record) => ({
      id: record.id,
      name: textValue(record.fields?.[FIELDS.sites.programName]) || textValue(record.fields?.[FIELDS.sites.regionSite]) || record.id,
      location: textValue(record.fields?.[FIELDS.sites.location]) || textValue(record.fields?.[FIELDS.sites.regionSite])
    }));
    const sitesMap = new Map(sites.map((site) => [site.id, site]));

    const projects = sessionRecords.map((record) => {
      const fields = record.fields || {};
      const site = sitesMap.get(linkedRecordIds(fields[FIELDS.sessions.site])[0]);
      const sessionName = textValue(fields[FIELDS.sessions.name]);
      const startDate = dateValue(fields[FIELDS.sessions.startDate]);
      const duration = numberValue(fields[FIELDS.sessions.duration]);
      const endDate = dateValue(fields[FIELDS.sessions.endDate])
        || (startDate && duration !== null ? addDays(startDate, duration) : null);
      const programName = site?.name && site.name !== site.id ? site.name : "";
      return {
        id: record.id, sessionName, siteId: site?.id || null,
        name: programName && sessionName && programName !== sessionName
          ? `${programName} · ${sessionName}` : programName || sessionName || `Session ${record.id}`,
        location: site?.location || "Location not set",
        startDate, endDate, status: sessionStatusToApp(fields[FIELDS.sessions.status])
      };
    });
    const projectsById = new Map(projects.map((project) => [project.id, project]));

    const tasks = [];
    for (const record of workRecords) {
      const fields = record.fields || {};
      const projectId = linkedRecordIds(fields[WORK_FIELDS.session]).find((id) => projectsById.has(id));
      if (!projectId) continue;
      const stepId = linkedRecordIds(fields[WORK_FIELDS.steps])[0] || null;
      const step = stepsById.get(stepId)?.fields || {};
      const assignee = usersById.get(linkedRecordIds(fields[WORK_FIELDS.assignedTo])[0]);
      const override = dateValue(fields[WORK_FIELDS.dueDateOverride]);
      tasks.push({
        id: record.id, projectId, stepId,
        title: textValue(step[FIELDS.steps.title]) || textValue(step[FIELDS.steps.unique]) || textValue(fields[WORK_FIELDS.unique]) || `Task ${record.id}`,
        description: textValue(step[FIELDS.steps.description]),
        stepDependencyIds: linkedRecordIds(step[dependencyField(step)]),
        assignedUserId: assignee?.id || null, assigneeName: assignee?.name || null,
        status: airtableStatusToApp(fields[WORK_FIELDS.status]),
        dueDate: workDueDate(fields), dueDateOverride: Boolean(override), overrideDate: override,
        completedAt: dateValue(fields[WORK_FIELDS.completedDate]),
        priority: null, milestone: ""
      });
    }
    // Prerequisites: Work in the same Session whose Step is a dependency of this Step.
    const byProjectStep = new Map(tasks.filter((task) => task.stepId).map((task) => [`${task.projectId}:${task.stepId}`, task]));
    for (const task of tasks) {
      task.dependencies = task.stepDependencyIds
        .map((stepId) => byProjectStep.get(`${task.projectId}:${stepId}`))
        .filter((item) => item && item.id !== task.id)
        .map((item) => ({ id: item.id, title: item.title, status: item.status }));
      task.isBlocked = task.status !== "Completed" && task.dependencies.some((item) => item.status !== "Completed");
      delete task.stepDependencyIds;
    }
    for (const project of projects) {
      const projectTasks = tasks.filter((task) => task.projectId === project.id);
      project.taskCount = projectTasks.length;
      project.completedCount = projectTasks.filter((task) => task.status === "Completed").length;
      project.progress = project.taskCount ? Math.round(project.completedCount / project.taskCount * 100) : 0;
    }

    const templates = templateRecords.map((record) => {
      const fields = record.fields || {};
      let stepIds = linkedRecordIds(fields[FIELDS.templates.steps]);
      if (!stepIds.length) {
        stepIds = stepRecords.filter((step) => linkedRecordIds(step.fields?.[FIELDS.steps.template]).includes(record.id)).map((step) => step.id);
      }
      const steps = stepIds.map((id) => stepsById.get(id)).filter(Boolean).map((step) => ({
        id: step.id,
        title: textValue(step.fields?.[FIELDS.steps.title]) || textValue(step.fields?.[FIELDS.steps.unique]) || step.id,
        days: numberValue(step.fields?.[FIELDS.steps.days]) ?? 0,
        roleIds: linkedRecordIds(step.fields?.[FIELDS.steps.roles])
      })).sort((a, b) => a.days - b.days);
      return { id: record.id, name: textValue(fields[FIELDS.templates.name]) || textValue(Object.values(fields)[0]) || record.id, steps };
    });

    return { users: allUsers, usersById, sites, sitesById, projects, projectsById, tasks, templates };
  }

  // ------------------------------------------------------------ comments / activity / notifications

  const byNewest = (a, b) => String(b.createdTime).localeCompare(String(a.createdTime));

  async function commentsForTasks(taskIds, usersById) {
    const wanted = new Set(taskIds);
    return (await loadTable(TABLES.comments))
      .filter((record) => linkedRecordIds(record.fields?.[FIELDS.comments.work]).some((id) => wanted.has(id)))
      .sort(byNewest)
      .map((record) => ({
        id: record.id,
        taskId: linkedRecordIds(record.fields[FIELDS.comments.work]).find((id) => wanted.has(id)),
        userName: usersById.get(linkedRecordIds(record.fields[FIELDS.comments.author])[0])?.name || "Unknown",
        content: textValue(record.fields[FIELDS.comments.text]),
        createdAt: record.createdTime
      }));
  }
  async function addComment({ taskId, userId, content }) {
    const [record] = await create(TABLES.comments, [{ fields: {
      [FIELDS.comments.text]: content, [FIELDS.comments.work]: [taskId], [FIELDS.comments.author]: [userId]
    } }]);
    return record;
  }

  async function activityForProject(projectId, usersById, limit = 30) {
    return (await loadTable(TABLES.activity))
      .filter((record) => linkedRecordIds(record.fields?.[FIELDS.activity.session]).includes(projectId))
      .sort(byNewest).slice(0, limit)
      .map((record) => ({
        id: record.id,
        action: textValue(record.fields[FIELDS.activity.action]),
        details: textValue(record.fields[FIELDS.activity.details]),
        taskId: linkedRecordIds(record.fields[FIELDS.activity.work])[0] || null,
        userName: usersById.get(linkedRecordIds(record.fields[FIELDS.activity.user])[0])?.name || "System",
        createdAt: record.createdTime
      }));
  }
  async function logActivity({ projectId, taskId = null, userId = null, action, details }) {
    const fields = { [FIELDS.activity.action]: action, [FIELDS.activity.details]: details, [FIELDS.activity.session]: [projectId] };
    if (taskId) fields[FIELDS.activity.work] = [taskId];
    if (userId) fields[FIELDS.activity.user] = [userId];
    await create(TABLES.activity, [{ fields }]);
  }

  async function notificationsForUser(userId, limit = 20) {
    return (await loadTable(TABLES.notifications))
      .filter((record) => linkedRecordIds(record.fields?.[FIELDS.notifications.user]).includes(userId))
      .sort(byNewest).slice(0, limit)
      .map((record) => ({
        id: record.id,
        message: textValue(record.fields[FIELDS.notifications.message]),
        isRead: Boolean(record.fields[FIELDS.notifications.read]),
        projectId: linkedRecordIds(record.fields[FIELDS.notifications.session])[0] || null,
        createdAt: record.createdTime
      }));
  }
  async function notify(items) {
    const records = items.filter((item) => item.userId).map(({ userId, projectId, message }) => ({ fields: {
      [FIELDS.notifications.message]: message, [FIELDS.notifications.user]: [userId],
      ...(projectId ? { [FIELDS.notifications.session]: [projectId] } : {}),
      [FIELDS.notifications.read]: false
    } }));
    if (records.length) await create(TABLES.notifications, records);
  }
  async function markNotificationRead(notificationId, userId) {
    const record = (await loadTable(TABLES.notifications)).find((item) => item.id === notificationId);
    if (!record || !linkedRecordIds(record.fields?.[FIELDS.notifications.user]).includes(userId)) return false;
    await update(TABLES.notifications, [{ id: notificationId, fields: { [FIELDS.notifications.read]: true } }]);
    return true;
  }

  // ------------------------------------------------------------ task writes

  async function setTaskStatus(taskId, status) {
    const choices = (await fieldSchema(TABLES.work, WORK_FIELDS.status))?.choices || [];
    const fields = {
      [WORK_FIELDS.status]: appStatusToAirtable(status, choices),
      [WORK_FIELDS.completedDate]: status === "Completed" ? await dateForField(TABLES.work, WORK_FIELDS.completedDate) : null
    };
    await update(TABLES.work, [{ id: taskId, fields }]);
  }
  async function setDueDateOverride(taskId, date) {
    await update(TABLES.work, [{ id: taskId, fields: { [WORK_FIELDS.dueDateOverride]: date } }]);
  }
  async function assignTask(taskId, userId) {
    await update(TABLES.work, [{ id: taskId, fields: { [WORK_FIELDS.assignedTo]: userId ? [userId] : [] } }]);
  }

  // ------------------------------------------------------------ program writes

  // Creates a Session and one Work row per template Step. Due dates come from the
  // Work formulas (Session start + Step days), so none are written here.
  async function createProject({ sessionName, siteId, startDate, endDate, templateId }) {
    const model = await workspace();
    const template = model.templates.find((item) => item.id === templateId);
    if (!template) throw Object.assign(new Error("Choose a valid template."), { status: 400 });
    if (!model.sitesById.has(siteId)) throw Object.assign(new Error("Choose a valid site."), { status: 400 });
    const sessionFields = {
      [FIELDS.sessions.name]: sessionName,
      [FIELDS.sessions.startDate]: startDate,
      [FIELDS.sessions.site]: [siteId]
    };
    const endField = await fieldSchema(TABLES.sessions, FIELDS.sessions.endDate);
    const durationField = await fieldSchema(TABLES.sessions, FIELDS.sessions.duration);
    if (endField && !COMPUTED_TYPES.has(endField.type)) sessionFields[FIELDS.sessions.endDate] = endDate;
    else if (durationField && !COMPUTED_TYPES.has(durationField.type)) sessionFields[FIELDS.sessions.duration] = daysBetween(startDate, endDate);
    const [session] = await create(TABLES.sessions, [{ fields: sessionFields }]);

    const roleRecords = await loadTable(TABLES.roles);
    const roleUsers = new Map(roleRecords.map((record) => [record.id, linkedRecordIds(record.fields?.[FIELDS.roles.users])
      .filter((id) => model.usersById.get(id)?.role)]));
    const statusChoices = (await fieldSchema(TABLES.work, WORK_FIELDS.status))?.choices || [];
    let notStarted = null;
    try { notStarted = appStatusToAirtable("Not Started", statusChoices); } catch { notStarted = null; }
    const workRecords = template.steps.map((step) => {
      const assignee = step.roleIds.map((roleId) => roleUsers.get(roleId)?.[0]).find(Boolean) || null;
      return { fields: {
        [WORK_FIELDS.steps]: [step.id], [WORK_FIELDS.session]: [session.id],
        ...(notStarted ? { [WORK_FIELDS.status]: notStarted } : {}),
        ...(assignee ? { [WORK_FIELDS.assignedTo]: [assignee] } : {})
      } };
    });
    const created = workRecords.length ? await create(TABLES.work, workRecords, { creatingWork: true }) : [];
    return {
      projectId: session.id,
      template,
      tasks: created.map((record, index) => ({
        id: record.id, title: template.steps[index].title,
        assignedUserId: linkedRecordIds(workRecords[index].fields[WORK_FIELDS.assignedTo])[0] || null
      }))
    };
  }

  // Moves the Session start date. Work due dates follow the formula automatically;
  // completed tasks are pinned to their current date with Due Date Override first.
  async function shiftProjectStart(project, tasks, startDate) {
    const shift = daysBetween(project.startDate, startDate);
    const pins = tasks.filter((task) => task.status === "Completed" && !task.dueDateOverride && task.dueDate)
      .map((task) => ({ id: task.id, fields: { [WORK_FIELDS.dueDateOverride]: task.dueDate } }));
    await update(TABLES.work, pins);
    const fields = { [FIELDS.sessions.startDate]: startDate };
    const endField = await fieldSchema(TABLES.sessions, FIELDS.sessions.endDate);
    if (project.endDate && endField && !COMPUTED_TYPES.has(endField.type)) fields[FIELDS.sessions.endDate] = addDays(project.endDate, shift);
    await update(TABLES.sessions, [{ id: project.id, fields }]);
    invalidate(TABLES.work);
    return { shift, pinned: pins.length };
  }

  // ------------------------------------------------------------ admin browser / schema check

  async function checkSchema() {
    const tables = await schema();
    const byName = new Map(tables.map((table) => [table.name, table]));
    const missingTables = REQUIRED_TABLES.filter((name) => !byName.has(name));
    const missingFields = [];
    const computedWriteFields = [];
    for (const [tableName, fieldNames] of Object.entries(REQUIRED_FIELDS)) {
      const table = byName.get(tableName);
      if (!table) continue;
      for (const name of fieldNames) {
        const field = table.fields.find((item) => item.name === name);
        if (!field) missingFields.push(`${tableName}.${name}`);
      }
    }
    const work = byName.get(TABLES.work);
    for (const name of WORK_WRITABLE_FIELDS) {
      const field = work?.fields.find((item) => item.name === name);
      if (field && COMPUTED_TYPES.has(field.type)) computedWriteFields.push(`${TABLES.work}.${name}`);
    }
    const steps = byName.get(TABLES.steps);
    if (steps && !FIELDS.steps.dependencies.some((name) => steps.fields.some((field) => field.name === name))) {
      missingFields.push(`${TABLES.steps}.Dependencies`);
    }
    return { tables, missingTables, missingFields, computedWriteFields };
  }

  async function browseTable(tableId, { query = "", limit = 25, offset = 0 } = {}) {
    const table = await tableSchema(tableId);
    if (!table) return null;
    const records = await loadTable(table.id);
    const needle = query.toLowerCase();
    const matching = needle ? records.filter((record) => JSON.stringify(record.fields || {}).toLowerCase().includes(needle)) : records;
    const page = matching.slice(offset, offset + limit).map((record) => ({ id: record.id, fields: record.fields || {}, createdTime: record.createdTime }));
    const linkedTables = [...new Set(table.fields.map((field) => field.linkedTableId).filter(Boolean))];
    const recordLabels = {};
    for (const linkedId of linkedTables) {
      const linked = await tableSchema(linkedId);
      const primary = linked?.fields.find((field) => field.id === linked.primaryFieldId)?.name;
      for (const record of await loadTable(linkedId)) {
        const fields = record.fields || {};
        const person = [textValue(fields[FIELDS.users.firstName]), textValue(fields[FIELDS.users.lastName])].filter(Boolean).join(" ");
        const label = (primary && textValue(fields[primary])) || person || textValue(fields[FIELDS.steps.unique]);
        if (label) recordLabels[record.id] = label;
      }
    }
    return { table, records: page, recordLabels, total: matching.length };
  }

  return {
    client, loadTable, invalidate, schema, users, findUserByEmail, workspace,
    commentsForTasks, addComment, activityForProject, logActivity,
    notificationsForUser, notify, markNotificationRead,
    setTaskStatus, setDueDateOverride, assignTask, createProject, shiftProjectStart,
    checkSchema, browseTable
  };
}
