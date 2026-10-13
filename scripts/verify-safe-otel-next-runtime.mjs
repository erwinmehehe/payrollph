import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// This route exists only in the isolated GitHub Actions checkout, never in a
// committed source tree or an uploaded deployable application artifact.
if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true") {
  throw new Error("The synthetic Next.js runtime probe is CI-only.");
}
const route = resolve("src/app/api/__safe_otel_ci_probe__/route.ts");
const action = process.argv[2];
if (action === "stage") {
  mkdirSync(dirname(route), { recursive: true });
  writeFileSync(route, [
    'export const runtime = "nodejs";',
    'export const dynamic = "force-dynamic";',
    'export async function GET() {',
    '  throw new Error("A4_SYNTHETIC_NEXT_RUNTIME_ERROR_NO_REAL_DATA");',
    '}',
    '',
  ].join("\n"));
  console.log("Staged ephemeral synthetic route (CI checkout only).");
} else if (action === "verify") {
  const port = 41671;
  const url = "http://127.0.0.1:" + port;
  const cronSecret = "a4-synthetic-cron-secret-ci-2026-only-1234";
  const collectorToken = "a4-synthetic-collector-token-ci-2026-only";
  const subprocess = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start",
    "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      SAFE_OTEL_ERRORS_ENABLED: "true",
      CENTRAL_SCHEDULER_ENABLED: "true",
      WORKER_ENABLED: "false",
      CRON_SECRET: cronSecret,
      // Isolated refused loopback PostgreSQL connection; no real payroll DB.
      DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic",
      // Intentionally forbidden outbound target: validates hooks without
      // contacting an unapproved remote collector.
      OTLP_LOGS_ENDPOINT: "https://127.0.0.1/v1/logs",
      OTLP_LOGS_BEARER_TOKEN: collectorToken,
    },
  });
  let output = "";
  const capture = chunk => {
    output = (output + String(chunk)).slice(-200_000);
  };
  subprocess.stdout.on("data", capture);
  subprocess.stderr.on("data", capture);
  const waitFor = async (predicate, description, timeoutMs = 40_000) => {
    const expires = Date.now() + timeoutMs;
    while (Date.now() < expires) {
      if (predicate()) return;
      if (subprocess.exitCode !== null) {
        throw new Error("Next.js exited awaiting " + description + ": " + output.slice(-3000));
      }
      await new Promise(done => setTimeout(done, 100));
    }
    throw new Error("Timeout awaiting " + description + ": " + output.slice(-3000));
  };
  const records = () => output.split(/\r?\n/).flatMap(line => {
    const i = line.indexOf('{"event":"sanitized_server_error"');
    if (i === -1) return [];
    try { return [JSON.parse(line.slice(i))]; }
    catch { return []; }
  });
  try {
    await waitFor(() => output.includes("Ready in"), "production-mode Next.js readiness");
    const webResponse = await fetch(url + "/api/__safe_otel_ci_probe__", {
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(webResponse.status, 500, "uncaught synthetic route must return HTTP 500");
    await waitFor(() => records().some(r =>
      r.subsystem === "web" && r.code === "UNHANDLED_SERVER_ERROR"),
      "actual Next.js onRequestError hook");
    const cronResponse = await fetch(url + "/api/jobs/cron", {
      headers: { Authorization: "Bearer " + cronSecret },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(cronResponse.status, 503, "synthetic PostgreSQL failure must return 503");
    assert.equal((await cronResponse.json()).error, "Scheduler tick failed.");
    const requestId = cronResponse.headers.get("x-request-id");
    assert.match(requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    await waitFor(() => records().some(r =>
      r.subsystem === "scheduler" && r.code === "CRON_TICK_FAILED" &&
      r.requestId === requestId), "authenticated cron sanitized event");
    for (const record of records()) {
      assert.deepEqual(Object.keys(record).sort(),
        ["event", "requestId", "subsystem", "code", "timestamp"].sort());
      assert.match(record.requestId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      assert.ok(!JSON.stringify(record).includes(collectorToken));
      assert.ok(!JSON.stringify(record).includes(cronSecret));
      assert.ok(!JSON.stringify(record).includes("A4_SYNTHETIC_NEXT_RUNTIME_ERROR_NO_REAL_DATA"));
      assert.ok(!JSON.stringify(record).includes("127.0.0.1"));
    }
    console.log("A-4 runtime acceptance: production Next.js hook, synthetic PostgreSQL 503, sanitized correlation PASSED.");
    console.log("External collector receipt and DPO approval remain separate gates.");
  } finally {
    subprocess.kill("SIGTERM");
    await Promise.race([
      new Promise(done => subprocess.once("exit", done)),
      new Promise(done => setTimeout(done, 3_000)),
    ]);
    if (subprocess.exitCode === null) subprocess.kill("SIGKILL");
    rmSync(route, { force: true });
    rmSync(dirname(route), { recursive: true, force: true });
  }
} else {
  throw new Error("Usage: node scripts/verify-safe-otel-next-runtime.mjs stage|verify");
}
