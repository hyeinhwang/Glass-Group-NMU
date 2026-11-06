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

Airtable is the system of record: the app reads and writes programs (Sessions), tasks (Work), comments, activity history, and notifications directly in the connected base and has no database of its own. Sign-in is Google-only for the NMU domain, and roles come from the Airtable `Users.Rights` field (Admin, Manager, Contributor); no passwords are stored. On `Work`, the app writes only `Task Status`, `Due Date Override`, `Assigned To`, and `Completed Date`. Configuration, field mapping and permissions are documented in the [NMU app README](./NMU%20Program%20Management/README.md). Never commit `.env` or paste an Airtable token into source code or chat.

## Team handoff and current status

- **Repository:** [Glass-Group-NMU](https://github.com/jokingkingsley/Glass-Group-NMU)
- **Production URL:** https://glass-group-nmu-production.up.railway.app
- **Current code:** the `airtable-field-alignment` branch replaces SQLite and the manual sync with direct Airtable reads/writes and Google sign-in. `main` still has the earlier SQLite + manual sync version until that branch is reviewed and merged.

### Deployment configuration

Set these Railway Variables before deploying the `airtable-field-alignment` changes: `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NMU_ALLOWED_EMAIL_DOMAIN`, `NMU_PUBLIC_URL`, `NMU_SESSION_SECRET` (32+ random characters), and `NODE_ENV=production`. In Google Cloud, add `$NMU_PUBLIC_URL/auth/google/callback` as an authorized redirect URI. The old `NMU_ADMIN_EMAIL`/`NMU_ADMIN_PASSWORD`, `NMU_DATABASE_PATH`, `AIRTABLE_PROJECTS_TABLE`, and `AIRTABLE_FIELD_MAPPING` variables are no longer used, and no persistent volume is needed.

The Airtable token must have `schema.bases:read`, `data.records:read`, and `data.records:write` access to the NMU base. After deploying, sign in as an Admin and use **Settings → Check schema access** to confirm every required table and field exists. Live Airtable access has not yet been verified against the real base.

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

Airtable owns all data; the app never deletes Airtable records. Formula/lookup fields (`Due Date`, `Status`, `Assignee`) are never written. Templates and Steps are edited in Airtable, not in the app. Activity Log and Notifications writes are best-effort: if they fail, the primary change is kept and the error is logged.

The `Week 1/`, `Week 3/`, and `Week 6/` folders present in the original developer's working copy are untracked local files, not part of this application or repository; do not add them to a commit unless their owner explicitly requests it.
