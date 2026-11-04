# Glass Group · NMU Program Operations

The NMU Program Operations prototype is in [`NMU Program Management/`](./NMU%20Program%20Management/).

## Run locally

Requires Node.js 22.13 or newer.

```sh
cd "NMU Program Management"
npm start
```

Open http://localhost:3000. Run the workflow tests with `npm test` from the same directory.

## Airtable

The app supports a server-side, one-way Airtable program import. Setup, field mapping, demo roles, data model, and prototype limitations are documented in the [NMU app README](./NMU%20Program%20Management/README.md). Never commit `.env` or paste an Airtable token into source code.

All seeded program records and people are demonstration data, not verified NMU records. Demo identity switching is not production authentication.