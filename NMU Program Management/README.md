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

## Airtable import

The integration is an explicit, one-way import of program records. NMU's Airtable account is not preconfigured. Create a [Personal Access Token](https://airtable.com/create/tokens) with read access to the relevant base, then:

1. Copy `.env.example` to `.env`.
2. Set `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, and `AIRTABLE_PROJECTS_TABLE`.
3. Configure `AIRTABLE_FIELD_MAPPING` with JSON mapping app keys to exact Airtable field labels, for example:

   ```json
   {"name":"Program Name","location":"Location","startDate":"Start Date","endDate":"End Date","description":"Description","programType":"Program Type","hostOrganization":"Host Organization"}
   ```

4. Restart `npm start` and select the Airtable status in the sidebar to run **Import programs from Airtable**.

The API credential is read only by the server, is excluded from Git, and is never returned to the browser. The import validates required project fields, reports skipped records, paginates through Airtable responses, and updates a previously imported program by Airtable record ID. It does not import participant data, task records, or financial information and does not send NMU task updates back to Airtable. Do not paste credentials into source code or commit `.env`.

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

The database is stored at `.data/nmu.sqlite` by default. Set `NMU_DATABASE_PATH` to choose another SQLite file. The API computes project completion and blocked status from relational task data.

## Tests

```sh
npm test
```

The integration tests launch isolated server/databases and cover seeded data, project and task workflows, partner access boundaries, template editing, production sign-in, origin checks, session logout, password changes, account creation, and account disabling.

## Hosting and security

The Node server can run on Railway. For public access, generate a Railway domain and set its target port to the port the service listens on (Railway supplies `PORT`). Set these variables in Railway before the first authenticated deployment:

- `NMU_AUTH_MODE=required` (or use `NODE_ENV=production`, which also requires sign-in).
- `NMU_ADMIN_EMAIL`: the initial administrator's email address.
- `NMU_ADMIN_PASSWORD`: a private initial password of at least 12 characters.
- `NMU_ADMIN_NAME` (optional): the initial administrator's display name.

The initial administrator is provisioned when the database is first created. Changing the environment password later does not reset an existing account; sign in and use **Settings → Change your password** instead. Administrators can create individual team accounts and enable or disable them in Settings. Share temporary passwords privately. Each teammate should change their password after signing in. Demo identity switching is only enabled in local demo mode.

Authentication uses scrypt password hashes, random server-side sessions in HttpOnly/SameSite cookies, origin checks on writes, login rate limiting, and server-side role checks. It is an MVP authentication layer, not a substitute for an organization-wide identity provider or a formal security assessment.

SQLite durability on Railway requires a persistent volume mounted at the database path (set `NMU_DATABASE_PATH` to a path on that volume); otherwise data can be lost when the service is replaced. SQLite is intended for a single app instance. Use a managed relational database before scaling to concurrent instances. Netlify hosting would require adapting the API to Netlify Functions and using a hosted database.

Partner project access follows the existing shared-project and task-assignment rules. Review those permissions before importing real operational data. The current Airtable integration remains a one-way, single-table program import; linked tables, bidirectional task sync, email/chat reminders, calendar synchronization, and participant records are not implemented.
