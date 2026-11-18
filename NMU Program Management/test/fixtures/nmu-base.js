// The NMU Airtable base as it was on 2026-11-18 (table and field names and types
// only, from `npm run airtable:setup -- --list`). Used to check what setup would add.
// Select options weren't listed; Task Status options here are an assumption.
const f = (name, type, link) => ({ name, type, ...(link ? { link } : {}) });
const L = (name, link) => f(name, "multipleRecordLinks", link);
export const NMU_BASE_2026_11_18 = [
  { name: "Roles", fields: [f("Name", "singleLineText"), L("Users", "Users"), L("Steps", "Steps")] },
  { name: "Users", fields: [f("Email Address", "singleLineText"), f("First Name", "singleLineText"), f("Last Name", "singleLineText"),
    f("Status", "singleSelect"), f("Rights", "multipleSelects"), f("Created", "createdTime"), L("Roles", "Roles"), L("Work", "Work"),
    L("Activity Log", "Activity Log"), L("Comments", "Comments"), L("Notifications", "Notifications")] },
  { name: "Template List", fields: [f("List Name (Unique)", "singleLineText"), f("Status", "singleSelect"), f("Created", "createdTime"),
    L("Steps", "Steps"), L("Session", "Session")] },
  { name: "Steps", fields: [f("Unique", "formula"), f("Short Description", "singleLineText"), f("Long Description", "multilineText"),
    f("Days", "number"), L("Template", "Template List"), L("Roles", "Roles"), L("Dependencies", "Steps"),
    L("From field: Dependancies", "Steps"), f("ID", "autoNumber"), L("Work", "Work")] },
  { name: "Region", fields: [f("Name", "singleLineText"), L("Site", "Site")] },
  { name: "Site", fields: [f("Region Site", "formula"), f("Program Name", "singleLineText"), f("Program Location", "singleLineText"),
    L("Region", "Region"), L("Session", "Session"), L("Instructors", "Instructors"), f("Work", "singleLineText")] },
  { name: "Session", fields: [f("Session Name", "formula"), f("Start Date", "date"), f("Duration (Days)", "number"), f("End Date", "formula"),
    L("Site", "Site"), f("Region Site Session", "formula"), f("Status", "singleSelect"), f("Program Hours", "singleLineText"),
    L("Instructors", "Instructors"), L("Work", "Work"), L("Template", "Template List"), L("Activity Log", "Activity Log")] },
  { name: "Instructors", fields: [f("Instructor Name", "singleLineText"), L("Site", "Site"), f("Email", "email"), L("Session", "Session")] },
  { name: "WIP", fields: [f("Name", "singleLineText")] },
  { name: "Work", fields: [f("Unique", "formula"), L("Steps", "Steps"), L("Session", "Session"), f("Start Date (from Session)", "multipleLookupValues"),
    f("Days (from Steps)", "multipleLookupValues"), f("Due Date", "formula"), f("Completed Date", "date"), f("Status", "formula"),
    f("Assignee", "multipleLookupValues"), f("Notes", "multilineText"), f("Due Date Override", "date"), { ...f("Task Status", "singleSelect"), choices: ["Not Started", "In Progress", "Complete"] },
    L("Assigned To", "Users"), L("Activity Log", "Activity Log"), L("Comments", "Comments"), f("Effective Due Date", "formula")] },
  { name: "Activity Log", fields: [f("Action", "singleLineText"), f("Details", "multilineText"), L("Session", "Session"), L("Work", "Work"),
    L("User", "Users"), f("Created", "createdTime")] },
  { name: "Comments", fields: [f("Content", "multilineText"), L("Work", "Work"), L("User", "Users"), f("Created", "createdTime")] },
  { name: "Notifications", fields: [f("Message", "multilineText"), f("Type", "singleSelect"), L("User", "Users"), f("Is Read", "checkbox"),
    f("Created", "createdTime")] }
];
