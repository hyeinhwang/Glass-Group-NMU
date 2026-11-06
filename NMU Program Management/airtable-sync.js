import { createAirtableClient } from "./airtable-client.js";

// Operational tables the app needs. "Templates ->", "Programs ->" and "WIP ->" are
// divider tables used only to group the Airtable sidebar, so they are optional.
export const AIRTABLE_TABLE_NAMES = [
  "Users", "Template List", "Roles", "Steps",
  "Region", "Site", "Session", "Instructors", "Work"
];
export const AIRTABLE_DIVIDER_TABLE_NAMES = ["Templates ->", "Programs ->", "WIP ->"];

// Work fields. "Due Date", "Status" and "Assignee" are formula/lookup fields in the
// base, so the app reads them only as fallbacks and must never write them.
export const WORK_FIELDS = Object.freeze({
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
export const WORK_COMPUTED_FIELDS = Object.freeze(["Due Date", "Status", "Assignee"]);

const firstDate = (value) => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const date = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
};

// Effective Due Date, then Due Date Override, then the formula Due Date.
export function workDueDate(fields = {}) {
  return firstDate(fields[WORK_FIELDS.effectiveDueDate])
    || firstDate(fields[WORK_FIELDS.dueDateOverride])
    || firstDate(fields[WORK_FIELDS.dueDate]);
}

export function assertWorkWriteFields(records) {
  for (const record of records) {
    for (const name of Object.keys(record.fields || {})) {
      if (!WORK_WRITABLE_FIELDS.includes(name)) {
        throw new Error(`The app may not write Work.${name}; writable fields are ${WORK_WRITABLE_FIELDS.join(", ")}.`);
      }
    }
  }
}

// All HTTP calls go through airtable-client.js (batching, throttling, 429 retry).
const clientFor = (config, fetcher) => createAirtableClient({ ...config, fetch: fetcher });

export async function fetchAirtableSchema(config, fetcher = fetch) {
  return clientFor(config, fetcher).getSchema();
}

export async function fetchAirtableRecords(config, tableId, fetcher = fetch) {
  return clientFor(config, fetcher).listRecords(tableId);
}

export async function updateAirtableRecords(config, tableId, records, fetcher = fetch) {
  return clientFor(config, fetcher).updateRecords(tableId, records);
}

export function linkedRecordIds(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item.id === "string").map((item) => item.id)
    : [];
}

export function airtableStatusToApp(value) {
  const normalized = String(value || "").trim().toLowerCase();
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
