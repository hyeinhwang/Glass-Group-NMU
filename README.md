# Glass Group · NMU Program Operations

The NMU Program Operations prototype is in [`NMU Program Management/`](./NMU%20Program%20Management/).

The root `package.json` is a Railway entry point: it lets Railpack detect Node.js at the repository root and starts the app from its subfolder. Keep the Railway service Root Directory empty (repository root), and use `npm start` as the start command if Railway does not detect it automatically.

## Run locally

Requires Node.js 22.13 or newer.

```sh
cd "NMU Program Management"
npm start
```

Open http://localhost:3000. Run the workflow tests with `npm test` from the same directory.
From the repository root, `npm start` starts the app and `npm test` runs its workflow tests.

## Airtable

The app validates the 12 NMU operational tables, syncs every table in the connected base, and provides an administrator-only browser for read-only Airtable record snapshots. Airtable owns reference/setup data; the app writes only the approved task status/date/assignee fields back to linked `Work` records. Airtable permissions, sync behavior, and conflict handling are documented in the [NMU app README](./NMU%20Program%20Management/README.md). Never commit `.env` or paste an Airtable token into source code.

## Team handoff and current status

- **Repository:** [Glass-Group-NMU](https://github.com/jokingkingsley/Glass-Group-NMU)
- **Production URL:** https://glass-group-nmu-production.up.railway.app
- **Current code:** `main` includes commit `d5f3063` (`Add linked Airtable table synchronization`), which adds the 12-table Airtable sync and the administrator settings UI. Production authentication is in the preceding commit `ccc8511`.

### Known deployment issue

The GitHub `main` branch has the new multi-table sync, but the live Railway URL was still serving the old one-table Airtable importer when checked on 2026-11-04. That old screen asks for `AIRTABLE_PROJECTS_TABLE` and `AIRTABLE_FIELD_MAPPING`. Those variables are **not required by the new multi-table sync**; `AIRTABLE_PROJECTS_TABLE` identifies only one table and will not connect all 12 tables.

The currently checked-in UI should instead show **Settings → Airtable integration**, **Check schema access**, and **Sync all Airtable tables**. To get that version into production, confirm the Railway service is connected to this repository and the `main` branch, leave **Root Directory empty** (repository root), and deploy the latest commit. Verify the active deployment commit is `d5f3063` or newer. Then hard-refresh the browser. If the deployment still serves the old screen, inspect Railway's service/repository/branch settings and build/deploy logs; do not work around the mismatch by adding one-table variables.

Live Airtable access has **not** been confirmed. The local credential previously tested returned an Airtable `401 Invalid authentication token`; the Railway token cannot be inspected from this repository. Before syncing real records, configure `AIRTABLE_API_KEY` and `AIRTABLE_BASE_ID` in Railway Variables, deploy, and use **Check schema access**. The token must have `schema.bases:read`, `data.records:read`, and `data.records:write` access to the intended base. Never paste the token into chat or commit it. The Airtable sync is manual, and a persistent Railway volume must be mounted with `NMU_DATABASE_PATH` pointing to it before the first sync.

Authentication is implemented. In production, set `NMU_AUTH_MODE=required`, `NMU_ADMIN_EMAIL`, and a private `NMU_ADMIN_PASSWORD` of at least 12 characters in Railway Variables. Optionally set `NMU_ADMIN_NAME`. The initial administrator is created on first database startup and can add individual teammate accounts in Settings. Changing the environment password does not reset an existing account; use the in-app password-change flow.

### Clone and work safely on a feature branch

Each teammate should make their own clone. Do not copy files over the production checkout, work directly on `main`, or share one working directory with another teammate.

Requirements: Git and Node.js 22.13 or newer. From a terminal, clone the repository and create a personal feature branch:

```sh
git clone https://github.com/jokingkingsley/Glass-Group-NMU.git
cd Glass-Group-NMU
git switch -c feature/short-description
```

Choose a unique branch name, such as `feature/session-filters` or `fix/airtable-status`. The commands above create the branch from the latest default branch fetched by `git clone`. For an existing clone, update `main` first and create a new branch from it:

```sh
git switch main
git pull --ff-only origin main
git switch -c feature/short-description
```

Run the app locally from the repository root with `npm start`, or from `NMU Program Management/` with `npm start`. The root `package.json` starts the app in its subfolder. Run tests from the root with `npm test` or from the app folder with `npm test`.

For private local configuration, copy `NMU Program Management/.env.example` to `NMU Program Management/.env` and add secrets only to that ignored local file. Do not share or commit `.env`, passwords, or tokens. The `.env` table variable `AIRTABLE_PROJECTS_TABLE` is obsolete for the multi-table sync and should not be used to configure the new integration.

Before sharing changes, run the tests and commit only the files you intended to change:

```sh
npm test
git status
git add path/to/changed-file
git commit -m "Describe the change"
git push -u origin feature/short-description
```

Open a GitHub pull request from your feature branch into `main`. Review the diff and get a teammate's approval before merging; Railway deploys from `main`, so merging changes the live prototype. Do not force-push shared branches or merge unreviewed changes directly into `main`. If `main` changed while you were working, update your branch carefully and resolve conflicts before opening or updating the pull request.

### Known scope and safeguards

The sync discovers the 12 Airtable tables from the base; Airtable owns reference/setup data. Only `Status`, `Due Date`, `Completed Date`, and `Assignee` on already-linked `Work` records can be written back. App-only tasks do not create new Airtable Work rows, and neither side automatically deletes records. SQLite is single-instance; review the app README before importing real operational data or scaling. All seeded program records and people are demonstration data, not verified NMU records. Local demo identity switching is not used when authentication is required.

The `Week 1/`, `Week 3/`, and `Week 6/` folders present in the original developer's working copy are untracked local files, not part of this application or repository; do not add them to a commit unless their owner explicitly requests it.
