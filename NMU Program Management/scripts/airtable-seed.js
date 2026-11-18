// Fills an Airtable base with starter data.
//
//   npm run airtable:seed -- --templates          # the three program templates and their steps
//   npm run airtable:seed -- --demo               # templates + demo users, programs and tasks
//
// Run `npm run airtable:setup -- --apply` first. Refuses to add demo data to a base
// that already has programs, so it can't mix sample records into real ones.
import { airtableClientFromEnv } from "../airtable-client.js";
import { T } from "../airtable-schema.js";
import { demoRows, templateRows, insertSeed } from "../seed-data.js";

const args = new Set(process.argv.slice(2));
if (!args.has("--templates") && !args.has("--demo")) {
  console.log("Choose --templates or --demo. Nothing was written.");
  process.exit(0);
}
const client = airtableClientFromEnv(process.env);
if (!client.configured) {
  console.error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID first.");
  process.exit(1);
}
if (args.has("--demo") && (await client.listRecords(T.sessions)).length) {
  console.error("This base already has Session records; demo data was not added.");
  process.exit(1);
}
await insertSeed(client, args.has("--demo") ? demoRows() : templateRows(), (line) => console.log(`added ${line}`));
console.log("Done.");
