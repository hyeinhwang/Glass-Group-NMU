const storedDevEmail = () => { try { return localStorage.getItem("nmu-dev-email") || ""; } catch { return ""; } };
const state = {
  page: "overview", userId: null, devEmail: storedDevEmail(), authConfig: { mode: "google" },
  data: null, projectId: null, projectTab: "overview", projectSearch: "", projectStatus: "all",
  taskStatusFilter: "all", taskSearch: "", myTaskFilter: "All tasks", accountUsers: [], schemaCheck: null,
  airtableData: { tables: [], selectedTableId: null, records: [], recordLabels: {}, total: 0, offset: 0, limit: 25, query: "", loading: false }
};
const authErrors = {
  domain: "Sign in with your verified NMU Google account.",
  not_registered: "Your NMU account is not set up for this app yet. Ask an administrator to add your email to Airtable Users with Rights set to Admin, Manager, or Contributor.",
  state: "Your sign-in session expired. Please try again.",
  cancelled: "Google sign-in was cancelled.",
  google: "Google sign-in could not be verified. Please try again.",
  not_configured: "Google sign-in is not configured on the server yet."
};
const content = document.getElementById("content");
const modalRoot = document.getElementById("modal-root");
const toastEl = document.getElementById("toast");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);
const dateLabel = (value, options = { month: "short", day: "numeric", year: "numeric" }) => {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, options).format(new Date(year, month - 1, day));
};
const initials = (name = "") => name.split(/\s+/).map((part) => part[0] || "").slice(0, 2).join("").toUpperCase();
const userRole = () => state.data?.currentUser?.role || "contributor";
const isManager = () => ["admin", "manager"].includes(userRole());
const isDevMode = () => state.authConfig.mode === "dev";
const isAdmin = () => userRole() === "admin";
const today = () => new Date().toISOString().slice(0, 10);
const dayDiff = (date) => date ? Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86400000) : NaN;
const isOverdue = (task) => task.status !== "Completed" && Boolean(task.dueDate) && task.dueDate < today();
const byDueDate = (a, b) => (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31");
const projectById = (id) => state.data?.projects.find((project) => project.id === id);
const tasksForProject = (projectId) => state.data?.tasks.filter((task) => task.projectId === projectId) || [];
function showToast(message, error = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle("error", error);
  toastEl.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toastEl.classList.remove("show"), 3200);
}
async function api(path, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (isDevMode() && state.devEmail) headers["x-dev-user"] = state.devEmail;
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.prerequisites?.length
      ? `${body.error} Prerequisites: ${body.prerequisites.join(", ")}`
      : body.error || `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return body;
}
async function refresh() {
  try {
    state.authConfig = await api("/api/auth/config");
    state.data = await api("/api/bootstrap");
    state.userId = state.data.currentUser.id;
    state.accountUsers = state.data.currentUser.role === "admin" ? (await api("/api/users")).users : [];
    document.body.classList.remove("auth-screen");
    render();
  } catch (error) {
    if (error.message === "Sign in to continue.") {
      state.data = null;
      const params = new URLSearchParams(location.search);
      const code = params.get("auth_error");
      if (code) history.replaceState(null, "", location.pathname);
      renderLogin(code ? authErrors[code] || "Sign-in failed. Please try again." : (isDevMode() && state.devEmail ? `${state.devEmail} is not an Airtable user with Rights set.` : ""));
      return;
    }
    content.innerHTML = `<div class="inline-error">Could not load the workspace: ${escapeHtml(error.message)}</div>`;
  }
}
function renderLogin(message = "") {
  document.body.classList.add("auth-screen");
  modalRoot.innerHTML = "";
  const config = state.authConfig;
  const google = config.googleConfigured
    ? `<a class="button primary" href="/auth/google/login">Sign in with Google</a><p class="form-hint">Use your ${escapeHtml(config.allowedDomain ? `@${config.allowedDomain}` : "NMU")} Google account. Your access level comes from your Airtable Users record.</p>`
    : `<div class="inline-error">Google sign-in is not configured. Set ${escapeHtml((config.missingConfiguration || []).join(", "))} in the service variables, then redeploy.</div>`;
  const dev = `<form id="login-form"><div class="form-field"><label for="login-email">Airtable Users email (development only)</label><input id="login-email" name="email" type="email" required value="${escapeHtml(state.devEmail)}"></div><button class="button primary" type="submit">Continue</button></form>`;
  content.innerHTML = `<section class="login-card" aria-labelledby="login-title"><div class="brand-symbol">n</div><div class="eyebrow">NMU PROGRAM OPERATIONS</div><h1 id="login-title">Sign in to your workspace</h1>
    ${message?`<div class="inline-error">${escapeHtml(message)}</div>`:""}
    ${isDevMode() ? dev : google}
  </section>`;
}
function setNavigation(page) {
  if (page === "airtable-data" && !isAdmin()) return;
  state.page = page;
  state.projectId = null;
  document.querySelectorAll(".nav-link").forEach((item) => item.classList.toggle("active", item.dataset.nav === page));
  document.querySelectorAll(".mobile-bottom button").forEach((item) => item.classList.toggle("active", item.dataset.nav === page));
  render();
  if (page === "airtable-data") loadAirtableTables();
}
function statusBadge(status, overdue = false) {
  const value = overdue ? "Overdue" : status || "Planning";
  const className = value.toLowerCase().replaceAll(" ", "-");
  return `<span class="badge ${escapeHtml(className)}">${escapeHtml(value)}</span>`;
}
function priorityLabel(priority) {
  if (!priority) return `<span class="muted">—</span>`;
  return `<span class="priority ${escapeHtml((priority || "medium").toLowerCase())}">${escapeHtml(priority || "Medium")}</span>`;
}
function progressMarkup(progress) {
  return `<div class="progress-wrap"><span class="progress-track"><span style="width:${Math.min(100, Math.max(0, progress))}%"></span></span><span class="progress-number">${progress}%</span></div>`;
}
function pageHeading(eyebrow, title, description, actions = "") {
  return `<header class="page-heading"><div><div class="eyebrow">${escapeHtml(eyebrow)}</div><h1>${escapeHtml(title)}</h1><p class="heading-copy">${escapeHtml(description)}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ""}</header>`;
}
function statCard(label, value, note, icon, tone = "") {
  return `<article class="stat-card"><div class="stat-top"><span>${escapeHtml(label)}</span><span class="stat-icon ${tone}">${icon}</span></div><div class="stat-value">${escapeHtml(value)}</div><div class="stat-foot">${escapeHtml(note)}</div></article>`;
}
function projectTable(projects) {
  if (!projects.length) return `<div class="empty-state"><span class="empty-mark">▦</span><strong>No programs match</strong>Adjust your search or filters to see programs.</div>`;
  return `<div class="table-wrap"><table class="project-table"><thead><tr><th>Program</th><th>Location</th><th>Start date</th><th>Tasks</th><th>Progress</th><th>Status</th></tr></thead><tbody>${projects.map((project) => `
    <tr>
      <td><button class="project-link" data-project="${escapeHtml(project.id)}">${escapeHtml(project.name)}</button><span class="secondary-cell">${escapeHtml(project.sessionName || "Session")}</span></td>
      <td>${escapeHtml(project.location)}</td>
      <td>${dateLabel(project.startDate,{month:"short",day:"numeric"})}</td>
      <td>${project.completedCount}/${project.taskCount}</td>
      <td>${progressMarkup(project.progress)}</td>
      <td>${statusBadge(project.status)}</td>
    </tr>`).join("")}</tbody></table></div>`;
}
function filteredProjects() {
  const query = state.projectSearch.trim().toLowerCase();
  return [...state.data.projects].filter((project) => {
    const matchesText = !query || [project.name, project.location, project.sessionName].some((value) => (value || "").toLowerCase().includes(query));
    const matchesStatus = state.projectStatus === "all" || project.status === state.projectStatus;
    return matchesText && matchesStatus;
  }).sort((a, b) => (a.startDate || "9999").localeCompare(b.startDate || "9999"));
}
function renderOverview() {
  const projects = state.data.projects;
  const tasks = state.data.tasks;
  const active = projects.filter((project) => project.status !== "Completed");
  const overdue = tasks.filter(isOverdue);
  const dueSoon = tasks.filter((task) => task.status !== "Completed" && dayDiff(task.dueDate) >= 0 && dayDiff(task.dueDate) <= 7);
  const completed = projects.filter((project) => project.status === "Completed").length;
  const completion = tasks.length ? Math.round(tasks.filter((task) => task.status === "Completed").length / tasks.length * 100) : 0;
  const atRisk = projects.filter((project) => project.status === "At Risk");
  const soonTasks = [...tasks].filter((task) => task.status !== "Completed").sort(byDueDate).slice(0, 5);
  const actions = `${isManager()?`<button class="button primary" data-action="create-project">＋ Create program</button>`:""}<button class="button ghost" data-nav="settings">↗ Airtable</button>`;
  return `${pageHeading("PROGRAM OPERATIONS", `Good morning, ${state.data.currentUser.name.split(" ")[0] || "team"}.`, "A clear view of every swim program, from early planning through the final report.", actions)}
    <div class="stat-grid" aria-label="Organization summary">
      ${statCard("Active programs", active.length, `${projects.length} total programs`, "▦")}
      ${statCard("Tasks due this week", dueSoon.length, "Across programs you can access", "◷", "blue")}
      ${statCard("Overdue tasks", overdue.length, "Needs attention", "!", "red")}
      ${statCard("Overall completion", `${completion}%`, `${completed} completed program${completed===1?"":"s"}`, "✓")}
    </div>
    <div class="dashboard-grid">
      <section class="panel">
        <div class="panel-head"><div><h2 class="panel-title">Programs</h2><p class="panel-subtitle">A snapshot of active and upcoming work</p></div><div class="panel-actions"><input class="search-input" data-filter="project-search" placeholder="Search programs…" value="${escapeHtml(state.projectSearch)}" aria-label="Search programs"><select class="filter-select" data-filter="project-status" aria-label="Filter by program status"><option value="all">All statuses</option>${["On Track","At Risk","Planning","Completed"].map((item) => `<option ${state.projectStatus===item?"selected":""}>${item}</option>`).join("")}</select></div></div>
        ${projectTable(filteredProjects())}
      </section>
      <div class="right-stack">
        <section class="panel"><div class="panel-head"><div><h2 class="panel-title">Needs attention</h2><p class="panel-subtitle">Programs with risk indicators</p></div></div>${atRisk.length ? atRisk.map((project) => `<div class="compact-project" data-project="${escapeHtml(project.id)}"><strong>${escapeHtml(project.name)}</strong>${statusBadge(project.status)}<small>${project.progress}% complete · ${escapeHtml(project.location)}</small></div>`).join("") : `<div class="empty-state"><span class="empty-mark">✓</span><strong>All clear</strong>No at-risk programs right now.</div>`}</section>
        <section class="panel"><div class="panel-head"><div><h2 class="panel-title">Next deadlines</h2><p class="panel-subtitle">Upcoming work across programs</p></div><button class="button small ghost" data-nav="timeline">View timeline</button></div>${soonTasks.length ? soonTasks.map((task) => `<div class="task-row"><div><button class="task-link" data-task="${escapeHtml(task.id)}">${escapeHtml(task.title)}</button><div class="task-row-meta">${escapeHtml(task.projectName)} · ${dateLabel(task.dueDate,{month:"short",day:"numeric"})}</div></div>${statusBadge(task.status,isOverdue(task))}</div>`).join("") : `<div class="empty-state">No upcoming deadlines.</div>`}</section>
      </div>
    </div>`;
}
function renderProjects() {
  const actions = isManager() ? `<button class="button primary" data-action="create-project">＋ Create program</button>` : "";
  return `${pageHeading("PROGRAMS", "All programs", "Search programs, review deadlines, and open a workspace to coordinate the team.", actions)}
    <section class="panel"><div class="panel-head"><div><h2 class="panel-title">Program portfolio</h2><p class="panel-subtitle">${state.data.projects.length} accessible programs · sorted by start date</p></div><div class="panel-actions"><input class="search-input" data-filter="project-search" placeholder="Search programs…" value="${escapeHtml(state.projectSearch)}" aria-label="Search programs"><select class="filter-select" data-filter="project-status" aria-label="Filter by program status"><option value="all">All statuses</option>${["On Track","At Risk","Planning","Completed"].map((item) => `<option ${state.projectStatus===item?"selected":""}>${item}</option>`).join("")}</select></div></div>${projectTable(filteredProjects())}</section>`;
}
function taskRow(task, compact = false) {
  const overdue = isOverdue(task);
  const currentUserTask = task.assignedUserId === state.userId;
  const status = task.isBlocked ? "Blocked" : task.status;
  return `<div class="${compact ? "my-task" : "task-row"}">
    <div class="${compact ? "my-task-info" : ""}"><button class="task-link" data-task="${escapeHtml(task.id)}">${escapeHtml(task.title)}</button><small class="${compact ? "" : "task-row-meta"}">${escapeHtml(task.projectName)}${task.assigneeName && !compact ? ` · ${escapeHtml(task.assigneeName)}` : ""}${task.milestone ? ` · ${escapeHtml(task.milestone)}` : ""}</small></div>
    ${compact ? `<span class="${overdue?"my-task-date overdue-text":"my-task-date"}">${dateLabel(task.dueDate,{month:"short",day:"numeric"})}${overdue?" · late":""}</span><span>${priorityLabel(task.priority)}</span>${statusBadge(status,overdue)}` : statusBadge(status,overdue)}
  </div>`;
}
function renderMyTasks() {
  const all = state.data.tasks.filter((task) => task.assignedUserId === state.userId);
  const query = state.taskSearch.toLowerCase().trim();
  const searchable = all.filter((task) => !query || `${task.title} ${task.projectName} ${task.description}`.toLowerCase().includes(query));
  const groups = [
    ["Due soon", searchable.filter((task) => task.status !== "Completed" && dayDiff(task.dueDate) >= 0 && dayDiff(task.dueDate) <= 7)],
    ["Overdue", searchable.filter(isOverdue)],
    ["Blocked", searchable.filter((task) => task.isBlocked)],
    ["In progress", searchable.filter((task) => task.status === "In Progress" && !task.isBlocked && !isOverdue(task))],
    ["Not started", searchable.filter((task) => task.status === "Not Started" && !task.isBlocked && !isOverdue(task) && dayDiff(task.dueDate) > 7)],
    ["Completed", searchable.filter((task) => task.status === "Completed")]
  ];
  const selectedGroup = state.myTaskFilter;
  const visible = selectedGroup === "All tasks" ? groups : groups.filter(([name]) => name === selectedGroup);
  return `${pageHeading("PERSONAL WORKSPACE", "My tasks", `Your assigned work across ${new Set(all.map((task) => task.projectId)).size} program${new Set(all.map((task) => task.projectId)).size===1?"":"s"}. Update progress, review dependencies, and leave context for your team.`)}
    <div class="toolbar"><div class="filter-row">${["All tasks","Due soon","Overdue","Blocked","In progress","Not started","Completed"].map((label) => `<button class="button small ${state.myTaskFilter===label?"primary":"ghost"}" data-my-filter="${escapeHtml(label)}">${escapeHtml(label)}</button>`).join("")}</div><input class="search-input" data-filter="task-search" placeholder="Find a task…" value="${escapeHtml(state.taskSearch)}" aria-label="Search my tasks"></div>
    ${visible.map(([label, tasks]) => `<div class="section-label">${label} <span class="muted">(${tasks.length})</span></div>${tasks.length ? `<div class="task-list">${tasks.sort(byDueDate).map((task) => taskRow(task,true)).join("")}</div>` : `<div class="task-list"><div class="empty-state"><strong>Nothing here right now</strong>${label==="Overdue"?"No overdue assigned work.":"Tasks will appear here as work is assigned."}</div></div>`}`).join("")}`;
}
function renderTimeline() {
  const tasks = state.data.tasks.filter((task) => task.status !== "Completed").sort(byDueDate);
  const groups = new Map();
  for (const task of tasks) {
    const key = task.dueDate ? new Date(`${task.dueDate}T12:00:00`).toLocaleDateString(undefined,{month:"long",year:"numeric"}) : "No due date";
    groups.set(key,[...(groups.get(key)||[]),task]);
  }
  return `${pageHeading("SCHEDULE", "Program timeline", "A chronological view of upcoming work, grouped by month. Blocked and overdue tasks stay visible so teams can act early.")}
    <div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h2 class="panel-title">Upcoming deadlines</h2><p class="panel-subtitle">${tasks.length} open tasks · all accessible programs</p></div></div>${tasks.length ? [...groups.entries()].map(([month,items])=>`<div class="panel-head"><h3 class="panel-title">${escapeHtml(month)}</h3></div><div class="timeline-list">${items.map((task)=>`<div class="timeline-item ${isOverdue(task)?"overdue":""}"><time class="timeline-date">${dateLabel(task.dueDate,{month:"short",day:"numeric"})}</time><span class="timeline-marker"></span><div class="timeline-copy"><strong><button class="task-link" data-task="${escapeHtml(task.id)}">${escapeHtml(task.title)}</button></strong><small>${escapeHtml(task.projectName)} · ${escapeHtml(task.assigneeName || "Unassigned")} · ${task.isBlocked?"Blocked by prerequisite":task.status}</small></div></div>`).join("")}</div>`).join("") : `<div class="empty-state"><strong>No open deadlines</strong>All tasks are complete.</div>`}</section><section class="panel"><div class="panel-head"><div><h2 class="panel-title">Date changes</h2><p class="panel-subtitle">Preview and apply from a program workspace</p></div></div><div class="empty-state"><span class="empty-mark">◷</span><strong>Replan with a preview</strong>Open a program workspace and choose “Adjust dates” to preview how an updated program start date will shift outstanding tasks.</div></section></div>`;
}
function renderTemplates() {
  return `${pageHeading("REUSABLE WORKFLOWS", "Task templates", "Each Airtable Template List entry is a repeatable checklist of Steps. New programs get one task per Step, due relative to the session start date.")}
    ${state.data.templates.length?`<div class="template-grid">${state.data.templates.map((template)=>`<article class="template-card"><div class="eyebrow">AIRTABLE TEMPLATE</div><h2>${escapeHtml(template.name)}</h2><p>${template.steps.slice(0,4).map((step)=>escapeHtml(step.title)).join(" · ")}${template.steps.length>4?" …":""}</p><div class="template-meta"><span>${template.stepCount} steps · relative deadlines</span><span>Edit in Airtable</span></div></article>`).join("")}</div>`:`<div class="empty-state"><strong>No templates yet</strong>Add a Template List record with Steps in Airtable.</div>`}
    <div class="integration-callout" style="margin-top:16px">Templates and Steps are maintained in Airtable. Changes apply to programs created afterward.</div>`;
}
function renderNotifications() {
  const notifications = state.data.notifications;
  return `${pageHeading("UPDATES", "Notifications", "Task assignments, newly unblocked work, and schedule updates for your account.", notifications.some((item)=>!item.isRead)?`<button class="button ghost" data-action="mark-all-read">Mark all read</button>`:"")}
    <section class="panel"><div class="panel-head"><div><h2 class="panel-title">Your notifications</h2><p class="panel-subtitle">${notifications.filter((item)=>!item.isRead).length} unread · only visible to your account</p></div></div>${notifications.length ? notifications.map((item)=>`<article class="notification-card ${item.isRead?"":"unread"}"><span class="notification-icon">♧</span><div class="notification-copy"><p>${escapeHtml(item.message)}</p><time>${dateLabel(item.createdAt,{month:"short",day:"numeric"})} · ${new Date(item.createdAt).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})}</time></div>${!item.isRead?`<button class="text-action" data-read-notification="${escapeHtml(item.id)}">Mark read</button>`:""}</article>`).join(""):`<div class="empty-state"><span class="empty-mark">♧</span><strong>You’re all caught up</strong>New task assignments and program updates will show here.</div>`}</section>`;
}
function airtableCellValue(value, recordLabels) {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === "object" && item.id) return item.name || recordLabels[item.id] || item.id;
      return typeof item === "object" ? JSON.stringify(item) : String(item);
    }).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function renderAirtableData() {
  if (!isAdmin()) return pageHeading("ADMINISTRATION", "Access denied", "Only administrators can inspect synchronized Airtable data.");
  const data = state.airtableData;
  const selected = data.tables.find((table) => table.id === data.selectedTableId);
  const recordTable = selected ? `<section class="panel airtable-record-panel">
    <div class="panel-head"><div><h2 class="panel-title">${escapeHtml(selected.name)}</h2><p class="panel-subtitle">${data.total} matching records · live from Airtable</p></div>
      <form class="airtable-search-form" id="airtable-search-form"><input class="search-input" name="query" aria-label="Search Airtable records" placeholder="Search this table…" value="${escapeHtml(data.query)}"><button class="button small ghost" type="submit">Search</button></form>
    </div>
    ${data.loading ? `<div class="empty-state"><span class="spinner"></span>Loading Airtable records…</div>` : data.records.length ? `<div class="table-wrap airtable-record-wrap"><table class="airtable-record-table"><thead><tr><th>Record ID</th>${selected.fields.map((field) => `<th>${escapeHtml(field.name)}<small>${escapeHtml(field.type)}</small></th>`).join("")}</tr></thead><tbody>${data.records.map((record) => `<tr><td class="airtable-record-id">${escapeHtml(record.id)}</td>${selected.fields.map((field) => `<td>${escapeHtml(airtableCellValue(record.fields[field.name],data.recordLabels))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><strong>${data.query?"No matching records":"No records in this table"}</strong>${data.query?"Try a different search.":"This Airtable table is empty."}</div>`}
    <div class="airtable-pagination"><span>Showing ${data.total ? data.offset + 1 : 0}–${Math.min(data.offset + data.limit,data.total)} of ${data.total}</span><div><button class="button small ghost" data-airtable-page="${Math.max(0,data.offset-data.limit)}" ${data.offset===0||data.loading?"disabled":""}>Previous</button><button class="button small ghost" data-airtable-page="${data.offset+data.limit}" ${data.offset+data.limit>=data.total||data.loading?"disabled":""}>Next</button></div></div>
  </section>` : `<section class="panel"><div class="empty-state"><strong>No Airtable tables found</strong>${data.loading?"Loading…":"Check the Airtable connection in Settings."}</div></section>`;
  return `${pageHeading("ADMINISTRATOR WORKSPACE", "Airtable data", "Browse every table in the connected base, read live from Airtable. This read-only view is available only to administrators.")}
    <div class="stat-grid" aria-label="Airtable data summary">${statCard("Tables",data.tables.length,"Divider tables hidden","▧")}${statCard("Selected table",selected?data.total:"—",selected?`${selected.name} records`:"Choose a table","▤")}${statCard("Data source","Live","Airtable is the system of record","◷")}${statCard("Programs",state.data.projects.length,"Airtable Sessions","▦")}</div>
    <section class="panel airtable-table-picker"><div class="panel-head"><div><h2 class="panel-title">Base tables</h2><p class="panel-subtitle">Select a table to inspect its fields and records.</p></div><button class="button small ghost" data-action="airtable-refresh-data">↻ Refresh table list</button></div>
      ${data.tables.length ? `<div class="airtable-table-chips">${data.tables.map((table)=>`<button class="airtable-table-chip ${table.id===data.selectedTableId?"selected":""}" data-airtable-table="${escapeHtml(table.id)}" aria-pressed="${table.id===data.selectedTableId}"><span>${escapeHtml(table.name)}</span><small>${table.fields.length} fields</small></button>`).join("")}</div>` : `<div class="empty-state">${data.loading?"Loading Airtable tables…":"No tables found."}</div>`}
    </section>
    ${recordTable}`;
}
async function loadAirtableTables() {
  if (!isAdmin()) return;
  state.airtableData.loading = true;
  render();
  try {
    const result = await api("/api/integrations/airtable/tables");
    state.airtableData.tables = result.tables;
    if (!result.tables.some((table) => table.id === state.airtableData.selectedTableId)) {
      state.airtableData.selectedTableId = result.tables[0]?.id || null;
      state.airtableData.query = "";
      state.airtableData.offset = 0;
    }
    state.airtableData.loading = false;
    render();
    if (state.airtableData.selectedTableId) await loadAirtableRecords(0);
  } catch (error) {
    state.airtableData.loading = false;
    render();
    showToast(error.message,true);
  }
}
async function loadAirtableRecords(offset = state.airtableData.offset) {
  const data = state.airtableData;
  if (!data.selectedTableId || !isAdmin()) return;
  const tableId = data.selectedTableId;
  data.loading = true;
  render();
  try {
    const query = new URLSearchParams({ limit: String(data.limit), offset: String(offset) });
    if (data.query) query.set("q",data.query);
    const result = await api(`/api/integrations/airtable/tables/${encodeURIComponent(tableId)}/records?${query}`);
    if (data.selectedTableId !== tableId) return;
    data.records = result.records;
    data.recordLabels = result.recordLabels;
    data.total = result.total;
    data.offset = result.offset;
  } catch (error) {
    showToast(error.message,true);
  } finally {
    if (data.selectedTableId === tableId) {
      data.loading = false;
      render();
    }
  }
}
function renderSettings() {
  const connected = state.data.integration.airtableConfigured;
  const check = state.schemaCheck;
  const problems = check ? [
    check.missingTables.length ? `Missing tables: ${check.missingTables.map(escapeHtml).join(", ")}.` : "",
    check.missingFields.length ? `Missing fields: ${check.missingFields.map(escapeHtml).join(", ")}.` : "",
    check.computedWriteFields.length ? `These must be editable (not formula/lookup): ${check.computedWriteFields.map(escapeHtml).join(", ")}.` : ""
  ].filter(Boolean) : [];
  const checkResult = check ? `<div class="integration-callout ${problems.length?"warning":""}" style="margin-top:14px">${problems.length ? problems.join("<br>") : `Schema verified: ${check.tables.length} tables found and every required field is present.`}</div>` : "";
  const team = isAdmin() ? `<section class="integration-panel" style="margin-top:14px"><div class="eyebrow">TEAM ACCESS</div><h2>Who can sign in</h2><p>Access is managed in the Airtable <span class="code">Users</span> table. A teammate can sign in with their NMU Google account when their <span class="code">Email Address</span> is listed and <span class="code">Rights</span> is Admin, Manager, or Contributor. Clearing Rights removes access.</p>
      <div class="table-wrap" style="margin-top:12px"><table class="project-table"><thead><tr><th>Name</th><th>Email</th><th>Rights</th></tr></thead><tbody>${state.accountUsers.map((account)=>`<tr><td>${escapeHtml(account.name)}</td><td>${escapeHtml(account.email||"—")}</td><td>${escapeHtml(account.roleLabel)}</td></tr>`).join("")}</tbody></table></div>
    </section>` : "";
  const airtableSettings = isAdmin() ? `${pageHeading("WORKSPACE SETTINGS", "Airtable connection", "Airtable is the system of record: programs, tasks, comments, activity, and notifications are read from and written to the connected base.")}
    <section class="integration-panel"><div class="eyebrow">AIRTABLE · SYSTEM OF RECORD</div><h2>Connected base</h2>
      <div class="integration-callout ${connected?"":"warning"}">${connected?"Airtable credentials are configured on the server.":"Airtable credentials are not configured. Add AIRTABLE_API_KEY and AIRTABLE_BASE_ID in the service variables, then redeploy."}</div>
      <p><b>Work fields:</b> the app writes only <span class="code">Task Status</span>, <span class="code">Due Date Override</span>, <span class="code">Assigned To</span>, and <span class="code">Completed Date</span>. <span class="code">Due Date</span>, <span class="code">Status</span>, and <span class="code">Assignee</span> are formula/lookup fields and are never written. Due dates are read from <span class="code">Effective Due Date</span>, then <span class="code">Due Date Override</span>, then <span class="code">Due Date</span>.</p>
      <p><b>Access:</b> the server token needs <span class="code">schema.bases:read</span>, <span class="code">data.records:read</span>, and <span class="code">data.records:write</span> on this base. Keep it in the service variables only.</p>
      <div class="heading-actions"><button class="button ghost" data-action="airtable-check" ${connected?"":"disabled"}>Check schema access</button></div>
      ${checkResult}
    </section>` : pageHeading("ACCOUNT SETTINGS", "Your account", `Signed in as ${state.data.currentUser.email} · ${state.data.currentUser.roleLabel}. Your access level is set in Airtable Users.`);
  return `${airtableSettings}${team}
    ${isDevMode()?`<section class="integration-panel" style="margin-top:14px"><div class="eyebrow">DEVELOPMENT MODE</div><h2>Development identity</h2><p>You are identified by an Airtable Users email without Google sign-in. Use Sign out to switch identities.</p><div class="integration-callout warning">Development mode is refused when NODE_ENV=production.</div></section>`:""}`;
}
function projectTabs() {
  return `<nav class="project-tabs" aria-label="Program workspace sections">${["overview","tasks","timeline","team","activity"].map((tab)=>`<button class="project-tab ${state.projectTab===tab?"active":""}" data-project-tab="${tab}">${tab[0].toUpperCase()+tab.slice(1)}</button>`).join("")}</nav>`;
}
function taskTable(tasks, projectId) {
  const external = false;
  const shown = tasks;
  return shown.length ? `<div class="table-wrap"><table class="task-table"><thead><tr><th>Task</th><th>Owner</th><th>Due</th><th>Priority</th><th>Status</th></tr></thead><tbody>${shown.map((task)=>`<tr><td><button class="task-link" data-task="${escapeHtml(task.id)}">${escapeHtml(task.title)}</button><span class="secondary-cell">${task.dueDateOverride?"Deadline overridden":"Template deadline"}${task.isBlocked?" · Prerequisite incomplete":""}</span></td><td>${escapeHtml(task.assigneeName||"Unassigned")}</td><td>${dateLabel(task.dueDate,{month:"short",day:"numeric"})}</td><td>${priorityLabel(task.priority)}</td><td>${statusBadge(task.isBlocked?"Blocked":task.status,isOverdue(task))}</td></tr>`).join("")}</tbody></table></div>`:`<div class="empty-state"><strong>No tasks to display</strong>${external?"You only see tasks assigned to your partner account.":"This program has no tasks yet."}</div>`;
}
function renderProject(data) {
  const { project, tasks, members, activities, comments } = data;
  const allowedTasks = tasks;
  const pageActions = isManager() ? `<button class="button ghost" data-action="replan">◷ Adjust dates</button>` : "";
  let pane = "";
  if (state.projectTab === "overview") {
    const next = allowedTasks.filter((task)=>task.status!=="Completed").sort(byDueDate).slice(0,4);
    pane = `<div class="detail-grid"><section class="panel"><div class="panel-head"><div><h2 class="panel-title">Program details</h2><p class="panel-subtitle">Shared context for the team handoff</p></div></div><div class="detail-list">
      <div class="detail-item"><span>Session</span><strong>${escapeHtml(project.sessionName||"—")}</strong></div><div class="detail-item"><span>Location</span><strong>${escapeHtml(project.location)}</strong></div>
      <div class="detail-item"><span>Start date</span><strong>${dateLabel(project.startDate)}</strong></div><div class="detail-item"><span>End date</span><strong>${dateLabel(project.endDate)}</strong></div>
      <div class="detail-item"><span>Status</span><strong>${escapeHtml(project.status)}</strong></div><div class="detail-item"><span>Progress</span><strong>${project.progress}% · ${project.completedCount}/${project.taskCount} tasks</strong></div>
      <div class="detail-item"><span>Team</span><strong>${members.length} assigned ${members.length===1?"person":"people"}</strong></div><div class="detail-item"><span>Source</span><strong>Airtable Session</strong></div>
    </div></section><section class="panel"><div class="panel-head"><div><h2 class="panel-title">Upcoming work</h2><p class="panel-subtitle">Open items by due date</p></div><button class="button small ghost" data-project-tab="tasks">All tasks</button></div>${next.length?next.map((task)=>`<div class="task-row"><div><button class="task-link" data-task="${escapeHtml(task.id)}">${escapeHtml(task.title)}</button><div class="task-row-meta">${dateLabel(task.dueDate,{month:"short",day:"numeric"})} · ${escapeHtml(task.assigneeName||"Unassigned")}</div></div>${statusBadge(task.isBlocked?"Blocked":task.status,isOverdue(task))}</div>`).join(""):`<div class="empty-state"><strong>All caught up</strong>No outstanding tasks.</div>`}</section></div>`;
  } else if (state.projectTab === "tasks") {
    pane = `<section class="panel"><div class="panel-head"><div><h2 class="panel-title">Program tasks</h2><p class="panel-subtitle">${allowedTasks.length} tasks · completion updates the project progress automatically</p></div><div class="panel-actions"><input class="search-input" data-filter="task-search" placeholder="Search tasks…" value="${escapeHtml(state.taskSearch)}" aria-label="Search program tasks"><select class="filter-select" data-filter="task-status" aria-label="Filter tasks by status"><option value="all">All statuses</option>${["Not Started","In Progress","Blocked","Completed"].map((status)=>`<option ${state.taskStatusFilter===status?"selected":""}>${status}</option>`).join("")}</select></div></div>${taskTable(allowedTasks.filter((task)=>{const q=state.taskSearch.toLowerCase();return (!q||`${task.title} ${task.assigneeName} ${task.milestone}`.toLowerCase().includes(q))&&(state.taskStatusFilter==="all"|| (task.isBlocked?"Blocked":task.status)===state.taskStatusFilter)}),project.id)}</section>`;
  } else if (state.projectTab === "timeline") {
    const grouped = new Map();
    for (const task of allowedTasks.slice().sort(byDueDate)) {
      const key = task.dueDate ? new Date(`${task.dueDate}T12:00:00`).toLocaleDateString(undefined,{month:"long",year:"numeric"}) : "No due date";
      grouped.set(key,[...(grouped.get(key)||[]),task]);
    }
    pane = `<section class="panel"><div class="panel-head"><div><h2 class="panel-title">Planning timeline</h2><p class="panel-subtitle">Tasks grouped by due month</p></div></div>${[...grouped.entries()].map(([phase,items])=>`<div class="panel-head"><h3 class="panel-title">${escapeHtml(phase)}</h3><span class="muted">${items.length} tasks</span></div><div class="timeline-list">${items.map((task)=>`<div class="timeline-item ${isOverdue(task)?"overdue":""}"><time class="timeline-date">${dateLabel(task.dueDate,{month:"short",day:"numeric"})}</time><span class="timeline-marker"></span><div class="timeline-copy"><strong><button class="task-link" data-task="${escapeHtml(task.id)}">${escapeHtml(task.title)}</button></strong><small>${escapeHtml(task.assigneeName||"Unassigned")} · ${task.isBlocked?"Blocked by prerequisite":task.status}</small></div></div>`).join("")}</div>`).join("")}</section>`;
  } else if (state.projectTab === "team") {
    const visibleMembers = members;
    pane = `<section class="panel"><div class="panel-head"><div><h2 class="panel-title">Program team</h2><p class="panel-subtitle">${visibleMembers.length} member${visibleMembers.length===1?"":"s"} · role and responsibilities</p></div></div><div class="table-wrap"><table class="task-table"><thead><tr><th>Team member</th><th>Role</th><th>Assigned tasks</th></tr></thead><tbody>${visibleMembers.map((member)=>`<tr><td><b>${escapeHtml(member.name)}</b><span class="secondary-cell">${escapeHtml(member.email)}</span></td><td>${escapeHtml(member.projectRole)}</td><td>${allowedTasks.filter((task)=>task.assignedUserId===member.id).length}</td></tr>`).join("")}</tbody></table></div></section>`;
  } else {
    pane = `<section class="panel"><div class="panel-head"><div><h2 class="panel-title">Activity history</h2><p class="panel-subtitle">Important changes and handoff context</p></div></div>${activities.length?`<div class="activity-list">${activities.map((item)=>`<article class="activity-item"><span class="activity-dot"></span><div><strong>${escapeHtml(item.userName)} · ${escapeHtml(item.action)}</strong><p>${escapeHtml(item.details)}</p></div><time>${dateLabel(item.createdAt,{month:"short",day:"numeric"})}</time></article>`).join("")}</div>`:`<div class="empty-state">No activity recorded yet.</div>`}</section><section class="panel" style="margin-top:13px"><div class="panel-head"><div><h2 class="panel-title">Task notes</h2><p class="panel-subtitle">Context posted on individual task details</p></div></div>${comments.length?`<div class="activity-list">${comments.map((comment)=>`<article class="activity-item"><span class="activity-dot"></span><div><strong>${escapeHtml(comment.userName)} · ${escapeHtml(tasks.find((task)=>task.id===comment.taskId)?.title||"Task note")}</strong><p>${escapeHtml(comment.content)}</p></div><time>${dateLabel(comment.createdAt,{month:"short",day:"numeric"})}</time></article>`).join("")}</div>`:`<div class="empty-state">No task notes yet.</div>`}</section>`;
  }
  return `<div class="project-hero"><div><div class="eyebrow">${escapeHtml(project.sessionName||"Session")} · ${escapeHtml(project.location)}</div><h1>${escapeHtml(project.name)}</h1><div class="project-meta"><span>◷ ${dateLabel(project.startDate,{month:"short",day:"numeric"})} – ${dateLabel(project.endDate,{month:"short",day:"numeric",year:"numeric"})}</span><span>♙ ${members.length} assigned</span><span>${project.progress}% complete</span></div></div><div class="heading-actions">${statusBadge(project.status)}${pageActions}</div></div>
    ${projectTabs()}<div class="project-content">${pane}</div>`;
}
async function openProject(projectId) {
  state.projectId = projectId;
  state.projectTab = "overview";
  state.taskSearch = "";
  state.taskStatusFilter = "all";
  try {
    const projectData = await api(`/api/projects/${encodeURIComponent(projectId)}`);
    state.projectData = projectData;
    renderProjectPage();
  } catch (error) { showToast(error.message,true); }
}
function renderProjectPage() {
  const project = state.projectData?.project;
  if (!project) return;
  content.innerHTML = renderProject(state.projectData);
  document.getElementById("crumb-current").textContent = project.name;
}
function render() {
  if (!state.data) return;
  const user = state.data.currentUser;
  document.getElementById("current-user-label").textContent = `${user.name} · ${user.roleLabel}${isDevMode()?" · dev":""}`;
  document.getElementById("logout-button").hidden = false;
  document.getElementById("user-avatar").textContent = initials(user.name);
  document.getElementById("my-task-count").textContent = state.data.tasks.filter((task)=>task.assignedUserId===state.userId&&task.status!=="Completed").length;
  const unread = state.data.notifications.filter((item)=>!item.isRead).length;
  document.getElementById("notification-count").textContent = unread;
  document.getElementById("notification-indicator").classList.toggle("hidden",!unread);
  const integration = document.querySelector(".integration-status");
  integration.classList.toggle("connected",state.data.integration.airtableConfigured);
  document.getElementById("airtable-data-nav").hidden = !isAdmin();
  document.getElementById("mobile-airtable-data-nav").hidden = !isAdmin();
  document.getElementById("airtable-status").textContent = state.data.integration.airtableConfigured ? "Live" : "Not connected";
  document.getElementById("crumb-current").textContent = state.page.replaceAll("-"," ").replace(/\b\w/g,(letter)=>letter.toUpperCase());
  document.querySelectorAll(".nav-link").forEach((item)=>item.classList.toggle("active",item.dataset.nav===state.page&&!state.projectId));
  if (state.projectId && state.projectData) return renderProjectPage();
  const renderers = { overview:renderOverview, projects:renderProjects, "my-tasks":renderMyTasks, timeline:renderTimeline, templates:renderTemplates, notifications:renderNotifications, settings:renderSettings, "airtable-data":renderAirtableData };
  content.innerHTML = (renderers[state.page] || renderOverview)();
}
async function openTask(taskId) {
  let task = state.data.tasks.find((item)=>item.id===taskId);
  if (!task) return;
  let projectData = state.projectData?.project.id===task.projectId ? state.projectData : null;
  if (!projectData) {
    try { projectData = await api(`/api/projects/${encodeURIComponent(task.projectId)}`); }
    catch(error) { showToast(error.message,true); return; }
  }
  const fullTask = projectData.tasks.find((item)=>item.id===taskId);
  const comments = projectData.comments.filter((item)=>item.taskId===taskId);
  const managerControls = isManager();
  const users = state.data.users;
  const dependencies = fullTask.dependencies.length ? `<div class="form-field full"><label>Prerequisites</label><div class="integration-callout ${fullTask.isBlocked?"warning":""}">${fullTask.dependencies.map((item)=>`${escapeHtml(item.title)} — ${escapeHtml(item.status)}`).join("<br>")}</div></div>` : "";
  modalRoot.innerHTML = `<div class="modal-backdrop" data-close-modal><section class="modal" role="dialog" aria-modal="true" aria-labelledby="task-modal-title"><header class="modal-head"><div><h2 id="task-modal-title">${escapeHtml(fullTask.title)}</h2><p>${escapeHtml(projectData.project.name)}</p></div><button class="modal-close" data-action="close-modal" aria-label="Close dialog">×</button></header><form id="task-form" data-task-id="${escapeHtml(taskId)}" data-original-due-date="${escapeHtml(fullTask.dueDate||"")}"><div class="modal-body">
      <div class="form-grid"><div class="form-field"><label for="task-status">Status</label><select id="task-status" name="status" ${fullTask.canEdit?"":"disabled"}><option ${fullTask.status==="Not Started"?"selected":""}>Not Started</option><option ${fullTask.status==="In Progress"?"selected":""}>In Progress</option><option ${fullTask.status==="Completed"?"selected":""}>Completed</option></select></div>
      ${managerControls?`<div class="form-field"><label for="task-assignee">Assigned to</label><select id="task-assignee" name="assignedUserId"><option value="" ${fullTask.assignedUserId?"":"selected"} disabled>Unassigned</option>${users.map((item)=>`<option value="${escapeHtml(item.id)}" ${item.id===fullTask.assignedUserId?"selected":""}>${escapeHtml(item.name)}</option>`).join("")}</select></div>`:`<div class="form-field"><label>Assigned to</label><input disabled value="${escapeHtml(fullTask.assigneeName||"Unassigned")}"></div>`}
      <div class="form-field"><label for="task-due-date">Due date${managerControls?" · management override":""}</label><input id="task-due-date" name="dueDate" type="${managerControls?"date":"text"}" ${managerControls?`value="${escapeHtml(fullTask.dueDate||"")}"`:`disabled value="${dateLabel(fullTask.dueDate)}"`}></div><div class="form-field"><label>Deadline source</label><input disabled value="${fullTask.dueDateOverride?"Due Date Override":"Template (Due Date formula)"}"></div>
      <div class="form-field full"><label>Description</label><div class="integration-callout">${escapeHtml(fullTask.description||"No task description.")}</div></div>${dependencies}</div>
      ${isAdmin()&&fullTask.isBlocked?`<div class="form-field" style="margin-top:12px"><label for="override-reason">Administrator override reason · required to bypass prerequisites</label><textarea id="override-reason" name="overrideReason" maxlength="500" placeholder="Record why this task must be completed before its prerequisites."></textarea></div>`:""}
      <div class="section-label">Task notes (${comments.length})</div>${comments.length?`<div class="comment-list">${comments.map((item)=>`<article class="comment"><strong>${escapeHtml(item.userName)} · ${dateLabel(item.createdAt,{month:"short",day:"numeric"})}</strong><p>${escapeHtml(item.content)}</p></article>`).join("")}</div>`:`<div class="form-hint" style="margin:0 0 9px">No notes yet. Add context for the next person who picks up this work.</div>`}
      <div class="form-field"><label for="task-comment">Add a note</label><textarea id="task-comment" name="comment" maxlength="2000" placeholder="Add an update or handoff note…"></textarea></div>
    </div><footer class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">Cancel</button><button type="submit" class="button primary">Save updates</button></footer></form></section></div>`;
  }
function formField(label, name, type="text", options={}) {
  const required = options.required ? "required" : "";
  const full = options.full ? " full" : "";
  const value = options.value ? `value="${escapeHtml(options.value)}"` : "";
  const placeholder = options.placeholder ? `placeholder="${escapeHtml(options.placeholder)}"` : "";
  const step = options.step ? `step="${options.step}"` : "";
  if (type === "select") return `<div class="form-field${full}"><label for="${name}">${escapeHtml(label)}${options.required?" *":""}</label><select id="${name}" name="${name}" ${required}>${options.choices.map(([val,text])=>`<option value="${escapeHtml(val)}" ${options.value===val?"selected":""}>${escapeHtml(text)}</option>`).join("")}</select></div>`;
  if (type === "textarea") return `<div class="form-field${full}"><label for="${name}">${escapeHtml(label)}${options.required?" *":""}</label><textarea id="${name}" name="${name}" ${required} ${placeholder}>${escapeHtml(options.value||"")}</textarea></div>`;
  return `<div class="form-field${full}"><label for="${name}">${escapeHtml(label)}${options.required?" *":""}</label><input id="${name}" name="${name}" type="${type}" ${required} ${value} ${placeholder} ${step}></div>`;
}
function showProjectForm() {
  if (!isManager()) return;
  const { templates, sites } = state.data;
  if (!templates.length || !sites.length) { showToast("Add at least one Template List entry and one Site in Airtable first.", true); return; }
  const start = new Date(); start.setDate(start.getDate()+60);
  const end = new Date(start); end.setDate(end.getDate()+7);
  const startValue = start.toISOString().slice(0,10), endValue = end.toISOString().slice(0,10);
  modalRoot.innerHTML = `<div class="modal-backdrop" data-close-modal><section class="modal wide" role="dialog" aria-modal="true" aria-labelledby="project-modal-title"><header class="modal-head"><div><h2 id="project-modal-title">Create a program</h2><p>Creates an Airtable Session and one Work task per template Step.</p></div><button class="modal-close" data-action="close-modal" aria-label="Close dialog">×</button></header><form id="project-form"><div class="modal-body"><div class="form-grid">
    ${formField("Session name","name","text",{required:true,placeholder:"e.g. Spring 2027 Session"})}
    ${formField("Site","siteId","select",{required:true,choices:sites.map((site)=>[site.id,site.location?`${site.name} · ${site.location}`:site.name]),value:sites[0].id})}
    ${formField("Session start date","startDate","date",{required:true,value:startValue})}
    ${formField("Session end date","endDate","date",{required:true,value:endValue})}
    ${formField("Template","templateId","select",{required:true,full:true,choices:templates.map((item)=>[item.id,`${item.name} · ${item.stepCount} steps`]),value:templates[0].id})}
  </div><div class="preview-box" id="task-preview"></div></div><footer class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">Cancel</button><button type="submit" class="button primary">Create program and tasks</button></footer></form></section></div>`;
  const updatePreview = () => {
    const template = templates.find((item)=>item.id===document.getElementById("templateId").value);
    const startDate = document.getElementById("startDate").value;
    const steps = template?.steps || [];
    document.getElementById("task-preview").innerHTML = `<h3>Generated task preview · ${steps.length} tasks · ${escapeHtml(template?.name||"")}</h3>${steps.map((step)=>`<div class="preview-task"><span>${escapeHtml(step.title)}</span><span>${startDate?dateLabel(addDate(startDate,step.days),{month:"short",day:"numeric"}):`${step.days} days from start`}</span></div>`).join("")}`;
  };
  modalRoot.querySelector("#project-form").addEventListener("change",updatePreview);
  updatePreview();
}
function addDate(date, offset) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate()+Number(offset));
  return result.toISOString().slice(0,10);
}
async function showReplan() {
  const project = state.projectData.project;
  modalRoot.innerHTML = `<div class="modal-backdrop" data-close-modal><section class="modal" role="dialog" aria-modal="true" aria-labelledby="replan-title"><header class="modal-head"><div><h2 id="replan-title">Adjust program dates</h2><p>Preview the impact before updating outstanding task deadlines.</p></div><button class="modal-close" data-action="close-modal" aria-label="Close dialog">×</button></header><form id="replan-form"><div class="modal-body"><div class="form-field"><label for="new-start-date">New program start date</label><input id="new-start-date" name="startDate" type="date" required value="${escapeHtml(project.startDate)}"></div><div id="replan-preview" class="preview-box" style="margin-top:13px"></div></div><footer class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">Cancel</button><button type="submit" class="button primary">Confirm date change</button></footer></form></section></div>`;
  const form = modalRoot.querySelector("#replan-form");
  const preview = modalRoot.querySelector("#replan-preview");
  const update = async () => {
    try {
      const result = await api("/api/projects/date-preview",{method:"POST",body:JSON.stringify({projectId:project.id,startDate:form.startDate.value})});
      preview.innerHTML = `<h3>${result.shiftDays===0?"No date shift":`Shift of ${Math.abs(result.shiftDays)} day${Math.abs(result.shiftDays)===1?"":"s"} ${result.shiftDays>0?"later":"earlier"}`} · ${result.changes.length} outstanding deadlines change</h3>${result.changes.length?result.changes.slice(0,12).map((item)=>`<div class="preview-task"><span>${escapeHtml(item.title)}</span><span>${dateLabel(item.oldDate,{month:"short",day:"numeric"})} → ${dateLabel(item.newDate,{month:"short",day:"numeric"})}</span></div>`).join("")+(result.changes.length>12?`<div class="form-hint">and ${result.changes.length-12} more…</div>`:""):`<div class="form-hint">Completed tasks and manually overridden deadlines will be preserved.</div>`}`;
    } catch (error) { preview.innerHTML = `<div class="inline-error">${escapeHtml(error.message)}</div>`; }
  };
  form.startDate.addEventListener("change",update);
  form.addEventListener("submit",async(event)=>{
    event.preventDefault();
    try {
      await api(`/api/projects/${encodeURIComponent(project.id)}/start-date`,{method:"PATCH",body:JSON.stringify({startDate:form.startDate.value})});
      modalRoot.innerHTML="";
      await refresh();
      await openProject(project.id);
      showToast("Program timeline updated; eligible task deadlines shifted.");
    } catch(error) { showToast(error.message,true); }
  });
  update();
}
async function checkAirtableSchema(button) {
  button.disabled = true;
  button.textContent = "Checking…";
  try {
    const result = await api("/api/integrations/airtable/schema");
    state.schemaCheck = result;
    render();
    const problems = result.missingTables.length + result.missingFields.length + result.computedWriteFields.length;
    showToast(problems ? "Schema access works, but some tables or fields need attention." : `Airtable schema verified: ${result.tables.length} tables found.`, Boolean(problems));
  } catch(error) { showToast(error.message,true); }
  finally { if(button.isConnected){button.disabled=false;button.textContent="Check schema access";} }
}
document.addEventListener("click",async(event)=>{
  const nav = event.target.closest("[data-nav]");
  if (nav) { event.preventDefault(); setNavigation(nav.dataset.nav); return; }
  const airtableTable = event.target.closest("[data-airtable-table]");
  if (airtableTable) {
    state.airtableData.selectedTableId = airtableTable.dataset.airtableTable;
    state.airtableData.query = "";
    state.airtableData.offset = 0;
    await loadAirtableRecords(0);
    return;
  }
  const airtablePage = event.target.closest("[data-airtable-page]");
  if (airtablePage) { await loadAirtableRecords(Number(airtablePage.dataset.airtablePage)); return; }
  const projectLink = event.target.closest("[data-project]");
  if (projectLink) { await openProject(projectLink.dataset.project); return; }
  const taskLink = event.target.closest("[data-task]");
  if (taskLink) { await openTask(taskLink.dataset.task); return; }
  const tab = event.target.closest("[data-project-tab]");
  if (tab && state.projectData) { state.projectTab=tab.dataset.projectTab; renderProjectPage(); return; }
  const filter = event.target.closest("[data-my-filter]");
  if (filter) { state.myTaskFilter=filter.dataset.myFilter; render(); return; }
  const notificationRead = event.target.closest("[data-read-notification]");
  if (notificationRead) {
    try { await api(`/api/notifications/${encodeURIComponent(notificationRead.dataset.readNotification)}`,{method:"PATCH"}); await refresh(); }
    catch(error) { showToast(error.message,true); }
    return;
  }
  const action = event.target.closest("[data-action]");
  if (action) {
    if (action.dataset.action==="logout") {
      try {
        await api("/api/auth/logout",{method:"POST",body:"{}"});
        if (isDevMode()) { state.devEmail=""; try { localStorage.removeItem("nmu-dev-email"); } catch {} }
        state.data=null; state.page="overview"; state.projectId=null; state.projectData=null; renderLogin("You have signed out.");
      }
      catch(error) { showToast(error.message,true); }
    }
    else if (action.dataset.action==="create-project") showProjectForm();
    else if (action.dataset.action==="replan") showReplan();
    else if (action.dataset.action==="close-modal") modalRoot.innerHTML="";
    else if (action.dataset.action==="airtable-check") await checkAirtableSchema(action);
    else if (action.dataset.action==="airtable-refresh-data") await loadAirtableTables();
    else if (action.dataset.action==="mark-all-read") {
      for (const notification of state.data.notifications.filter((item)=>!item.isRead)) {
        try { await api(`/api/notifications/${encodeURIComponent(notification.id)}`,{method:"PATCH"}); } catch(error) { showToast(error.message,true); return; }
      }
      await refresh();
    }
    return;
  }
  if (event.target.matches("[data-close-modal]")) modalRoot.innerHTML="";
});
document.addEventListener("input",(event)=>{
  if(event.target.matches('[data-filter="project-search"]')) { state.projectSearch=event.target.value; render(); const field=document.querySelector('[data-filter="project-search"]'); field?.focus(); field?.setSelectionRange(state.projectSearch.length,state.projectSearch.length); }
  if(event.target.matches('[data-filter="task-search"]')) { state.taskSearch=event.target.value; render(); const field=document.querySelector('[data-filter="task-search"]'); field?.focus(); field?.setSelectionRange(state.taskSearch.length,state.taskSearch.length); }
});
document.addEventListener("change",(event)=>{
  if(event.target.matches('[data-filter="project-status"]')) { state.projectStatus=event.target.value; render(); }
  if(event.target.matches('[data-filter="task-status"]')) { state.taskStatusFilter=event.target.value; render(); }
});
document.addEventListener("submit",async(event)=>{
  if(event.target.id==="airtable-search-form") {
    event.preventDefault();
    state.airtableData.query = String(new FormData(event.target).get("query") || "").trim();
    await loadAirtableRecords(0);
  }
  if(event.target.id==="login-form") {
    event.preventDefault();
    const data=new FormData(event.target);
    const submit=event.target.querySelector('[type="submit"]');
    submit.disabled=true;
    state.devEmail=String(data.get("email")||"").trim().toLowerCase();
    try { localStorage.setItem("nmu-dev-email",state.devEmail); } catch {}
    await refresh();
  }
  if(event.target.id==="project-form") {
    event.preventDefault();
    const formData=new FormData(event.target);
    const input=Object.fromEntries(formData.entries());
    const submit=event.target.querySelector('[type="submit"]');
    submit.disabled=true;
    try {
      const result=await api("/api/projects",{method:"POST",body:JSON.stringify(input)});
      modalRoot.innerHTML="";
      state.page="projects";
      await refresh();
      await openProject(result.projectId);
      showToast(`Program created with ${result.taskCount} generated tasks.`);
    } catch(error) { showToast(error.message,true); submit.disabled=false; }
  }
  if(event.target.id==="task-form") {
    event.preventDefault();
    const taskId=event.target.dataset.taskId;
    const data=new FormData(event.target);
    const comment=String(data.get("comment")||"").trim();
    const save=event.target.querySelector('[type="submit"]');
    save.disabled=true;
    try {
      if(event.target.querySelector("#task-due-date")?.type==="date"&&data.get("dueDate")&&data.get("dueDate")!==event.target.dataset.originalDueDate) {
        await api(`/api/tasks/${encodeURIComponent(taskId)}/due-date`,{method:"PATCH",body:JSON.stringify({dueDate:data.get("dueDate")})});
      }
      if(!event.target.querySelector("#task-status")?.disabled&&data.get("status")) await api(`/api/tasks/${encodeURIComponent(taskId)}/status`,{method:"PATCH",body:JSON.stringify({status:data.get("status"),overrideReason:data.get("overrideReason")||""})});
      if(event.target.querySelector("#task-assignee")&&data.get("assignedUserId")) await api(`/api/tasks/${encodeURIComponent(taskId)}/assignee`,{method:"PATCH",body:JSON.stringify({assignedUserId:data.get("assignedUserId")})});
      if(comment) await api(`/api/tasks/${encodeURIComponent(taskId)}/comments`,{method:"POST",body:JSON.stringify({content:comment})});
      const projectId=state.data.tasks.find((task)=>task.id===taskId)?.projectId;
      modalRoot.innerHTML="";
      await refresh();
      if(projectId===state.projectId) await openProject(projectId);
      showToast("Task updates saved.");
    } catch(error) { showToast(error.message,true); save.disabled=false; }
  }
});
document.addEventListener("keydown",(event)=>{ if(event.key==="Escape"&&modalRoot.innerHTML)modalRoot.innerHTML=""; });
refresh();
