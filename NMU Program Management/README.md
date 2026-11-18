# NMU Program Operations

A responsive web app for coordinating No More Under (NMU) swim programs: program creation from templates, task dashboards, dependencies, timeline changes, a calendar, comments, activity history and notifications.

**Airtable is the system of record.** There is no app database. Every screen reads the NMU Airtable base and every change is written straight back to it, so people can keep working in Airtable and in the app at the same time.

## Run locally

Requires Node.js 22.13 or newer. There are no npm dependencies.

Try it without an Airtable token (an in-memory base with demo data; nothing is saved):

```sh
npm run dev:mock
```

Run it against a real base: copy `.env.example` to `.env`, fill in `AIRTABLE_API_KEY` and `AIRTABLE_BASE_ID`, then

```sh
npm run airtable:setup             # report missing tables/fields (changes nothing)
npm run airtable:setup -- --apply  # create them
npm start
```

Open http://localhost:3000. Never commit `.env` or paste a token anywhere else.

## How the app uses Airtable

| App concept | Airtable table | Notes |
|---|---|---|
| People and roles | `Users` | `Rights` = Admin / Program Manager / Employee / External Partner. Users with no Rights, or `Status` Inactive, can't sign in. `Password Hash` holds a scrypt hash, never a password. `App Access Disabled` turns off sign-in. `Roles` (job roles) decide who gets template tasks. |
| Templates | `Template List` + `Steps` | Step `Days` = days from program start, ordered by `Days` then `ID`. `Roles` picks the default owner (a teammate linked to that Role, else by Rights). `Dependencies` become task prerequisites. The app adds `Priority` and `Milestone`. Templates with an archived/inactive `Status` are hidden. |
| Places | `Region`, `Site`, `Instructors` | A program's location (`Program Location`, "City, ST"), host (`Program Name`) and region come from its `Site`. Creating a program picks a Site, or adds a new one. |
| Programs | `Session` | `Session Name` and `End Date` are the base's formulas; the app writes `Start Date` and `Duration (Days)` and lets the base compute them. The app adds `Program Type`, `Description`, `Project Manager`, `Team` and `Details` (JSON for extra intake fields). |
| Tasks | `Work` | See below. |
| Comments, activity, notifications | `Comments` (`Content`, `User`), `Activity Log`, `Notifications` (`Is Read`) | Created by the app. |
| Files and links | `Resources` | `Kind` = Link or File. Links keep the `URL`; files go into the `File` attachment field (up to 5 MB each, Airtable's limit for direct uploads). `Session` links it to a program, `Work` to a single task. |

`Templates ->`, `Programs ->` and `WIP ->` are divider tables and are not required.

**Work fields.** The app reads `Task Status`, the due date (`Due Date Override`, then `Planned Due Date`, then the base's `Effective Due Date` and `Due Date` formulas) and `Assigned To`. It writes `Task Status`, `Due Date Override`, `Assigned To` and `Completed Date`, and the app-owned `Task Name`, `Description`, `Priority`, `Milestone`, `Planned Due Date` and `Prerequisites`. When `Task Name` is empty the task is named by the base's `Unique` formula (the step's name). `Notes` is left alone. `Due Date`, `Status`, `Assignee` and `Effective Due Date` are formulas or lookups and are never written; the code refuses to. Work and Session records are never deleted (except a program whose creation fails half-way). Files and links in `Resources` are deleted when someone removes them in the app.

`Planned Due Date` is the date the app calculates from the template. When a program's start date moves, open tasks' planned dates move with it; completed tasks and tasks with a `Due Date Override` keep their dates.

**Live sync.** Tables are cached for 15 seconds (`NMU_AIRTABLE_CACHE_MS`). After that the app serves the cached copy while it re-reads Airtable in the background, so edits made in Airtable appear in the app within about half a minute; a table the app has just written to is always re-read. Open pages refresh themselves every 30 seconds. The **Airtable** pill in the sidebar shows the state: *Live*, *Saving…*, *Save failed* or *Not connected*.

All Airtable calls go through `airtable-client.js`: 10 records per write, at most ~5 requests per second, and automatic retry on `429` (honouring `Retry-After`). Table and field names live in `airtable-schema.js`; change a name there if the base uses a different one.

**Token scopes:** `data.records:read`, `data.records:write`, `schema.bases:read`, and `schema.bases:write` only while running `airtable:setup`.

### Starter data

```sh
npm run airtable:seed -- --templates   # the three sample templates and their steps
npm run airtable:seed -- --demo        # templates + demo people, programs and tasks (empty base only)
```

All seeded people and programs are fictional.

## Files, links and export

- **Program → Resources tab:** program-wide links (Google Drive folders, docs, websites) and files, plus everything attached to the program's tasks in one list.
- **Task details → Files & links:** add a link or upload files for one task.
- Files are stored in Airtable. Downloads go through the app, which asks Airtable for a fresh file URL each time (Airtable's URLs expire after a few hours). For files over 5 MB, put them in Google Drive and add a link.
- Internal teammates on a program can add files and links; external partners can only add them to their own tasks. The person who added an item, a program manager on the program, or an admin can remove it.
- **Export** (Overview and Programs): *Programs · CSV* uses the current search and filters; *All tasks in these programs · CSV* lists every task in them. CSV files open in Excel or Google Sheets (File → Import). Direct "Open in Google Sheets" would need Google sign-in and isn't built.

## Roles

| Role | Can do |
|---|---|
| Admin | Everything: all programs, accounts, templates, Airtable data browser |
| Program Manager | Create programs; manage programs they run or belong to; edit templates; view all programs |
| Employee | Programs they belong to; update and comment on tasks they own |
| External Partner | Only the tasks assigned to them |

In local demo mode (no `NMU_AUTH_MODE=required`), the top bar lets you switch between people to preview each role.

## Hosting and security (Railway)

Set these service variables:

- `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`
- `NMU_AUTH_MODE=required` (or `NODE_ENV=production`)
- `NMU_ADMIN_EMAIL` and `NMU_ADMIN_PASSWORD` (12+ characters), optional `NMU_ADMIN_NAME`: on start-up the app creates this administrator in `Users`, or gives an existing Admin user with no password this one. Changing the variable later does not reset the password; use **Settings → Change your password**.
- `NMU_SESSION_SECRET` (recommended): a long random string used to sign session cookies. Without it the secret is derived from the Airtable token.

No volume is needed: the app keeps no data on disk.

Passwords are stored only as scrypt hashes. Sessions are signed HttpOnly, SameSite=Strict, Secure cookies that last 7 days; changing a password or disabling a user ends their sessions. Writes are origin-checked, sign-in is rate limited, and every permission is checked on the server. This is an MVP authentication layer, not a formal security assessment.

## Tests

```sh
npm test
```

The tests start the server against an in-memory Airtable API (`test/helpers/mock-airtable.js`) that behaves like the real one: linked records as ID arrays, paging, 10-record write limit, 422 for unknown or computed fields and unknown select options, and simulated 429s. They cover the program and task workflows, permissions, sign-in, live reads of changes made in Airtable, and that formula/lookup fields are never written.
