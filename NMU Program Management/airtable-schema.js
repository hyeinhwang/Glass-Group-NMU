// The Airtable tables and fields this app reads and writes. Airtable is the system
// of record: there is no other database. Existing NMU tables (Users, Template List,
// Steps, Session, Work) keep their names; the app adds the fields it needs.
//
// `npm run airtable:setup` compares this list with the live base and (with --apply)
// creates any missing table or field. Settings → "Check schema access" reports gaps.

const text = (name) => ({ name, type: "singleLineText" });
const longText = (name) => ({ name, type: "multilineText" });
const email = (name) => ({ name, type: "email" });
const number = (name) => ({ name, type: "number", options: { precision: 0 } });
const decimal = (name) => ({ name, type: "number", options: { precision: 1 } });
const date = (name) => ({ name, type: "date", options: { dateFormat: { name: "iso" } } });
const checkbox = (name) => ({ name, type: "checkbox", options: { icon: "check", color: "greenBright" } });
const select = (name, choices) => ({ name, type: "singleSelect", options: { choices: choices.map((choice) => ({ name: choice })) } });
const link = (name, table) => ({ name, type: "multipleRecordLinks", link: table });

export const T = Object.freeze({
  users: "Users",
  templates: "Template List",
  steps: "Steps",
  sessions: "Session",
  work: "Work",
  comments: "Comments",
  activity: "Activity Log",
  notifications: "Notifications",
  resources: "Resources"
});

// Field names, grouped by table. Change a name here if the base uses another one.
export const F = Object.freeze({
  users: {
    email: "Email Address", firstName: "First Name", lastName: "Last Name",
    rights: "Rights", passwordHash: "Password Hash", disabled: "App Access Disabled"
  },
  templates: { name: "List Name (Unique)", deliveryType: "Program Type", description: "Description", steps: "Steps" },
  steps: {
    title: "Short Description", description: "Long Description", days: "Days", template: "Template",
    defaultRole: "Default Role", priority: "Priority", milestone: "Milestone", order: "Step Order",
    dependsOn: "Depends On Step", legacyDependencies: ["Dependencies", "Dependancies"]
  },
  sessions: {
    name: "Session Name", startDate: "Start Date", endDate: "End Date", status: "Status",
    programType: "Program Type", deliveryType: "Delivery Type", city: "City", state: "State",
    host: "Host Organization", hours: "Program Hours", leadInstructors: "Lead Instructors",
    description: "Description", manager: "Project Manager", team: "Team", template: "Template", details: "Details"
  },
  work: {
    title: "Task Name", description: "Description", session: "Session", step: "Steps",
    owners: "Assigned To", status: "Task Status", priority: "Priority", milestone: "Milestone",
    plannedDue: "Planned Due Date", dueOverride: "Due Date Override", completedDate: "Completed Date",
    prerequisites: "Prerequisites",
    // Read-only formula/lookup fields in the NMU base. Never written.
    effectiveDue: "Effective Due Date", formulaDue: "Due Date"
  },
  comments: { text: "Comment", work: "Work", author: "Author" },
  activity: { action: "Action", details: "Details", session: "Session", work: "Work", user: "User" },
  notifications: { message: "Message", user: "User", session: "Session", read: "Read" },
  // Links and uploaded files for a program (Session) or a single task (Work).
  resources: {
    title: "Title", kind: "Kind", url: "URL", file: "File", fileName: "File Name", size: "File Size",
    contentType: "Content Type", session: "Session", work: "Work", addedBy: "Added By"
  }
});

// Work fields that must never be written: formulas and lookups in the NMU base.
export const WORK_READ_ONLY = Object.freeze(["Due Date", "Status", "Assignee", "Effective Due Date"]);
// Work fields the app writes. The user's original rule (Task Status, Due Date Override,
// Assigned To, Completed Date) plus the app-owned fields added by setup.
export const WORK_WRITABLE = Object.freeze([
  F.work.status, F.work.dueOverride, F.work.owners, F.work.completedDate,
  F.work.title, F.work.description, F.work.priority, F.work.milestone, F.work.plannedDue, F.work.prerequisites
]);
export const WORK_CREATE_ONLY = Object.freeze([F.work.session, F.work.step]);

export const RIGHTS = Object.freeze({
  admin: "Admin", program_manager: "Program Manager", employee: "Employee", external_partner: "External Partner"
});
export const STATUS_CHOICES = ["Not Started", "In Progress", "Completed"];
export const PRIORITY_CHOICES = ["High", "Medium", "Low"];
export const PROGRAM_STATUS_CHOICES = ["Planning", "On Track", "At Risk", "Completed"];
export const RESOURCE_KINDS = ["Link", "File"];
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // Airtable's limit for direct uploads

// Full table definitions. The first field is the primary field for a new table.
export const SCHEMA = [
  { name: T.users, fields: [
    email(F.users.email), text(F.users.firstName), text(F.users.lastName),
    select(F.users.rights, Object.values(RIGHTS)), text(F.users.passwordHash), checkbox(F.users.disabled)
  ] },
  { name: T.templates, fields: [
    text(F.templates.name), text(F.templates.deliveryType), longText(F.templates.description)
  ] },
  { name: T.steps, fields: [
    text(F.steps.title), longText(F.steps.description), number(F.steps.days), link(F.steps.template, T.templates),
    select(F.steps.defaultRole, Object.values(RIGHTS).slice(0, 3)), select(F.steps.priority, PRIORITY_CHOICES),
    text(F.steps.milestone), number(F.steps.order), number(F.steps.dependsOn)
  ] },
  { name: T.sessions, fields: [
    text(F.sessions.name), date(F.sessions.startDate), date(F.sessions.endDate),
    select(F.sessions.status, PROGRAM_STATUS_CHOICES), text(F.sessions.programType), text(F.sessions.deliveryType),
    text(F.sessions.city), text(F.sessions.state), text(F.sessions.host), decimal(F.sessions.hours),
    text(F.sessions.leadInstructors), longText(F.sessions.description), link(F.sessions.manager, T.users),
    link(F.sessions.team, T.users), link(F.sessions.template, T.templates), longText(F.sessions.details)
  ] },
  { name: T.work, fields: [
    text(F.work.title), longText(F.work.description), link(F.work.session, T.sessions), link(F.work.step, T.steps),
    link(F.work.owners, T.users), select(F.work.status, STATUS_CHOICES), select(F.work.priority, PRIORITY_CHOICES),
    text(F.work.milestone), date(F.work.plannedDue), date(F.work.dueOverride), date(F.work.completedDate),
    link(F.work.prerequisites, T.work)
  ] },
  { name: T.comments, fields: [longText(F.comments.text), link(F.comments.work, T.work), link(F.comments.author, T.users)] },
  { name: T.activity, fields: [
    text(F.activity.action), longText(F.activity.details), link(F.activity.session, T.sessions),
    link(F.activity.work, T.work), link(F.activity.user, T.users)
  ] },
  { name: T.notifications, fields: [
    longText(F.notifications.message), link(F.notifications.user, T.users),
    link(F.notifications.session, T.sessions), checkbox(F.notifications.read)
  ] },
  { name: T.resources, fields: [
    text(F.resources.title), select(F.resources.kind, RESOURCE_KINDS), { name: F.resources.url, type: "url" },
    { name: F.resources.file, type: "multipleAttachments" }, text(F.resources.fileName), number(F.resources.size),
    text(F.resources.contentType), link(F.resources.session, T.sessions), link(F.resources.work, T.work),
    link(F.resources.addedBy, T.users)
  ] }
];

// Divider tables in the NMU base; never required.
export const DIVIDER_TABLES = Object.freeze(["Templates ->", "Programs ->", "WIP ->"]);
export const COMPUTED_TYPES = new Set([
  "formula", "rollup", "multipleLookupValues", "lookup", "count", "autoNumber", "createdTime",
  "lastModifiedTime", "createdBy", "lastModifiedBy", "button", "externalSyncSource", "aiText"
]);

// Compares SCHEMA with a live schema (from the Metadata API).
export function compareSchema(liveTables) {
  const byName = new Map(liveTables.map((table) => [table.name, table]));
  const missingTables = [];
  const missingFields = [];
  const readOnlyConflicts = [];
  for (const table of SCHEMA) {
    const live = byName.get(table.name);
    if (!live) { missingTables.push(table.name); continue; }
    for (const field of table.fields) {
      const liveField = live.fields.find((item) => item.name === field.name);
      if (!liveField) missingFields.push(`${table.name}.${field.name}`);
      else if (COMPUTED_TYPES.has(liveField.type)) readOnlyConflicts.push(`${table.name}.${field.name}`);
    }
  }
  return { missingTables, missingFields, readOnlyConflicts };
}
