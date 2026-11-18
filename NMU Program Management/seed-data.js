// Demo data for an empty Airtable base, used by `npm run airtable:seed` and by the
// tests. Records carry readable placeholder IDs (u-catalina, tpl-community, ...);
// insertSeed() swaps them for the IDs Airtable assigns.
import { T, F, RIGHTS } from "./airtable-schema.js";

const offsetDate = (today, days) => {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const DEMO_USERS = [
  ["u-catalina", "Catalina", "", "catalina@nmu.demo", "admin"],
  ["u-mary", "Mary", "", "mary@nmu.demo", "employee"],
  ["u-jordan", "Jordan", "Ellis", "jordan@nmu.demo", "program_manager"],
  ["u-taylor", "Taylor", "Brooks", "taylor@nmu.demo", "admin"],
  ["u-casey", "Casey", "Nguyen", "casey@nmu.demo", "employee"],
  ["u-sam", "Sam", "Okafor", "sam@nmu.demo", "employee"],
  ["u-partner", "Alex", "Rivera", "alex@partner.demo", "external_partner"]
];

// [title, description, days from start, default role, priority, milestone, depends on step #]
export const DEMO_TEMPLATES = [
  {
    id: "tpl-community", name: "Community Swim Program", programType: "Community",
    description: "Core outreach, staffing, compliance, delivery, and wrap-up workflow.",
    steps: [
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
    steps: [
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
    steps: [
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

const DEMO_PROGRAMS = [
  { id: "p-seattle", name: "Seattle Swim Program", type: "Community", city: "Seattle", state: "WA", host: "Rainier Community Center", start: 35, end: 49, status: "On Track", manager: "u-jordan", template: "tpl-community", progress: 0.56 },
  { id: "p-tacoma", name: "Tacoma Swim Program", type: "Community", city: "Tacoma", state: "WA", host: "Eastside Community Hub", start: 16, end: 30, status: "At Risk", manager: "u-jordan", template: "tpl-community", progress: 0.31 },
  { id: "p-portland", name: "Portland Swim Program", type: "School", city: "Portland", state: "OR", host: "Portland Public Schools", start: 77, end: 91, status: "Planning", manager: "u-catalina", template: "tpl-school", progress: 0.19 },
  { id: "p-spokane", name: "Spokane Water Safety Clinic", type: "Clinic", city: "Spokane", state: "WA", host: "South Hill YMCA", start: 51, end: 52, status: "Planning", manager: "u-jordan", template: "tpl-clinic", progress: 0.12 },
  { id: "p-everett", name: "Everett Summer Swim", type: "Community", city: "Everett", state: "WA", host: "Everett Parks & Recreation", start: -35, end: -21, status: "Completed", manager: "u-catalina", template: "tpl-community", progress: 1 },
  { id: "p-olympia", name: "Olympia School Swim Series", type: "School", city: "Olympia", state: "WA", host: "Capital School District", start: 112, end: 126, status: "Planning", manager: "u-jordan", template: "tpl-school", progress: 0.08 }
];

// Templates and their steps only (what a fresh production base needs).
export function templateRows() {
  const templates = [];
  const steps = [];
  for (const template of DEMO_TEMPLATES) {
    templates.push({ id: template.id, fields: {
      [F.templates.name]: template.name, [F.templates.deliveryType]: template.programType,
      [F.templates.description]: template.description
    } });
    template.steps.forEach(([title, description, days, role, priority, milestone, dependsOn], index) => {
      steps.push({ id: `${template.id}-step-${index + 1}`, fields: {
        [F.steps.title]: title, [F.steps.description]: description, [F.steps.days]: days,
        [F.steps.template]: [template.id], [F.steps.defaultRole]: RIGHTS[role], [F.steps.priority]: priority,
        [F.steps.milestone]: milestone, [F.steps.order]: index + 1,
        ...(dependsOn ? { [F.steps.dependsOn]: dependsOn } : {})
      } });
    });
  }
  return { [T.templates]: templates, [T.steps]: steps };
}

// The full demo workspace: users, templates, six programs with tasks, comments,
// activity and notifications. Dates are relative to `today`.
export function demoRows({ today = new Date().toISOString().slice(0, 10), includeUsers = true } = {}) {
  const rows = { ...templateRows() };
  if (includeUsers) {
    rows[T.users] = DEMO_USERS.map(([id, first, last, email, role]) => ({ id, fields: {
      [F.users.email]: email, [F.users.firstName]: first, [F.users.lastName]: last, [F.users.rights]: RIGHTS[role]
    } }));
  }
  const roleOwner = { admin: "u-catalina", program_manager: null, employee: "u-casey" };
  rows[T.sessions] = [];
  rows[T.work] = [];
  for (const [programIndex, program] of DEMO_PROGRAMS.entries()) {
    const team = new Set(["u-catalina", "u-mary", "u-casey", "u-sam"]);
    if (program.id === "p-seattle") team.add("u-partner");
    team.delete(program.manager);
    rows[T.sessions].push({ id: program.id, fields: {
      [F.sessions.name]: program.name, [F.sessions.description]: `${program.type} swim program with ${program.host}.`,
      [F.sessions.programType]: program.type, [F.sessions.city]: program.city, [F.sessions.state]: program.state,
      [F.sessions.host]: program.host, [F.sessions.startDate]: offsetDate(today, program.start),
      [F.sessions.endDate]: offsetDate(today, program.end), [F.sessions.status]: program.status,
      [F.sessions.manager]: [program.manager], [F.sessions.team]: [...team], [F.sessions.template]: [program.template]
    } });
    const template = DEMO_TEMPLATES.find((item) => item.id === program.template);
    const limit = program.template === "tpl-community" ? 9 : program.template === "tpl-school" ? 8 : 7;
    template.steps.slice(0, limit).forEach(([title, description, days, role, priority, milestone, dependsOn], index) => {
      const status = program.status === "Completed" || index / limit < program.progress ? "Completed"
        : index % 7 === 5 && programIndex < 3 ? "In Progress" : "Not Started";
      const owner = program.id === "p-seattle" && index === 0 ? "u-partner" : roleOwner[role] || program.manager;
      rows[T.work].push({ id: `${program.id}-task-${index + 1}`, fields: {
        [F.work.title]: title, [F.work.description]: description, [F.work.session]: [program.id],
        [F.work.step]: [`${program.template}-step-${index + 1}`], [F.work.owners]: [owner],
        [F.work.status]: status, [F.work.priority]: priority, [F.work.milestone]: milestone,
        [F.work.plannedDue]: offsetDate(today, program.start + days),
        ...(status === "Completed" ? { [F.work.completedDate]: today } : {}),
        ...(dependsOn ? { [F.work.prerequisites]: [`${program.id}-task-${dependsOn}`] } : {})
      } });
    });
  }
  rows[T.comments] = [
    ["p-seattle-task-5", "u-jordan", "Host has shared two instructor referrals to follow up with."],
    ["p-tacoma-task-1", "u-mary", "Waiting on final pool availability confirmation."]
  ].map(([work, author, text], index) => ({ id: `c-${index + 1}`, fields: {
    [F.comments.text]: text, [F.comments.work]: [work], [F.comments.author]: [author]
  } }));
  rows[T.activity] = [
    ["p-seattle", "p-seattle-task-1", "u-jordan", "Project created", "Seattle Swim Program created from the Community Swim Program template."],
    ["p-seattle", "p-seattle-task-5", "u-jordan", "Task assigned", "Recruit instructors assigned to Jordan Ellis."],
    ["p-tacoma", "p-tacoma-task-1", "u-mary", "Update added", "Host is confirming pool availability for the proposed dates."],
    ["p-portland", "p-portland-task-1", "u-catalina", "Project created", "Portland Swim Program created from the School Partnership Series template."],
    ["p-spokane", "p-spokane-task-3", "u-jordan", "Task completed", "Clinic instructors confirmed."]
  ].map(([session, work, user, action, details], index) => ({ id: `a-${index + 1}`, fields: {
    [F.activity.action]: action, [F.activity.details]: details, [F.activity.session]: [session],
    [F.activity.work]: [work], [F.activity.user]: [user]
  } }));
  rows[T.resources] = [
    ["p-everett", null, "Everett Summer Swim — shared folder", "https://drive.google.com/drive/folders/nmu-everett-demo", "u-catalina"],
    ["p-everett", null, "Host agreement (Google Doc)", "https://docs.google.com/document/d/nmu-everett-demo", "u-catalina"],
    ["p-everett", null, "Pool booking — Everett Parks", "https://www.everettwa.gov/", "u-jordan"],
    ["p-tacoma", "p-tacoma-task-5", "Instructor applications folder", "https://drive.google.com/drive/folders/nmu-tacoma-demo", "u-catalina"],
    ["p-tacoma", "p-tacoma-task-5", "WSI certification lookup", "https://www.redcross.org/", "u-jordan"]
  ].map(([session, work, title, url, user], index) => ({ id: `r-${index + 1}`, fields: {
    [F.resources.title]: title, [F.resources.kind]: "Link", [F.resources.url]: url,
    [F.resources.session]: [session], ...(work ? { [F.resources.work]: [work] } : {}), [F.resources.addedBy]: [user]
  } }));
  rows[T.notifications] = [
    ["u-jordan", "p-tacoma", "Tacoma Swim Program has overdue preparation work."],
    ["u-catalina", "p-seattle", "Review the upcoming Seattle program timeline."]
  ].map(([user, session, message], index) => ({ id: `n-${index + 1}`, fields: {
    [F.notifications.message]: message, [F.notifications.user]: [user],
    [F.notifications.session]: [session], [F.notifications.read]: false
  } }));
  return rows;
}

// Writes seed rows into a base, replacing placeholder IDs in link fields with the
// record IDs Airtable returns. Tables are written in dependency order.
export async function insertSeed(client, rows, log = () => {}) {
  const order = [T.users, T.templates, T.steps, T.sessions, T.work, T.comments, T.activity, T.notifications, T.resources];
  const idMap = new Map();
  const mapLinks = (fields) => Object.fromEntries(Object.entries(fields).map(([name, value]) => [name,
    Array.isArray(value) ? value.map((item) => idMap.get(item) || item) : value]));
  const deferred = [];
  for (const table of order) {
    const records = rows[table] || [];
    if (!records.length) continue;
    // Self-links (Work.Prerequisites) wait until every record in the table exists.
    const selfLink = table === T.work ? F.work.prerequisites : null;
    const created = await client.createRecords(table, records.map((record) => {
      const fields = { ...record.fields };
      if (selfLink) delete fields[selfLink];
      return { fields: mapLinks(fields) };
    }), { typecast: true });
    records.forEach((record, index) => idMap.set(record.id, created[index].id));
    if (selfLink) {
      for (const record of records) {
        if (record.fields[selfLink]?.length) deferred.push({ table, id: record.id, fields: { [selfLink]: record.fields[selfLink] } });
      }
    }
    log(`${table}: ${records.length} records`);
  }
  for (const table of new Set(deferred.map((item) => item.table))) {
    await client.updateRecords(table, deferred.filter((item) => item.table === table)
      .map((item) => ({ id: idMap.get(item.id), fields: mapLinks(item.fields) })), { typecast: true });
  }
  return idMap;
}
