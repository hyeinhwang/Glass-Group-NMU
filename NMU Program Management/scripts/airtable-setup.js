import { pathToFileURL } from "node:url";
// Creates the Airtable tables and fields this app needs (see airtable-schema.js).
//
//   npm run airtable:setup             # report only, changes nothing
//   npm run airtable:setup -- --apply  # create missing tables and fields
//
// Needs AIRTABLE_API_KEY (with schema.bases:read and schema.bases:write for --apply)
// and AIRTABLE_BASE_ID in the environment. It never deletes or renames anything.
import { airtableClientFromEnv } from "../airtable-client.js";
import { SCHEMA, compareSchema } from "../airtable-schema.js";

export async function planSetup(client) {
  const live = await client.getSchema();
  return { live, ...compareSchema(live) };
}

export async function applySetup(client, log = console.log) {
  let live = await client.getSchema();
  const idOf = (name) => live.find((table) => table.name === name)?.id;
  const toApi = (field) => (field.link
    ? { name: field.name, type: field.type, options: { linkedTableId: idOf(field.link) } }
    : { name: field.name, type: field.type, ...(field.options ? { options: field.options } : {}) });
  // Pass 1: create missing tables with their non-link fields (links need table IDs).
  for (const table of SCHEMA) {
    if (idOf(table.name)) continue;
    const plain = table.fields.filter((field) => !field.link && field.type !== "autoNumber");
    await client.createTable(table.name, plain.map(toApi));
    log(`created table ${table.name}`);
    live = await client.getSchema();
  }
  // Pass 2: add every missing field, including links.
  for (const table of SCHEMA) {
    const liveTable = live.find((item) => item.name === table.name);
    for (const field of table.fields) {
      // Fields marked readOnly belong to the base; the app never adds them.
      if (field.readOnly || liveTable.fields.some((item) => item.name === field.name)) continue;
      await client.createField(liveTable.id, toApi(field));
      log(`created field ${table.name}.${field.name}`);
    }
    live = await client.getSchema();
  }
  return compareSchema(live);
}

// Run only when called as a script. (Compare as file URLs: the folder name has spaces.)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = airtableClientFromEnv();
  const apply = process.argv.includes("--apply");
  try {
    // --list: print every table and its fields (names and types only, no record data).
    if (process.argv.includes("--list")) {
      for (const table of await client.getSchema()) console.log(`\n${table.name}: ${table.fields.map((field) => `${field.name} (${field.type})`).join(", ")}`);
      process.exit(0);
    }
    const plan = await planSetup(client);
    const todo = plan.missingTables.length + plan.missingFields.length;
    console.log(`Missing tables: ${plan.missingTables.join(", ") || "none"}`);
    console.log(`Missing fields: ${plan.missingFields.join(", ") || "none"}`);
    if (plan.readOnlyConflicts.length) {
      console.log(`These exist but are formula/lookup fields the app needs to write: ${plan.readOnlyConflicts.join(", ")}`);
    }
    if (plan.computedInBase?.length) {
      console.log(`Computed by the base, so the app will leave them alone (fine): ${plan.computedInBase.join(", ")}`);
    }
    if (!todo) console.log("The base already has everything the app needs.");
    else if (!apply) console.log("\nNothing changed. Run again with --apply to create them.");
    else {
      const after = await applySetup(client);
      console.log(`Done. Still missing: ${[...after.missingTables, ...after.missingFields].join(", ") || "nothing"}`);
    }
  } catch (error) {
    console.error(`Airtable setup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
