import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

export async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

// Starts server.js with a clean environment (no real Airtable token can leak in).
export async function startApp(extraEnv = {}) {
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const env = {
    PATH: process.env.PATH, PORT: String(port),
    NMU_AIRTABLE_CACHE_MS: "0", NMU_AIRTABLE_MIN_INTERVAL_MS: "0", NMU_AIRTABLE_RETRY_BASE_MS: "5",
    ...extraEnv
  };
  const child = spawn(process.execPath, ["server.js"], { cwd: projectRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) return { url, child, output: () => output, exitCode: child.exitCode, stop: async () => {} };
    try { if ((await fetch(`${url}/api/auth/config`)).ok) break; } catch {}
    await delay(50);
  }
  return {
    url, child, output: () => output,
    async stop() {
      if (child.exitCode === null) { child.kill("SIGTERM"); await exited; }
    }
  };
}
