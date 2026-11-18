// Runs the app against an in-memory copy of the Airtable base filled with demo data,
// for trying the app without an Airtable token. Nothing is saved when it stops.
//
//   npm run dev:mock
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createMockAirtable } from "../test/helpers/mock-airtable.js";
import { SCHEMA } from "../airtable-schema.js";
import { demoRows } from "../seed-data.js";

const base = createMockAirtable({ tables: SCHEMA, rows: demoRows() });
const apiRoot = await base.start();
const app = spawn(process.execPath, ["server.js"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: { ...process.env, AIRTABLE_API_KEY: "test-token", AIRTABLE_BASE_ID: "appMock", AIRTABLE_API_ROOT: apiRoot, NMU_AIRTABLE_MIN_INTERVAL_MS: "0" },
  stdio: "inherit"
});
console.log("Using an in-memory Airtable base with demo data (not saved).");
const stop = async () => { app.kill("SIGTERM"); await base.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
app.on("exit", (code) => base.close().then(() => process.exit(code ?? 0)));
