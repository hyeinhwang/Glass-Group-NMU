# NMU Program Operations

A standalone, responsive MVP for coordinating No More Under (NMU) swim programs. It includes a Node.js HTTP API, a persistent SQLite database, seeded demo users/programs/tasks, reusable task templates, project and employee dashboards, task dependencies, timeline previews, activity history, notifications, and a server-side Airtable import.

All names and program information in the seed data are fictional demonstration records.

## Run locally

Requirements: Node.js 22.13 or newer.

```sh
npm start
```

Open [http://localhost:3000](http://localhost:3000). The first launch creates `.data/nmu.sqlite` and seeds the demo workspace. SQLite is provided by Node's built-in `node:sqlite` module; Node may print its current experimental-feature notice.

For automatic server restart while editing:

```sh
npm run dev
```

To reset the demo database, stop the server and remove the specific `.data/nmu.sqlite` file. The next launch recreates the demo data. Do not remove the database if you need to preserve local changes.

## Demo accounts

Use the account selector in the top bar to switch demo identities. The selector simulates roles; it is not authentication.

| Demo person | Role | Access |
|---|---|---|
| Catalina | Administrator | All programs, template editing, program creation, task assignment |
| Taylor Brooks | Administrator | Same management capabilities |
| Jordan Ellis | Program Manager | Managed/member programs, timeline changes, task assignment |
| Mary | Employee | Assigned program tasks, notes, and task status |
| Casey Nguyen | Employee | Assigned program tasks, notes, and task status |
| Sam Okafor | Employee | Assigned program tasks, notes, and task status |
| Alex Rivera | External Partner | Shared Seattle program and the task assigned to the partner account |

## Airtable linked-table sync

The app syncs the 12 tables shown in the NMU Airtable schema: `Users`, `Templates`, `Template List`, `Roles`, `Steps`, `Programs`, `Region`, `Site`, `Session`, `Instructors`, `Work`, and `WIP`. Add `AIRTABLE_API_KEY` and `AIRTABLE_BASE_ID` to Railway Variables (or local `.env`) and give the token access to the base with `schema.bases:read`, `data.records:read`, and `data.records:write`. The secret is only used server-side and must never be committed or pasted into source.

An administrator opens **Settings → Airtable integration**, checks schema access, and selects **Sync all Airtable tables**. Sync is manual/on-demand. Airtable record IDs and linked-record field values are retained in the local database without automatically deleting Airtable records or local rows. `Session` records are projected as app programs; `Work` records linked to a session and step are projected as app tasks. The other tables are stored as linked reference snapshots in `airtable_records`.

Ownership is intentionally limited: Airtable owns setup/reference data. The app writes only `Status`, `Due Date`, `Completed Date`, and `Assignee` on already-linked `Work` records. It does not create Work records for app-only tasks. Concurrent edits to an app-owned field are surfaced as conflicts and not overwritten; resolve the value in Airtable or the app, then sync again. Status values must have an Airtable choice equivalent to Not Started, In Progress, Blocked, or Completed. Assignees must link to Airtable `Users` records whose email matches an active app account for assignment to appear in the app.

The first successful sync imports the Airtable value as the baseline and does not write back. Later syncs reconcile both sides. Attach a persistent Railway volume for the SQLite database before syncing; otherwise cached records and synchronization baselines can be lost when the service is replaced. Do not import real operational data until the live Railway token's schema and record permissions are verified.

## Main workflows

- **Create a program:** management selects a program type and template, previews generated deadlines relative to the start date, and creates the project and tasks in one operation.
- **Complete assigned work:** open **My tasks**, choose a task, update status, add a note, and view prerequisite state. Completion is rejected while a prerequisite remains incomplete. Administrators can override only with a recorded reason via the API.
- **Reassign work:** management or a program manager changes a task owner in task details; the new owner receives a notification.
- **Replan dates:** a program manager or administrator previews the task date changes before confirming. Completed tasks are unchanged; manually overridden deadlines are excluded from shifts.
- **Review project history:** workspaces include a task list, timeline grouped by planning phase, team roster, and activity history.
- **Edit templates:** administrators can update template names, task titles/descriptions, relative deadlines, priorities, and planning phases. Existing project tasks remain unchanged.

## Data model

SQLite uses foreign keys and relational tables:

- `users`: demo identities and roles.
- `projects`: program details, start/end dates, project manager, optional structured operational details, and Airtable record ID.
- `project_members`: project-specific visibility and team roles.
- `templates` / `template_tasks`: reusable task workflows, relative deadlines, priorities, planning phases, and dependency references.
- `tasks` / `task_dependencies`: project work, owners, status, due dates, completion records, and prerequisite relationships.
- `task_comments`, `activity_logs`, `notifications`: collaboration context and user-specific updates.
- `airtable_tables` / `airtable_records`: the most recently synchronized Airtable schema and each table's raw field values, including linked record IDs.
- `airtable_work_sync` / `airtable_sync_conflicts`: per-Work-record sync baselines and unresolved concurrent edits.

The database is stored at `.data/nmu.sqlite` by default. Set `NMU_DATABASE_PATH` to choose another SQLite file. The API computes project completion and blocked status from relational task data.

## Tests

```sh
npm test
```

The integration tests launch isolated servers/databases and cover Airtable schema discovery, pagination, batched writes, all-table linked-record projection, field-limited Work write-back, conflict detection, authentication, and existing project/task workflows.

## Hosting and security

The Node server can run on Railway. For public access, generate a Railway domain and set its target port to the port the service listens on (Railway supplies `PORT`). Set these variables in Railway before the first authenticated deployment:

- `NMU_AUTH_MODE=required` (or use `NODE_ENV=production`, which also requires sign-in).
- `NMU_ADMIN_EMAIL`: the initial administrator's email address.
- `NMU_ADMIN_PASSWORD`: a private initial password of at least 12 characters.
- `NMU_ADMIN_NAME` (optional): the initial administrator's display name.

The initial administrator is provisioned when the database is first created. Changing the environment password later does not reset an existing account; sign in and use **Settings → Change your password** instead. Administrators can create individual team accounts and enable or disable them in Settings. Share temporary passwords privately. Each teammate should change their password after signing in. Demo identity switching is only enabled in local demo mode.

Authentication uses scrypt password hashes, random server-side sessions in HttpOnly/SameSite cookies, origin checks on writes, login rate limiting, and server-side role checks. It is an MVP authentication layer, not a substitute for an organization-wide identity provider or a formal security assessment.

SQLite durability on Railway requires a persistent volume mounted at the database path (set `NMU_DATABASE_PATH` to a path on that volume); otherwise data can be lost when the service is replaced. SQLite is intended for a single app instance. Use a managed relational database before scaling to concurrent instances. Netlify hosting would require adapting the API to Netlify Functions and using a hosted database.

Partner project access follows the existing shared-project and task-assignment rules. Review those permissions before importing real operational data. Airtable synchronization is manual and does not include email/chat reminders or calendar synchronization.
