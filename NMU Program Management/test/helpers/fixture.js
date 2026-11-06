// A small NMU base shaped like the real one: divider tables, formula/lookup Work
// fields (Due Date, Effective Due Date, Status, Assignee) and the writable fields
// Task Status, Due Date Override, Assigned To and Completed Date.
import { createMockAirtable } from "./mock-airtable.js";

const text = (name) => ({ name, type: "singleLineText" });
const longText = (name) => ({ name, type: "multilineText" });
const date = (name) => ({ name, type: "date" });
const number = (name) => ({ name, type: "number" });
const link = (name, target) => ({ name, type: "multipleRecordLinks", link: target });
const select = (name, choices) => ({ name, type: "singleSelect", choices });
const formula = (name) => ({ name, type: "formula" });
const lookup = (name) => ({ name, type: "multipleLookupValues" });
const auto = (name) => ({ name, type: "autoNumber" });

export const WRITABLE_WORK_FIELDS = ["Task Status", "Due Date Override", "Assigned To", "Completed Date"];

export function fixtureTables() {
  return [
    { name: "Users", fields: [text("Email Address"), text("First Name"), text("Last Name"), select("Rights", ["Admin", "Manager", "Contributor"]), link("Roles", "Roles")] },
    { name: "Templates ->", fields: [text("Name")] },
    { name: "Template List", fields: [text("List Name (Unique)"), link("Steps", "Steps")] },
    { name: "Roles", fields: [text("Role Name"), link("Users", "Users"), link("Steps", "Steps")] },
    { name: "Steps", fields: [text("Unique"), text("Short Description"), longText("Long Description"), link("Dependancies", "Steps"), number("Days"), link("Template", "Template List"), link("Roles", "Roles")] },
    { name: "Programs ->", fields: [text("Name")] },
    { name: "Region", fields: [text("Name"), link("Site", "Site")] },
    { name: "Site", fields: [text("Program Name"), link("Region", "Region"), link("Session", "Session"), text("Region Site"), text("Program Location")] },
    { name: "Session", fields: [text("Session Name"), date("Start Date"), formula("Duration (Days)"), date("End Date"), link("Site", "Site"), select("Status", ["Planning", "On Track", "At Risk", "Completed"]), link("Work", "Work")] },
    { name: "Instructors", fields: [text("Instructor Name"), link("Site", "Site")] },
    { name: "Work", fields: [formula("Unique"), longText("Notes"), link("Steps", "Steps"), link("Session", "Session"),
      lookup("Days (from Steps)"), lookup("Start Date (from Session)"), formula("Due Date"), date("Due Date Override"),
      formula("Effective Due Date"), date("Completed Date"), lookup("Status"), select("Task Status", ["Not Started", "In Progress", "Done"]),
      lookup("Assignee"), link("Assigned To", "Users")] },
    { name: "WIP ->", fields: [text("Name")] },
    { name: "Comments", fields: [auto("ID"), longText("Comment"), link("Work", "Work"), link("Author", "Users")] },
    { name: "Activity Log", fields: [auto("ID"), text("Action"), longText("Details"), link("Session", "Session"), link("Work", "Work"), link("User", "Users")] },
    { name: "Notifications", fields: [auto("ID"), longText("Message"), link("User", "Users"), link("Session", "Session"), { name: "Read", type: "checkbox" }] }
  ];
}

export function fixtureRows() {
  const user = (id, email, first, last, rights) => ({ id, fields: { "Email Address": email, "First Name": first, "Last Name": last, ...(rights ? { Rights: rights } : {}) } });
  const step = (id, title, days, roles, deps = []) => ({ id, fields: { Unique: title, "Short Description": title, "Long Description": `${title} details.`, Days: days, Roles: roles, Dependancies: deps, Template: ["recTplClinic"] } });
  const work = (id, stepId, sessionId, status, assignee, extra = {}) => ({ id, fields: { Steps: [stepId], Session: [sessionId], "Task Status": status, "Assigned To": assignee ? [assignee] : [], Status: ["stale lookup"], Assignee: ["stale lookup"], ...extra } });
  return {
    Users: [
      user("recAdmin", "admin@nmu.test", "Ada", "Admin", "Admin"),
      user("recManager", "manager@nmu.test", "Jordan", "Ellis", "Manager"),
      user("recCasey", "casey@nmu.test", "Casey", "Nguyen", "Contributor"),
      user("recMary", "mary@nmu.test", "Mary", "Moss", "Contributor"),
      user("recNoRights", "norights@nmu.test", "No", "Rights", null),
      user("recOutside", "outsider@gmail.com", "Out", "Sider", "Admin")
    ],
    Roles: [
      { id: "recRolePM", fields: { "Role Name": "Program Manager", Users: ["recManager"] } },
      { id: "recRoleCoord", fields: { "Role Name": "Coordinator", Users: ["recCasey"] } }
    ],
    "Template List": [{ id: "recTplClinic", fields: { "List Name (Unique)": "Swim Safety Clinic", Steps: ["recStepHost", "recStepRecruit", "recStepClear"] } }],
    Steps: [
      step("recStepHost", "Confirm host", -30, ["recRolePM"]),
      step("recStepRecruit", "Recruit instructors", -20, ["recRolePM"]),
      step("recStepClear", "Complete clearances", -10, ["recRoleCoord"], ["recStepRecruit"])
    ],
    Site: [{ id: "recSiteEverett", fields: { "Program Name": "Everett Swim", "Program Location": "Everett, WA" } }],
    Session: [
      { id: "recSessionWinter", fields: { "Session Name": "Winter Session", "Start Date": "2027-01-15", "End Date": "2027-01-22", Site: ["recSiteEverett"], Status: "On Track" } },
      { id: "recSessionSpring", fields: { "Session Name": "Spring Session", "Start Date": "2027-04-01", "End Date": "2027-04-08", Site: ["recSiteEverett"], Status: "Planning" } }
    ],
    Work: [
      work("recWorkHost", "recStepHost", "recSessionWinter", "Done", "recManager", { "Completed Date": "2026-12-10" }),
      work("recWorkRecruit", "recStepRecruit", "recSessionWinter", "Not Started", "recCasey"),
      work("recWorkClear", "recStepClear", "recSessionWinter", "Not Started", "recMary"),
      work("recWorkSpringHost", "recStepHost", "recSessionSpring", "In Progress", "recManager")
    ],
    Comments: [], "Activity Log": [], Notifications: []
  };
}

const addDays = (value, days) => {
  const result = new Date(`${value}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
};

export function fixtureComputed() {
  return {
    Work: (fields, { get }) => {
      const session = get("Session", fields.Session?.[0]);
      const step = get("Steps", fields.Steps?.[0]);
      const start = session?.fields["Start Date"];
      const days = step?.fields.Days;
      const dueDate = start && typeof days === "number" ? addDays(start, days) : null;
      return {
        Unique: `${session?.fields["Session Name"] || ""} · ${step?.fields["Short Description"] || ""}`,
        "Days (from Steps)": typeof days === "number" ? [days] : [],
        "Start Date (from Session)": start ? [start] : [],
        "Due Date": dueDate,
        "Effective Due Date": fields["Due Date Override"] || dueDate
      };
    },
    Session: (fields) => {
      const start = fields["Start Date"];
      const end = fields["End Date"];
      return { "Duration (Days)": start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 86400000) : null };
    }
  };
}

export function createFixtureAirtable(overrides = {}) {
  return createMockAirtable({ tables: fixtureTables(), rows: fixtureRows(), computed: fixtureComputed(), ...overrides });
}
