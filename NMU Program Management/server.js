import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const dataDir = join(root, ".data");
await mkdir(dataDir, { recursive: true });
const database = new DatabaseSync(process.env.NMU_DATABASE_PATH || join(dataDir, "nmu.sqlite"));
database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('admin','program_manager','employee','external_partner'))
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
    program_type TEXT NOT NULL, location TEXT NOT NULL, host_organization TEXT DEFAULT '',
    start_date TEXT NOT NULL, end_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Planning',
    project_manager_id TEXT REFERENCES users(id), details_json TEXT NOT NULL DEFAULT '{}',
    airtable_record_id TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS project_members (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_role TEXT NOT NULL DEFAULT 'Member', PRIMARY KEY(project_id,user_id)
  );
  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, program_type TEXT NOT NULL, description TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS template_tasks (
    id TEXT PRIMARY KEY, template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    title TEXT NOT NULL, description TEXT DEFAULT '', relative_due_days INTEGER NOT NULL,
    default_role TEXT NOT NULL, priority TEXT NOT NULL, milestone TEXT NOT NULL,
    dependency_index INTEGER
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    template_task_id TEXT REFERENCES template_tasks(id), title TEXT NOT NULL, description TEXT DEFAULT '',
    assigned_user_id TEXT REFERENCES users(id), status TEXT NOT NULL DEFAULT 'Not Started'
      CHECK(status IN ('Not Started','In Progress','Blocked','Completed')),
    priority TEXT NOT NULL DEFAULT 'Medium', due_date TEXT NOT NULL, due_date_override INTEGER NOT NULL DEFAULT 0,
    milestone TEXT NOT NULL DEFAULT 'Planning', completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    prerequisite_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY(task_id,prerequisite_task_id), CHECK(task_id <> prerequisite_task_id)
  );
  CREATE TABLE IF NOT EXISTS task_comments (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL, user_id TEXT REFERENCES users(id),
    action TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), project_id TEXT REFERENCES projects(id),
    message TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS task_project_idx ON tasks(project_id);
  CREATE INDEX IF NOT EXISTS task_assignee_idx ON tasks(assigned_user_id);
  CREATE INDEX IF NOT EXISTS activity_project_idx ON activity_logs(project_id,created_at);
`);

const nowISO = () => new Date().toISOString();
const dateOnly = (date) => date.toISOString().slice(0, 10);
const offsetDate = (days) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
};
const users = [
  ["u-catalina", "Catalina", "catalina@nmu.demo", "admin"],
  ["u-mary", "Mary", "mary@nmu.demo", "employee"],
  ["u-jordan", "Jordan Ellis", "jordan@nmu.demo", "program_manager"],
  ["u-taylor", "Taylor Brooks", "taylor@nmu.demo", "admin"],
  ["u-casey", "Casey Nguyen", "casey@nmu.demo", "employee"],
  ["u-sam", "Sam Okafor", "sam@nmu.demo", "employee"],
  ["u-partner", "Alex Rivera", "alex@partner.demo", "external_partner"]
];
const templateDefs = [
  {
    id: "tpl-community", name: "Community Swim Program", programType: "Community",
    description: "Core outreach, staffing, compliance, delivery, and wrap-up workflow.",
    tasks: [
      ["Contact host organization", "Confirm interest, facilities, and local point of contact.", -120, "program_manager", "High", "Host coordination", null],
      ["Define program dates and responsibilities", "Align the host and NMU team on the operating plan.", -112, "admin", "High", "Planning", null],
      ["Research funding opportunities", "Identify grants and sponsorship opportunities.", -105, "employee", "Medium", "Funding", null],
      ["Confirm local partners", "Map community partners and referral channels.", -90, "program_manager", "Medium", "Partnerships", null],
      ["Recruit instructors", "Recruit qualified swim instructors for the program.", -70, "program_manager", "High", "Staffing", null],
      ["Recruit volunteers", "Confirm volunteer coverage and responsibilities.", -63, "employee", "Medium", "Staffing", null],
      ["Complete background checks", "Submit and verify required staff clearances.", -42, "employee", "High", "Compliance", 5],
      ["Prepare registration materials", "Prepare accessible registration and participant information.", -38, "employee", "Medium", "Registration", null],
      ["Order program supplies", "Order and confirm delivery of required equipment.", -28, "employee", "High", "Supplies", null],
      ["Coordinate program marketing", "Share approved program details with the community.", -24, "employee", "Medium", "Outreach", 1],
      ["Finalize staff schedules", "Confirm instructor and volunteer shift coverage.", -14, "program_manager", "High", "Staffing", 4],
      ["Conduct instructor training", "Train and brief program staff.", -7, "program_manager", "High", "Training", 7],
      ["Confirm supplies and host readiness", "Verify equipment arrival and host readiness.", -2, "employee", "High", "Readiness", 8],
      ["Launch program", "Deliver the first program session.", 0, "program_manager", "High", "Program execution", null],
      ["Collect participant feedback", "Collect feedback from participants and host.", 10, "program_manager", "Medium", "Post-program", null],
      ["Complete final program report", "Summarize attendance, outcomes, and lessons learned.", 30, "admin", "Medium", "Post-program", null]
    ]
  },
  {
    id: "tpl-school", name: "School Partnership Series", programType: "School",
    description: "A school-focused workflow with additional calendar and registration coordination.",
    tasks: [
      ["Confirm school partnership", "Confirm school sponsor, facilities, and dates.", -105, "program_manager", "High", "Host coordination", null],
      ["Review school calendar and logistics", "Check calendar, pool access, and transportation.", -85, "program_manager", "High", "Planning", null],
      ["Secure program funding", "Confirm grant or sponsor coverage.", -75, "employee", "High", "Funding", null],
      ["Recruit instructors", "Recruit instructors for the school series.", -60, "program_manager", "High", "Staffing", null],
      ["Prepare family registration", "Prepare registration and family communications.", -45, "employee", "Medium", "Registration", null],
      ["Complete background checks", "Verify staff clearances before assigning sessions.", -35, "employee", "High", "Compliance", 4],
      ["Order swim supplies", "Prepare and ship supplies for the school.", -21, "employee", "Medium", "Supplies", null],
      ["Confirm student roster", "Coordinate the latest participant roster with the school.", -7, "program_manager", "High", "Readiness", null],
      ["Deliver swim series", "Run the scheduled school program.", 0, "program_manager", "High", "Program execution", null],
      ["Share outcomes with school", "Compile outcomes and close the partner loop.", 14, "admin", "Medium", "Post-program", null]
    ]
  },
  {
    id: "tpl-clinic", name: "Swim Safety Clinic", programType: "Clinic",
    description: "A streamlined single-event clinic plan.",
    tasks: [
      ["Confirm community host", "Confirm venue, date, and event expectations.", -60, "program_manager", "High", "Host coordination", null],
      ["Confirm event budget", "Confirm event funding and purchase approvals.", -45, "employee", "Medium", "Funding", null],
      ["Recruit clinic instructors", "Recruit qualified instructors.", -35, "program_manager", "High", "Staffing", null],
      ["Complete staff clearances", "Verify all event staff clearances.", -21, "employee", "High", "Compliance", 3],
      ["Promote clinic registration", "Distribute approved event registration information.", -18, "employee", "Medium", "Outreach", null],
      ["Prepare clinic equipment", "Prepare equipment and confirm delivery.", -7, "employee", "Medium", "Supplies", null],
      ["Deliver swim safety clinic", "Host the clinic and record attendance.", 0, "program_manager", "High", "Program execution", null],
      ["Send follow-up and report", "Collect feedback and share an event summary.", 7, "admin", "Low", "Post-program", null]
    ]
  }
];

function seedDemoData() {
  if (database.prepare("SELECT COUNT(*) AS count FROM users").get().count) return;
  const insertUser = database.prepare("INSERT INTO users(id,name,email,role) VALUES(?,?,?,?)");
  for (const user of users) insertUser.run(...user);
  const insertTemplate = database.prepare("INSERT INTO templates(id,name,program_type,description) VALUES(?,?,?,?)");
  const insertTemplateTask = database.prepare(`INSERT INTO template_tasks
    (id,template_id,title,description,relative_due_days,default_role,priority,milestone,dependency_index)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  const templateTaskIds = new Map();
  for (const template of templateDefs) {
    insertTemplate.run(template.id, template.name, template.programType, template.description);
    templateTaskIds.set(template.id, []);
    template.tasks.forEach((task, index) => {
      const taskId = `${template.id}-task-${index + 1}`;
      templateTaskIds.get(template.id).push(taskId);
      insertTemplateTask.run(taskId, template.id, ...task);
    });
  }
  const projects = [
    { id: "p-seattle", name: "Seattle Swim Program", type: "Community", location: "Seattle, WA", host: "Rainier Community Center", start: 35, end: 49, status: "On Track", manager: "u-jordan", template: "tpl-community", progress: 0.56 },
    { id: "p-tacoma", name: "Tacoma Swim Program", type: "Community", location: "Tacoma, WA", host: "Eastside Community Hub", start: 16, end: 30, status: "At Risk", manager: "u-jordan", template: "tpl-community", progress: 0.31 },
    { id: "p-portland", name: "Portland Swim Program", type: "School", location: "Portland, OR", host: "Portland Public Schools", start: 77, end: 91, status: "Planning", manager: "u-catalina", template: "tpl-school", progress: 0.19 },
    { id: "p-spokane", name: "Spokane Water Safety Clinic", type: "Clinic", location: "Spokane, WA", host: "South Hill YMCA", start: 51, end: 52, status: "Planning", manager: "u-jordan", template: "tpl-clinic", progress: 0.12 },
    { id: "p-everett", name: "Everett Summer Swim", type: "Community", location: "Everett, WA", host: "Everett Parks & Recreation", start: -35, end: -21, status: "Completed", manager: "u-catalina", template: "tpl-community", progress: 1 },
    { id: "p-olympia", name: "Olympia School Swim Series", type: "School", location: "Olympia, WA", host: "Capital School District", start: 112, end: 126, status: "Planning", manager: "u-jordan", template: "tpl-school", progress: 0.08 }
  ];
  const insertProject = database.prepare(`INSERT INTO projects
    (id,name,description,program_type,location,host_organization,start_date,end_date,status,project_manager_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertMember = database.prepare("INSERT INTO project_members(project_id,user_id,project_role) VALUES(?,?,?)");
  const insertTask = database.prepare(`INSERT INTO tasks
    (id,project_id,template_task_id,title,description,assigned_user_id,status,priority,due_date,milestone,completed_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertDependency = database.prepare("INSERT INTO task_dependencies(task_id,prerequisite_task_id) VALUES(?,?)");
  const roleOwner = { admin: "u-catalina", program_manager: "u-jordan", employee: "u-casey" };
  for (const [projectIndex, project] of projects.entries()) {
    const startDate = offsetDate(project.start);
    const endDate = offsetDate(project.end);
    insertProject.run(project.id, project.name, `${project.type} swim program with ${project.host}.`, project.type,
      project.location, project.host, startDate, endDate, project.status, project.manager, nowISO(), nowISO());
    const members = new Set([project.manager, "u-catalina", "u-mary", "u-casey", "u-sam"]);
    if (project.id === "p-seattle") members.add("u-partner");
    for (const userId of members) insertMember.run(project.id, userId, userId === project.manager ? "Project Manager" : userId === "u-partner" ? "Host Partner" : "Team Member");
    const template = templateDefs.find((item) => item.id === project.template);
    const demoTaskLimit = project.template === "tpl-community" ? 9 : project.template === "tpl-school" ? 8 : 7;
    const taskIds = [];
    template.tasks.slice(0, demoTaskLimit).forEach((task, taskIndex) => {
      const [title, description, relativeDays, role, priority, milestone, dependencyIndex] = task;
      const id = `${project.id}-task-${taskIndex + 1}`;
      taskIds.push(id);
      const dueDate = offsetDate(project.start + relativeDays);
      const status = project.status === "Completed" || (taskIndex / demoTaskLimit < project.progress)
        ? "Completed"
        : taskIndex % 7 === 5 && projectIndex < 3 ? "In Progress" : "Not Started";
      const assignee = project.id === "p-seattle" && taskIndex === 0
        ? "u-partner"
        : role === "program_manager" ? project.manager : roleOwner[role] ?? project.manager;
      insertTask.run(id, project.id, templateTaskIds.get(project.template)[taskIndex], title, description,
        assignee, status, priority, dueDate, milestone, status === "Completed" ? nowISO() : null, nowISO(), nowISO());
      if (dependencyIndex !== null) insertDependency.run(id, `${project.id}-task-${dependencyIndex}`);
    });
  }
  const addActivity = database.prepare("INSERT INTO activity_logs(id,project_id,task_id,user_id,action,details,created_at) VALUES(?,?,?,?,?,?,?)");
  const activitySamples = [
    ["p-seattle", "p-seattle-task-1", "u-jordan", "Project created", "Seattle Swim Program created from the Community Swim Program template.", -11],
    ["p-seattle", "p-seattle-task-5", "u-jordan", "Task assigned", "Recruit instructors assigned to Jordan Ellis.", -4],
    ["p-tacoma", "p-tacoma-task-1", "u-mary", "Update added", "Host is confirming pool availability for the proposed dates.", -3],
    ["p-portland", "p-portland-task-1", "u-catalina", "Project created", "Portland Swim Program created from the School Partnership Series template.", -2],
    ["p-spokane", "p-spokane-task-3", "u-jordan", "Task completed", "Clinic instructors confirmed.", -1]
  ];
  for (const [projectId, taskId, userId, action, details, days] of activitySamples) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    addActivity.run(randomUUID(), projectId, taskId, userId, action, details, date.toISOString());
  }
  const addComment = database.prepare("INSERT INTO task_comments(id,task_id,user_id,content,created_at) VALUES(?,?,?,?,?)");
  addComment.run(randomUUID(), "p-seattle-task-5", "u-jordan", "Host has shared two instructor referrals to follow up with.", nowISO());
  addComment.run(randomUUID(), "p-tacoma-task-1", "u-mary", "Waiting on final pool availability confirmation.", nowISO());
  const addNotification = database.prepare("INSERT INTO notifications(id,user_id,project_id,message,is_read,created_at) VALUES(?,?,?,?,?,?)");
  addNotification.run(randomUUID(), "u-jordan", "p-tacoma", "Tacoma Swim Program has overdue preparation work.", 0, nowISO());
  addNotification.run(randomUUID(), "u-catalina", "p-seattle", "Review the upcoming Seattle program timeline.", 0, nowISO());
}
seedDemoData();

const roleLabel = {
  admin: "Administrator",
  program_manager: "Program Manager",
  employee: "Employee",
  external_partner: "External Partner"
};
const getUser = (id) => database.prepare("SELECT id,name,email,role FROM users WHERE id=?").get(id);
const getCurrentUser = (request) => getUser(request.headers["x-demo-user"] || "u-catalina") || getUser("u-catalina");
const canManage = (user) => user.role === "admin";
const isMember = (projectId, userId) => Boolean(database.prepare("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?").get(projectId, userId));
function canAccessProject(user, projectId) {
  if (canManage(user)) return true;
  if (user.role === "program_manager") {
    const project = database.prepare("SELECT project_manager_id FROM projects WHERE id=?").get(projectId);
    return project?.project_manager_id === user.id || isMember(projectId, user.id);
  }
  return isMember(projectId, user.id) || Boolean(database.prepare(
    "SELECT 1 FROM tasks WHERE project_id=? AND assigned_user_id=?"
  ).get(projectId, user.id));
}
function canEditTask(user, task) {
  return canManage(user) || (user.role === "program_manager" && canAccessProject(user, task.project_id))
    || (["employee", "external_partner"].includes(user.role) && task.assigned_user_id === user.id);
}
function logActivity(projectId, taskId, userId, action, details) {
  database.prepare("INSERT INTO activity_logs(id,project_id,task_id,user_id,action,details,created_at) VALUES(?,?,?,?,?,?,?)")
    .run(randomUUID(), projectId, taskId, userId, action, details, nowISO());
}
function notifyUser(userId, projectId, message) {
  database.prepare("INSERT INTO notifications(id,user_id,project_id,message,created_at) VALUES(?,?,?,?,?)")
    .run(randomUUID(), userId, projectId, message, nowISO());
}
const projectRows = (user) => {
  const where = canManage(user) ? "" : user.role === "program_manager"
    ? "WHERE p.project_manager_id=? OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=?)"
    : "WHERE EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=?) OR EXISTS(SELECT 1 FROM tasks t WHERE t.project_id=p.id AND t.assigned_user_id=?)";
  const params = canManage(user) ? [] : user.role === "program_manager" ? [user.id, user.id] : [user.id, user.id];
  return database.prepare(`SELECT p.*,u.name AS manager_name,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id) AS task_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id AND t.status='Completed') AS completed_count
    FROM projects p LEFT JOIN users u ON u.id=p.project_manager_id ${where} ORDER BY p.start_date`).all(...params);
};
const taskRows = (projectId) => database.prepare(`SELECT t.*,u.name AS assignee_name,
    COALESCE((SELECT json_group_array(json_object('id',p.id,'title',p.title,'status',p.status))
      FROM task_dependencies d JOIN tasks p ON p.id=d.prerequisite_task_id WHERE d.task_id=t.id),'[]') AS dependencies_json
    FROM tasks t LEFT JOIN users u ON u.id=t.assigned_user_id WHERE t.project_id=? ORDER BY t.due_date,t.title`).all(projectId);
function taskResponse(row, viewer) {
  const dependencies = JSON.parse(row.dependencies_json || "[]");
  const isBlocked = row.status !== "Completed" && dependencies.some((item) => item.status !== "Completed");
  return {
    id: row.id, projectId: row.project_id, title: row.title, description: row.description,
    assignedUserId: row.assigned_user_id, assigneeName: row.assignee_name, status: isBlocked ? "Blocked" : row.status,
    priority: row.priority, dueDate: row.due_date, dueDateOverride: Boolean(row.due_date_override),
    milestone: row.milestone, completedAt: row.completed_at, isBlocked,
    dependencies, canEdit: canEditTask(viewer, row)
  };
}
function projectResponse(row) {
  return {
    id: row.id, name: row.name, description: row.description, programType: row.program_type,
    location: row.location, hostOrganization: row.host_organization, startDate: row.start_date,
    endDate: row.end_date, status: row.status, projectManagerId: row.project_manager_id,
    projectManagerName: row.manager_name, progress: Number(row.task_count) ? Math.round(row.completed_count / row.task_count * 100) : 0,
    taskCount: Number(row.task_count), completedCount: Number(row.completed_count),
    details: JSON.parse(row.details_json || "{}")
  };
}
function send(response, status, body, contentType = "application/json; charset=utf-8") {
  response.writeHead(status, { "content-type": contentType, "access-control-allow-origin": "same-origin" });
  response.end(contentType.startsWith("application/json") ? JSON.stringify(body) : body);
}
function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error("Request body must be valid JSON.")); }
    });
    request.on("error", reject);
  });
}
function addDays(date, days) {
  const result = new Date(`${date}T12:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + Number(days));
  return dateOnly(result);
}
function validateDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function resolveRoleAssignment(role, managerId) {
  if (role === "program_manager") return managerId;
  if (role === "admin") return "u-catalina";
  if (role === "employee") return "u-casey";
  return managerId;
}

async function handleApi(request, response, url) {
  const user = getCurrentUser(request);
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/bootstrap") {
    const projects = projectRows(user).map(projectResponse);
    const visibleIds = new Set(projects.map((project) => project.id));
    const tasks = projects.flatMap((project) => taskRows(project.id)
      .filter((task) => user.role !== "external_partner" || task.assigned_user_id === user.id)
      .map((task) => ({ ...taskResponse(task, user), projectName: project.name, projectStatus: project.status })));
    const notifications = database.prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 20").all(user.id)
      .map((item) => ({ id: item.id, message: item.message, isRead: Boolean(item.is_read), createdAt: item.created_at, projectId: item.project_id }));
    return send(response, 200, {
      currentUser: { ...user, roleLabel: roleLabel[user.role] },
      users: database.prepare("SELECT id,name,role FROM users ORDER BY name").all(),
      projects, tasks, notifications,
      templates: database.prepare("SELECT id,name,program_type AS programType,description FROM templates ORDER BY name").all(),
      integration: { airtableConfigured: Boolean(process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID) },
      visibleProjectCount: visibleIds.size
    });
  }
  if (request.method === "GET" && path === "/api/projects") {
    return send(response, 200, projectRows(user).map(projectResponse));
  }
  if (request.method === "GET" && path.startsWith("/api/templates/")) {
    if (!canManage(user)) return send(response, 403, { error: "Only administrators can edit program templates." });
    const templateId = decodeURIComponent(path.slice("/api/templates/".length));
    const template = database.prepare("SELECT id,name,program_type AS programType,description FROM templates WHERE id=?").get(templateId);
    if (!template) return send(response, 404, { error: "Template not found." });
    const tasks = database.prepare(`SELECT id,title,description,relative_due_days AS relativeDueDays,priority,milestone
      FROM template_tasks WHERE template_id=? ORDER BY rowid`).all(templateId);
    return send(response, 200, { ...template, tasks });
  }
  if (request.method === "PATCH" && path.startsWith("/api/templates/")) {
    if (!canManage(user)) return send(response, 403, { error: "Only administrators can edit program templates." });
    const templateId = decodeURIComponent(path.slice("/api/templates/".length));
    const template = database.prepare("SELECT * FROM templates WHERE id=?").get(templateId);
    if (!template) return send(response, 404, { error: "Template not found." });
    const input = await readBody(request);
    if (typeof input.name !== "string" || !input.name.trim() || !Array.isArray(input.tasks)) {
      return send(response, 400, { error: "A template name and task list are required." });
    }
    const storedTasks = database.prepare("SELECT id FROM template_tasks WHERE template_id=? ORDER BY rowid").all(templateId);
    if (input.tasks.length !== storedTasks.length || input.tasks.some((task) =>
      typeof task.title !== "string" || !task.title.trim() || !Number.isInteger(Number(task.relativeDueDays))
      || !["Low", "Medium", "High"].includes(task.priority) || typeof task.milestone !== "string" || !task.milestone.trim())) {
      return send(response, 400, { error: "Each existing template task needs a title, whole-number relative deadline, priority, and milestone." });
    }
    database.exec("BEGIN");
    try {
      database.prepare("UPDATE templates SET name=?,description=? WHERE id=?").run(input.name.trim(), String(input.description || ""), templateId);
      const updateTask = database.prepare("UPDATE template_tasks SET title=?,description=?,relative_due_days=?,priority=?,milestone=? WHERE id=?");
      for (const [index, task] of input.tasks.entries()) {
        updateTask.run(task.title.trim(), String(task.description || ""), Number(task.relativeDueDays), task.priority, task.milestone.trim(), storedTasks[index].id);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return send(response, 200, { ok: true });
  }
  if (request.method === "GET" && path.startsWith("/api/projects/")) {
    const projectId = decodeURIComponent(path.slice("/api/projects/".length));
    if (!canAccessProject(user, projectId)) return send(response, 404, { error: "Project not found." });
    const row = database.prepare(`SELECT p.*,u.name AS manager_name,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id) AS task_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id AND t.status='Completed') AS completed_count
      FROM projects p LEFT JOIN users u ON u.id=p.project_manager_id WHERE p.id=?`).get(projectId);
    if (!row) return send(response, 404, { error: "Project not found." });
    const members = database.prepare(`SELECT u.id,u.name,u.email,u.role,pm.project_role AS projectRole
      FROM project_members pm JOIN users u ON u.id=pm.user_id WHERE pm.project_id=? ORDER BY u.name`).all(projectId);
    const activities = database.prepare(`SELECT a.*,u.name AS user_name FROM activity_logs a LEFT JOIN users u ON u.id=a.user_id
      WHERE a.project_id=? ORDER BY a.created_at DESC LIMIT 30`).all(projectId)
      .map((item) => ({ id: item.id, action: item.action, details: item.details, createdAt: item.created_at, userName: item.user_name || "System" }));
    const tasks = taskRows(projectId)
      .filter((item) => user.role !== "external_partner" || item.assigned_user_id === user.id)
      .map((item) => taskResponse(item, user));
    const visibleMembers = user.role === "external_partner" ? members.filter((member) => member.id === user.id) : members;
    const comments = database.prepare(`SELECT c.*,u.name AS user_name FROM task_comments c JOIN users u ON u.id=c.user_id
      JOIN tasks t ON t.id=c.task_id WHERE t.project_id=? ORDER BY c.created_at DESC LIMIT 30`).all(projectId)
      .map((item) => ({ id: item.id, taskId: item.task_id, userName: item.user_name, content: item.content, createdAt: item.created_at }));
    const visibleActivities = user.role === "external_partner" ? activities.filter((item) => item.userName === user.name) : activities;
    const visibleComments = user.role === "external_partner" ? comments.filter((item) => tasks.some((task) => task.id === item.taskId)) : comments;
    const visibleProject = projectResponse(row);
    if (user.role === "external_partner") visibleProject.details = {};
    return send(response, 200, { project: visibleProject, members: visibleMembers, tasks, activities: visibleActivities, comments: visibleComments });
  }
  if (request.method === "POST" && path === "/api/projects") {
    if (user.role === "employee" || user.role === "external_partner") return send(response, 403, { error: "You do not have permission to create programs." });
    const input = await readBody(request);
    const required = ["name", "programType", "location", "startDate", "endDate", "templateId", "projectManagerId"];
    if (required.some((key) => !String(input[key] || "").trim())) return send(response, 400, { error: "Complete all required project fields." });
    if (!validateDate(input.startDate) || !validateDate(input.endDate) || input.endDate < input.startDate) return send(response, 400, { error: "Enter valid program dates; the end date must be on or after the start date." });
    if (!getUser(input.projectManagerId) || getUser(input.projectManagerId).role === "external_partner") return send(response, 400, { error: "Choose an internal employee as the project manager." });
    const template = database.prepare("SELECT * FROM templates WHERE id=?").get(input.templateId);
    if (!template) return send(response, 400, { error: "Choose a valid task template." });
    const id = randomUUID();
    const timestamp = nowISO();
    const managerId = input.projectManagerId;
    const insertProject = database.prepare(`INSERT INTO projects
      (id,name,description,program_type,location,host_organization,start_date,end_date,status,project_manager_id,details_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const details = {
      primaryContact: input.primaryContact || "", contactEmail: input.contactEmail || "",
      shippingAddress: input.shippingAddress || "", participants: Number(input.participants || 0),
      instructorRequirements: input.instructorRequirements || "", volunteerRequirements: input.volunteerRequirements || "",
      specialRequirements: input.specialRequirements || "", notes: input.notes || ""
    };
    insertProject.run(id, input.name.trim(), input.description || "", input.programType, input.location.trim(),
      input.hostOrganization || "", input.startDate, input.endDate, "Planning", managerId, JSON.stringify(details), timestamp, timestamp);
    const members = new Set([managerId, user.id, "u-catalina"]);
    const addMember = database.prepare("INSERT OR IGNORE INTO project_members(project_id,user_id,project_role) VALUES(?,?,?)");
    for (const memberId of members) addMember.run(id, memberId, memberId === managerId ? "Project Manager" : "Team Member");
    const templateTasks = database.prepare("SELECT * FROM template_tasks WHERE template_id=? ORDER BY rowid").all(template.id);
    const createdIds = [];
    const insertTask = database.prepare(`INSERT INTO tasks
      (id,project_id,template_task_id,title,description,assigned_user_id,status,priority,due_date,milestone,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertDependency = database.prepare("INSERT INTO task_dependencies(task_id,prerequisite_task_id) VALUES(?,?)");
    for (const task of templateTasks) {
      const taskId = randomUUID();
      createdIds.push(taskId);
      const assignedUser = resolveRoleAssignment(task.default_role, managerId);
      insertTask.run(taskId, id, task.id, task.title, task.description, assignedUser, "Not Started",
        task.priority, addDays(input.startDate, task.relative_due_days), task.milestone, timestamp, timestamp);
      if (task.dependency_index !== null) {
        const prerequisite = createdIds[task.dependency_index - 1];
        if (prerequisite) insertDependency.run(taskId, prerequisite);
      }
      if (assignedUser !== user.id) notifyUser(assignedUser, id, `New task assigned: ${task.title} — ${input.name}`);
    }
    logActivity(id, null, user.id, "Project created", `${input.name} created from ${template.name}.`);
    return send(response, 201, { projectId: id, taskCount: createdIds.length });
  }
  if (request.method === "PATCH" && path.startsWith("/api/tasks/") && path.endsWith("/status")) {
    const taskId = decodeURIComponent(path.slice("/api/tasks/".length, -"/status".length));
    const task = database.prepare("SELECT * FROM tasks WHERE id=?").get(taskId);
    if (!task || !canEditTask(user, task)) return send(response, 404, { error: "Task not found or you do not have permission to update it." });
    const input = await readBody(request);
    const allowed = ["Not Started", "In Progress", "Completed"];
    if (!allowed.includes(input.status)) return send(response, 400, { error: "Choose a valid task status." });
    if (input.status === "Completed") {
      const prerequisites = database.prepare(`SELECT p.title FROM task_dependencies d JOIN tasks p ON p.id=d.prerequisite_task_id
        WHERE d.task_id=? AND p.status!='Completed'`).all(taskId);
      if (prerequisites.length && !(canManage(user) && String(input.overrideReason || "").trim())) {
        return send(response, 409, { error: "Complete prerequisite tasks before marking this task done.", prerequisites: prerequisites.map((item) => item.title) });
      }
      if (prerequisites.length) logActivity(task.project_id, taskId, user.id, "Dependency override", `Authorized override: ${String(input.overrideReason).trim()}`);
    }
    const completedAt = input.status === "Completed" ? nowISO() : null;
    database.prepare("UPDATE tasks SET status=?,completed_at=?,updated_at=? WHERE id=?").run(input.status, completedAt, nowISO(), taskId);
    logActivity(task.project_id, taskId, user.id, "Status changed", `${task.title}: ${task.status} → ${input.status}.`);
    const newlyReady = database.prepare(`SELECT t.id,t.title,t.assigned_user_id FROM task_dependencies d JOIN tasks t ON t.id=d.task_id
      WHERE d.prerequisite_task_id=? AND t.status='Not Started' AND NOT EXISTS
      (SELECT 1 FROM task_dependencies d2 JOIN tasks p ON p.id=d2.prerequisite_task_id WHERE d2.task_id=t.id AND p.status!='Completed')`).all(taskId);
    for (const ready of newlyReady) notifyUser(ready.assigned_user_id || user.id, task.project_id, `Task is now ready: ${ready.title}`);
    return send(response, 200, { ok: true });
  }
  if (request.method === "PATCH" && path.startsWith("/api/tasks/") && path.endsWith("/due-date")) {
    if (!["admin", "program_manager"].includes(user.role)) return send(response, 403, { error: "Only management can override task deadlines." });
    const taskId = decodeURIComponent(path.slice("/api/tasks/".length, -"/due-date".length));
    const task = database.prepare("SELECT * FROM tasks WHERE id=?").get(taskId);
    if (!task || !canAccessProject(user, task.project_id)) return send(response, 404, { error: "Task not found." });
    const input = await readBody(request);
    if (!validateDate(input.dueDate)) return send(response, 400, { error: "Enter a valid task deadline." });
    database.prepare("UPDATE tasks SET due_date=?,due_date_override=1,updated_at=? WHERE id=?").run(input.dueDate, nowISO(), taskId);
    logActivity(task.project_id, taskId, user.id, "Deadline overridden", `${task.title}: ${task.due_date} → ${input.dueDate}. This date will be preserved during program timeline changes.`);
    return send(response, 200, { ok: true });
  }
  if (request.method === "POST" && path.startsWith("/api/tasks/") && path.endsWith("/comments")) {
    const taskId = decodeURIComponent(path.slice("/api/tasks/".length, -"/comments".length));
    const task = database.prepare("SELECT * FROM tasks WHERE id=?").get(taskId);
    if (!task || !canAccessProject(user, task.project_id)
      || (user.role === "external_partner" && task.assigned_user_id !== user.id)) return send(response, 404, { error: "Task not found." });
    const input = await readBody(request);
    const content = String(input.content || "").trim();
    if (!content || content.length > 2000) return send(response, 400, { error: "Enter a comment of 1–2,000 characters." });
    database.prepare("INSERT INTO task_comments(id,task_id,user_id,content,created_at) VALUES(?,?,?,?,?)")
      .run(randomUUID(), taskId, user.id, content, nowISO());
    logActivity(task.project_id, taskId, user.id, "Comment added", content);
    return send(response, 201, { ok: true });
  }
  if (request.method === "PATCH" && path.startsWith("/api/tasks/") && path.endsWith("/assignee")) {
    if (!["admin", "program_manager"].includes(user.role)) return send(response, 403, { error: "Only management and program managers can reassign tasks." });
    const taskId = decodeURIComponent(path.slice("/api/tasks/".length, -"/assignee".length));
    const task = database.prepare("SELECT * FROM tasks WHERE id=?").get(taskId);
    if (!task || !canAccessProject(user, task.project_id)) return send(response, 404, { error: "Task not found." });
    const input = await readBody(request);
    const assignee = getUser(input.assignedUserId);
    if (!assignee || assignee.role === "external_partner") return send(response, 400, { error: "Choose an internal employee." });
    database.prepare("UPDATE tasks SET assigned_user_id=?,updated_at=? WHERE id=?").run(assignee.id, nowISO(), taskId);
    database.prepare("INSERT OR IGNORE INTO project_members(project_id,user_id,project_role) VALUES(?,?,?)").run(task.project_id, assignee.id, "Team Member");
    logActivity(task.project_id, taskId, user.id, "Task reassigned", `${task.title} reassigned to ${assignee.name}.`);
    notifyUser(assignee.id, task.project_id, `New task assigned: ${task.title}`);
    return send(response, 200, { ok: true });
  }
  if (request.method === "POST" && path === "/api/projects/date-preview") {
    const input = await readBody(request);
    if (!canAccessProject(user, input.projectId)) return send(response, 404, { error: "Project not found." });
    if (!["admin", "program_manager"].includes(user.role)) return send(response, 403, { error: "You cannot adjust this program timeline." });
    if (!validateDate(input.startDate)) return send(response, 400, { error: "Enter a valid program start date." });
    const project = database.prepare("SELECT * FROM projects WHERE id=?").get(input.projectId);
    const shift = Math.round((Date.parse(`${input.startDate}T00:00:00Z`) - Date.parse(`${project.start_date}T00:00:00Z`)) / 86400000);
    const tasks = database.prepare("SELECT id,title,due_date,status,due_date_override FROM tasks WHERE project_id=? ORDER BY due_date").all(project.id);
    return send(response, 200, { shiftDays: shift, changes: tasks.filter((task) => task.status !== "Completed" && !task.due_date_override)
      .map((task) => ({ id: task.id, title: task.title, oldDate: task.due_date, newDate: addDays(task.due_date, shift) })) });
  }
  if (request.method === "PATCH" && path.startsWith("/api/projects/") && path.endsWith("/start-date")) {
    const projectId = decodeURIComponent(path.slice("/api/projects/".length, -"/start-date".length));
    if (!canAccessProject(user, projectId) || !["admin", "program_manager"].includes(user.role)) return send(response, 403, { error: "You cannot adjust this program timeline." });
    const input = await readBody(request);
    if (!validateDate(input.startDate)) return send(response, 400, { error: "Enter a valid program start date." });
    const project = database.prepare("SELECT * FROM projects WHERE id=?").get(projectId);
    const shift = Math.round((Date.parse(`${input.startDate}T00:00:00Z`) - Date.parse(`${project.start_date}T00:00:00Z`)) / 86400000);
    const updateTask = database.prepare("UPDATE tasks SET due_date=?,updated_at=? WHERE id=?");
    const tasks = database.prepare("SELECT id,due_date,status,due_date_override FROM tasks WHERE project_id=?").all(projectId);
    for (const task of tasks) if (task.status !== "Completed" && !task.due_date_override) updateTask.run(addDays(task.due_date, shift), nowISO(), task.id);
    database.prepare("UPDATE projects SET start_date=?,end_date=?,updated_at=? WHERE id=?")
      .run(input.startDate, addDays(project.end_date, shift), nowISO(), projectId);
    logActivity(projectId, null, user.id, "Timeline updated", `Program start date changed from ${project.start_date} to ${input.startDate}. ${tasks.filter((task) => task.status !== "Completed" && !task.due_date_override).length} task dates adjusted; completed and manually overridden dates preserved.`);
    const members = database.prepare("SELECT user_id FROM project_members WHERE project_id=?").all(projectId);
    for (const member of members) if (member.user_id !== user.id) notifyUser(member.user_id, projectId, `Program timeline updated: ${project.name}`);
    return send(response, 200, { ok: true });
  }
  if (request.method === "PATCH" && path.startsWith("/api/notifications/")) {
    const notificationId = decodeURIComponent(path.slice("/api/notifications/".length));
    const result = database.prepare("UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?").run(notificationId, user.id);
    return result.changes ? send(response, 200, { ok: true }) : send(response, 404, { error: "Notification not found." });
  }
  if (request.method === "POST" && path === "/api/integrations/airtable/import") {
    if (!["admin", "program_manager"].includes(user.role)) return send(response, 403, { error: "Only management can import Airtable programs." });
    const { AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_PROJECTS_TABLE, AIRTABLE_FIELD_MAPPING } = process.env;
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) return send(response, 503, { error: "Airtable is not configured. Add your Personal Access Token and base ID to .env, restart, and try again." });
    let mapping;
    try { mapping = JSON.parse(AIRTABLE_FIELD_MAPPING || "{}"); } catch { return send(response, 500, { error: "AIRTABLE_FIELD_MAPPING must contain valid JSON." }); }
    if (!AIRTABLE_PROJECTS_TABLE) return send(response, 503, { error: "Set AIRTABLE_PROJECTS_TABLE in .env to the table name or ID." });
    const table = encodeURIComponent(AIRTABLE_PROJECTS_TABLE);
    let endpoint = `https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE_ID)}/${table}`;
    const records = [];
    try {
      do {
        const result = await fetch(endpoint, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } });
        if (!result.ok) {
          const issue = await result.json().catch(() => ({}));
          return send(response, result.status === 401 || result.status === 403 ? 502 : 502, {
            error: `Airtable import failed (${result.status}): ${issue.error?.message || issue.error?.type || "check the token, base, table, and field mapping."}`
          });
        }
        const page = await result.json();
        records.push(...page.records);
        endpoint = page.offset ? `https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE_ID)}/${table}?offset=${encodeURIComponent(page.offset)}` : "";
      } while (endpoint);
    } catch (error) {
      return send(response, 502, { error: `Could not connect to Airtable: ${error.message}` });
    }
    const getField = (fields, name, fallback = "") => {
      const key = mapping[name];
      return key ? fields[key] ?? fallback : fallback;
    };
    let imported = 0;
    let skipped = 0;
    const upsert = database.prepare(`INSERT INTO projects
      (id,name,description,program_type,location,host_organization,start_date,end_date,status,project_manager_id,airtable_record_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(airtable_record_id) DO UPDATE SET name=excluded.name,description=excluded.description,
      program_type=excluded.program_type,location=excluded.location,host_organization=excluded.host_organization,
      start_date=excluded.start_date,end_date=excluded.end_date,status=excluded.status,updated_at=excluded.updated_at`);
    for (const record of records) {
      const fields = record.fields || {};
      const name = getField(fields, "name");
      const location = getField(fields, "location");
      const startDate = getField(fields, "startDate");
      const endDate = getField(fields, "endDate", startDate);
      if (!name || !location || !validateDate(startDate) || !validateDate(endDate)) {
        skipped++;
        continue;
      }
      const existing = database.prepare("SELECT id FROM projects WHERE airtable_record_id=?").get(record.id);
      upsert.run(existing?.id || randomUUID(), String(name), String(getField(fields, "description")),
        String(getField(fields, "programType", "Community")), String(location),
        String(getField(fields, "hostOrganization")), startDate, endDate,
        startDate > offsetDate(30) ? "Planning" : "On Track", user.id, record.id, nowISO(), nowISO());
      if (!existing) imported++;
    }
    return send(response, 200, { imported, updated: records.length - imported - skipped, skipped, total: records.length });
  }
  return send(response, 404, { error: "API route not found." });
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml"
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url);
    const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const filePath = normalize(join(publicDir, requestedPath));
    if (filePath !== publicDir && !filePath.startsWith(`${publicDir}/`)) return send(response, 403, "Forbidden", "text/plain; charset=utf-8");
    const content = await readFile(filePath);
    return send(response, 200, content, mimeTypes[extname(filePath)] || "application/octet-stream");
  } catch (error) {
    if (error.code === "ENOENT" && !url.pathname.startsWith("/api/")) {
      return send(response, 404, "Not found.", "text/plain; charset=utf-8");
    }
    console.error(error);
    if (!response.headersSent) send(response, 500, { error: error.message || "Unexpected server error." });
    else response.end();
  }
});
const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () => console.log(`NMU Program Management running at http://localhost:${port}`));
