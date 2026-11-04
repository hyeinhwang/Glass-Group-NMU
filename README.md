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

The app supports an administrator-triggered sync of all 12 NMU Airtable tables. Airtable owns reference/setup data; the app writes only the approved task status/date/assignee fields back to linked `Work` records. Airtable permissions, sync behavior, and conflict handling are documented in the [NMU app README](./NMU%20Program%20Management/README.md). Never commit `.env` or paste an Airtable token into source code.

## Railway deployment and team access

For Railway, keep the service Root Directory at the repository root so Railpack uses this repository's `package.json`. Configure `NMU_AUTH_MODE=required`, `NMU_ADMIN_EMAIL`, and a private `NMU_ADMIN_PASSWORD` of at least 12 characters in Railway Variables before deploying. Optionally set `NMU_ADMIN_NAME`. The app creates the initial administrator on first startup; the administrator can then add individual teammate accounts in Settings. Do not commit credentials or share passwords in GitHub.

Attach a persistent Railway volume and set `NMU_DATABASE_PATH` to a file on that volume before relying on database changes. The app uses single-instance SQLite; review the app README before importing real operational data.

All seeded program records and people are demonstration data, not verified NMU records. Local demo identity switching is not used when authentication is required.