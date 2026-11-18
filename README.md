# Glass Group · NMU Program Operations

The NMU Program Operations prototype is in [`NMU Program Management/`](./NMU%20Program%20Management/).

The root `package.json` is a Railway entry point: it lets Railpack detect Node.js at the repository root and starts the app from its subfolder. Keep the Railway service Root Directory empty (repository root), and use `npm start` as the start command if Railway does not detect it automatically.

## Run locally

Requires Node.js 22.13 or newer.

```sh
cd "NMU Program Management"
npm start
```

Open http://localhost:3000 (set `AIRTABLE_API_KEY` and `AIRTABLE_BASE_ID` in `.env` first, or run `npm run dev:mock` to try it with demo data). Run the workflow tests with `npm test` from the same directory.
From the repository root, `npm start` starts the app and `npm test` runs its workflow tests.

## Airtable

Airtable is the app's only data store: there is no SQLite or other database. Programs, tasks, templates, people and roles, comments, activity and notifications are all read from and written to the NMU base live. What the app reads and writes, and how to set up a base, is in the [NMU app README](./NMU%20Program%20Management/README.md). Never commit `.env` or paste an Airtable token into source code or chat.

## Team handoff and current status

- **Repository:** [Glass-Group-NMU](https://github.com/jokingkingsley/Glass-Group-NMU)
- **Production URL:** https://glass-group-nmu-production.up.railway.app

### Deploying

Railway deploys from `main` with the Root Directory left empty. Set `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `NMU_AUTH_MODE=required`, `NMU_ADMIN_EMAIL`, `NMU_ADMIN_PASSWORD` (12+ characters) and `NMU_SESSION_SECRET` in Railway Variables. Before the first deploy against the real base, run `npm run airtable:setup` locally with the same token to see which tables and fields are missing, then `npm run airtable:setup -- --apply` to add them (it never deletes or renames anything). After deploying, **Settings → Check tables and fields** confirms the app can reach everything it needs. `AIRTABLE_PROJECTS_TABLE`, `AIRTABLE_FIELD_MAPPING` and `NMU_DATABASE_PATH` are no longer used.

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

For private local configuration, copy `NMU Program Management/.env.example` to `NMU Program Management/.env` and add secrets only to that ignored local file. Do not share or commit `.env`, passwords, or tokens. To try the app without a token, run `npm run dev:mock` in `NMU Program Management/`.

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

The app never writes the base's formula or lookup fields (`Due Date`, `Status`, `Assignee`, `Effective Due Date`) and never deletes records. All seeded program records and people are demonstration data, not verified NMU records. Local demo identity switching is not used when authentication is required.

The `Week 1/`, `Week 3/`, and `Week 6/` folders present in the original developer's working copy are untracked local files, not part of this application or repository; do not add them to a commit unless their owner explicitly requests it.
