# NMU Program Operations

A responsive web app for coordinating No More Under (NMU) swim programs. **Airtable is the system of record for all data**: programs, tasks, comments, activity history, notifications, templates, sites, and users are read from and written to the connected Airtable base. The app has no database of its own and stores no passwords.

## Run locally

Requirements: Node.js 22.13 or newer. There are no npm dependencies.

```sh
cp .env.example .env   # then fill in values; never commit .env
npm start
```

Open [http://localhost:3000](http://localhost:3000).

Without Google credentials, use development mode. Set `NMU_AUTH_MODE=dev` in `.env` and sign in with any email listed in Airtable `Users` that has `Rights` set. Development mode is refused when `NODE_ENV=production`.

## Configuration

| Variable | Purpose |
|---|---|
| `AIRTABLE_API_KEY` | Personal access token with `schema.bases:read`, `data.records:read`, `data.records:write` on the base |
| `AIRTABLE_BASE_ID` | The NMU base (`app…`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth web client |
| `NMU_ALLOWED_EMAIL_DOMAIN` | The only Google Workspace domain allowed to sign in (for example `example.org`) |
| `NMU_PUBLIC_URL` | Public origin, e.g. `https://glass-group-nmu-production.up.railway.app`; register `$NMU_PUBLIC_URL/auth/google/callback` as an authorized redirect URI in Google Cloud |
| `NMU_SESSION_SECRET` | 32+ random characters used to sign session cookies |
| `NODE_ENV=production` | Secure cookies; development identity mode disabled |
| `NMU_AIRTABLE_CACHE_MS` (optional) | Read cache per table, default 15000 ms |

Keep tokens and secrets in Railway Variables or a local `.env` only. Never paste them into chat, source, or GitHub.

## Sign-in and roles

- Users sign in with Google. The app uses the authorization-code flow with PKCE, state, and nonce, and verifies the ID token's signature against Google's keys.
- Only verified accounts whose `hd` claim and email match `NMU_ALLOWED_EMAIL_DOMAIN` are accepted.
- The role comes from the matching Airtable **Users** record (`Email Address`) and its **Rights** field:

| Rights | Access |
|---|---|
| Admin | Everything, plus the Airtable data browser, schema check, and team access list |
| Manager | All programs; create programs, reassign tasks, override deadlines, shift timelines |
| Contributor | Programs where they have assigned Work; update their own tasks; comment |

Empty or unknown Rights means no access. Rights are checked on every request, so changing or clearing Rights in Airtable takes effect within the cache window. Sessions are stateless, HMAC-signed, HttpOnly cookies that last 12 hours. Signing out clears the cookie.

## How Airtable maps to the app

All Airtable HTTP calls go through `airtable-client.js`. It writes in batches of 10 records, spaces requests for the 5 requests/second/base limit, and retries HTTP 429 with backoff, honoring `Retry-After`. `airtable-store.js` holds every table and field name in one place (`TABLES`, `FIELDS`); change names there if the base differs.

| App concept | Airtable |
|---|---|
| Program | `Session` (name, start/end date, `Site`, `Status`) |
| Task | `Work` linked to a `Session` and a `Steps` record |
| Prerequisites | `Steps.Dependencies` (or the `Dependancies` spelling), matched to Work in the same Session |
| Templates | `Template List` with linked `Steps` (`Short Description`, `Long Description`, `Days`, `Roles`) |
| Comments | `Comments` (`Comment`, `Work`, `Author`) |
| Activity history | `Activity Log` (`Action`, `Details`, `Session`, `Work`, `User`) |
| Notifications | `Notifications` (`Message`, `User`, `Session`, `Read` checkbox) |
| People | `Users` (`Email Address`, `First Name`, `Last Name`, `Rights`) |

`Templates ->`, `Programs ->`, and `WIP ->` are divider tables and are not required.

### Work fields

- **Read:** `Task Status`; due date from `Effective Due Date`, falling back to `Due Date Override`, then `Due Date`; owner from `Assigned To`.
- **Written:** only `Task Status`, `Due Date Override`, `Assigned To`, and `Completed Date`. New Work rows also get their `Steps` and `Session` links.
- **Never written:** `Due Date`, `Status`, `Assignee` (formula/lookup). The store rejects writes to any computed field before calling Airtable.

### Workflows

- **Create a program:** creates a `Session` (writing `End Date`, or `Duration (Days)` if End Date is a formula) and one `Work` row per template Step. Each row is set to the "not started" Task Status choice and assigned to the first user of the Step's role. Due dates come from the Work formulas.
- **Complete a task:** writes `Task Status` and `Completed Date`. Completion is refused while a prerequisite is incomplete, unless an Admin gives a reason; the override is recorded in Activity Log.
- **Override a deadline:** writes `Due Date Override`; send `null` to clear it.
- **Shift a program start date:** updates the Session start (and End Date when editable), so open tasks follow the formula. Completed tasks are first pinned with `Due Date Override` so their dates do not move.
- Activity Log and Notifications writes are secondary. If one fails, the primary change stays saved and the error is logged.

Use **Settings → Check schema access** to list missing tables or fields, or writable fields that are formulas in the base. Administrators can browse any table live in **Airtable data**.

## Tests

```sh
npm test
```

The tests run against an in-memory Airtable mock. Like the real API, it returns linked records as ID strings, pages results, limits writes to 10 records, rejects unknown and computed fields, and computes the Work due-date formulas. A mock Google identity provider signs real RS256 ID tokens. Coverage includes client batching and retries, Work field rules, every workflow and permission, Google sign-in (domain, state, nonce, signature, audience, expiry), and session tampering.

## Hosting notes

The app is stateless, so it can run on Railway without a volume and can run more than one instance. Each instance keeps its own short read cache. With the default 15-second cache, an edit made directly in Airtable can take up to 15 seconds to appear. Reads load whole tables, which suits a base of a few thousand records; very large tables would need filtered queries.
