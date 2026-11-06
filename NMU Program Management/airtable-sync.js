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

const API_ROOT = "https://api.airtable.com/v0";
const METADATA_ROOT = "https://api.airtable.com/v0/meta";

function configError(config) {
  if (!config.apiKey || !config.baseId) {
    return new Error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID in the service environment.");
  }
  return null;
}

function endpointRoot(config) {
  const override = config.apiRoot || API_ROOT;
  const url = new URL(override);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("AIRTABLE_API_ROOT must use HTTPS.");
  }
  return url.toString().replace(/\/$/, "");
}

async function requestJson(url, config, fetcher, options = {}) {
  const response = await fetcher(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(30_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = response.status === 401
      ? "Airtable rejected the token. Check AIRTABLE_API_KEY."
      : response.status === 403
        ? "Airtable denied access. Check this token's base access and schema/record scopes."
        : body.error?.message || body.error?.type || `Airtable returned HTTP ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return body;
}

export async function fetchAirtableSchema(config, fetcher = fetch) {
  const missingConfig = configError(config);
  if (missingConfig) throw missingConfig;
  const root = endpointRoot(config);
  const result = await requestJson(
    `${root.replace(/\/v0$/, "")}/v0/meta/bases/${encodeURIComponent(config.baseId)}/tables`,
    config,
    fetcher
  );
  return (result.tables || []).map((table) => ({
    id: table.id,
    name: table.name,
    fields: (table.fields || []).map((field) => ({
      id: field.id,
      name: field.name,
      type: field.type,
      linkedTableId: field.options?.linkedTableId || null,
      choices: field.options?.choices?.map((choice) => choice.name) || []
    }))
  }));
}

export async function fetchAirtableRecords(config, tableId, fetcher = fetch) {
  const missingConfig = configError(config);
  if (missingConfig) throw missingConfig;
  const root = endpointRoot(config);
  const records = [];
  let offset = "";
  do {
    const url = new URL(`${root}/${encodeURIComponent(config.baseId)}/${encodeURIComponent(tableId)}`);
    if (offset) url.searchParams.set("offset", offset);
    const page = await requestJson(url, config, fetcher);
    records.push(...(page.records || []));
    offset = page.offset || "";
  } while (offset);
  return records;
}

export async function updateAirtableRecords(config, tableId, records, fetcher = fetch) {
  const missingConfig = configError(config);
  if (missingConfig) throw missingConfig;
  const root = endpointRoot(config);
  const updated = [];
  for (let index = 0; index < records.length; index += 10) {
    const result = await requestJson(
      `${root}/${encodeURIComponent(config.baseId)}/${encodeURIComponent(tableId)}`,
      config,
      fetcher,
      {
        method: "PATCH",
        body: JSON.stringify({ records: records.slice(index, index + 10) })
      }
    );
    updated.push(...(result.records || []));
  }
  return updated;
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
