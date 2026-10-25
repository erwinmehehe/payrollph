import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { dispatchSchedulerTick } from "../run-external-scheduler-tick.mjs";

const LOCAL_URL = "http://127.0.0.1:3000";
const FAKE_HTTPS_ORIGIN = "https://scheduler-proof.example.test";
const MAX_WAIT_MS = 120_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** No remote DB, target, credentials, API or real employer may ever be used. */
export function assertDisposableProof(env) {
  assert.equal(env.GITHUB_ACTIONS, "true", "GitHub Actions auto-run is required");
  assert.ok(["pull_request", "push"].includes(env.GITHUB_EVENT_NAME), "manual workflow invocation is forbidden");
  assert.equal(env.CI, "true");
  assert.equal(env.UNATTENDED_SCHEDULER_SYNTHETIC_PROOF, "true");
  assert.equal(env.SCHEDULER_REHEARSAL_MODE, "isolated-ci-only");
  const db = new URL(env.DATABASE_URL ?? "");
  assert.equal(db.protocol, "postgresql:");
  assert.equal(db.hostname, "127.0.0.1");
  assert.equal(db.port, "5432");
  assert.equal(db.pathname, "/app_db");
  assert.equal(db.username, "postgres");
  assert.equal(db.search, "");
  assert.equal(db.hash, "");
  assert.equal(env.WORKER_ENABLED, "false", "app-server worker feature must stay OFF in synthetic proof");
  assert.equal(env.CENTRAL_SCHEDULER_ENABLED, "true", "isolated app-server central scheduler must be ON");
  for (const flag of ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED", "XENDIT_PAYOUTS_LIVE_APPROVED"]) {
    assert.notEqual(env[flag], "true", flag);
  }
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "OPENAI_API_KEY", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN"]) {
    assert.equal(env[key] ?? "", "", key + " must not be configured");
  }
  assert.match(env.VERCEL_GIT_COMMIT_SHA ?? "", /^[0-9a-f]{40}$/);
  assert.ok((env.WORKER_TOKEN ?? "").length >= 32);
  assert.ok(env.GITHUB_RUN_ID, "GitHub Actions run provenance is required");
}

export function loopbackSchedulerTransport(counters, transport = fetch) {
  return async (url, options) => {
    const target = new URL(String(url));
    if (target.origin !== FAKE_HTTPS_ORIGIN || target.username || target.password ||
        target.search || target.hash || !["/api/jobs/dispatch-readiness", "/api/jobs/tick"].includes(target.pathname)) {
      throw new Error("Only the isolated scheduler test host and two bounded routes are permitted");
    }
    const expectedMethod = target.pathname.endsWith("dispatch-readiness") ? "GET" : "POST";
    if (options.method !== expectedMethod || options.redirect !== "error") {
      throw new Error("Synthetic scheduler invocation does not match the approved transport");
    }
    counters[expectedMethod] = (counters[expectedMethod] ?? 0) + 1;
    // This substitution is NEVER available in the real dispatcher. It lets
    // CI execute the production auth and lease routes over localhost without
    // exposing the test server, a token, or a PostgreSQL service externally.
    return transport(LOCAL_URL + target.pathname, options);
  };
}

async function readState(client, id) {
  const { rows: jobs } = await client.query(
    "SELECT status, chunk_index, completed_at FROM payroll_jobs WHERE payroll_run_id = $1", [id]);
  const { rows: runs } = await client.query(
    "SELECT status, employee_count, processed_chunks, total_chunks FROM payroll_runs WHERE id = $1", [id]);
  const { rows: entries } = await client.query(
    "SELECT id, employee_id, gross_pay, net_pay FROM payroll_entries WHERE payroll_run_id = $1", [id]);
  const { rows: heartbeats } = await client.query(
    "SELECT job_name, last_run_at, last_result FROM scheduler_state WHERE job_name IN ('delivery-drain','central-scheduler-lease') ORDER BY job_name");
  return { jobs, runs, entries, heartbeats };
}

async function waitForCompletedPayroll(client, runId, child, deadline) {
  while (Date.now() < deadline) {
    const state = await readState(client, runId);
    if (state.jobs[0]?.status === "failed" || state.runs[0]?.status === "Failed") {
      throw new Error("Synthetic payroll worker failed to process queued run");
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("Autonomous payroll worker exited before the synthetic job completed");
    }
    if (state.jobs[0]?.status === "completed" && state.runs[0]?.status === "Needs review"
        && state.entries.length === 1 && state.runs[0]?.processed_chunks === state.runs[0]?.total_chunks) {
      return state;
    }
    await sleep(1000);
  }
  throw new Error("No unattended synthetic payroll completion before deadline");
}

async function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((done) => child.once("exit", done)),
    sleep(4000),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

export async function proveUnattendedPayroll(env = process.env) {
  assertDisposableProof(env);
  const seed = JSON.parse(readFileSync("qa-artifacts/p0-1-unattended-seed.json", "utf8"));
  assert.equal(seed.synthetic, true);
  assert.ok(Number.isSafeInteger(seed.runId) && seed.runId > 0);
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  let worker;
  try {
    const queued = await readState(client, seed.runId);
    assert.equal(queued.runs.length, 1);
    assert.equal(queued.jobs.length, 1);
    assert.equal(queued.jobs[0].status, "queued");
    assert.equal(queued.entries.length, 0);
    assert.equal(queued.heartbeats.length, 0, "the scheduler cannot pre-run from another process");

    const wrongToken = await fetch(LOCAL_URL + "/api/jobs/dispatch-readiness", {
      headers: { "x-worker-token": "invalid-test-token" }, redirect: "error", cache: "no-store",
    });
    assert.equal(wrongToken.status, 401, "unauthorized dispatcher cannot preflight");

    const counters = { GET: 0, POST: 0 };
    // Keep diagnostics restricted to localhost HTTP status and the scheduler's
    // already-sanitized job/code receipt. Never print errors, SQL, bodies,
    // headers, worker credentials or employee data to public Actions logs.
    const statuses = { GET: "not-sent", POST: "not-sent" };
    let result;
    try {
      result = await dispatchSchedulerTick({
        env: {
          PAYROLL_SCHEDULER_DISPATCH_ENABLED: "true", // TEST MEMORY ONLY, never a repository or Vercel flag
          PAYROLL_SCHEDULER_ORIGIN: FAKE_HTTPS_ORIGIN,
          PAYROLL_SCHEDULER_EXPECTED_HOST: "scheduler-proof.example.test",
          PAYROLL_SCHEDULER_EXPECTED_DEPLOYMENT_SHA: env.VERCEL_GIT_COMMIT_SHA,
          PAYROLL_SCHEDULER_WORKER_TOKEN: env.WORKER_TOKEN,
        },
        fetchImpl: loopbackSchedulerTransport(counters, async (url, options) => {
          const response = await fetch(url, options);
          statuses[options.method] = response.status;
          return response;
        }),
      });
    } catch {
      // assertDisposableProof ran before opening this PostgreSQL client. The
      // worker/scheduler receipt records ONLY approved job names and SQLSTATE
      // codes; never display backend exception text or stored job payloads.
      console.error("P0-1 isolated HTTP status: readiness=" + statuses.GET + " tick=" + statuses.POST);
      try {
        const { rows } = await client.query(
          "SELECT last_result FROM scheduler_state WHERE job_name = 'central-scheduler-failure' LIMIT 1",
        );
        const receipt = rows[0]?.last_result;
        if (receipt?.status === "failed" && Array.isArray(receipt.jobs)) {
          const codes = receipt.jobs.slice(0, 16).map((row) => ({
            job: typeof row.job === "string" && /^[A-Za-z][A-Za-z0-9._-]{0,79}$/.test(row.job) ? row.job : "unclassified",
            code: typeof row.code === "string" && /^(?:[A-Z0-9]{5}|DISPATCH_UNCONFIRMED|JOB_FAILED)$/.test(row.code) ? row.code : "JOB_FAILED",
          }));
          console.error("P0-1 isolated scheduler failed jobs (sanitized): " + JSON.stringify(codes));
        }
      } catch {
        console.error("P0-1 isolated scheduler receipt unavailable");
      }
      throw new Error("P0-1_CI_DISPATCH_NOT_ACKNOWLEDGED");
    }
    assert.equal(result.outcome, "tick-acknowledged");
    assert.deepEqual(counters, { GET: 1, POST: 1 }, "one validated GET, one authenticated POST, no retries");

    const afterTick = await readState(client, seed.runId);
    assert.equal(afterTick.jobs[0]?.status, "queued", "central scheduler alone must not impersonate a payroll worker");
    assert.equal(afterTick.entries.length, 0);
    const receipt = afterTick.heartbeats.find((row) => row.job_name === "delivery-drain");
    const lease = afterTick.heartbeats.find((row) => row.job_name === "central-scheduler-lease");
    assert.ok(receipt?.last_run_at && receipt?.last_result?.at, "fenced scheduler completion receipt is required");
    assert.ok(Number.isSafeInteger(receipt.last_result.auditChainSeal?.sealed),
      "audit chain sealing must succeed; an optional failed task is not a clean scheduler proof");
    assert.equal(lease?.last_result?.status, "completed", "fenced scheduler lease must be released successfully");
    assert.ok(Date.now() - new Date(receipt.last_run_at).getTime() < 120000, "heartbeat must be fresh");

    // The reviewed external scheduler only ticks shared scheduled tasks; the
    // existing dedicated payroll worker independently consumes payroll_jobs.
    // GitHub CI starts it unattended (NO direct processing function call).
    mkdirSync("qa-artifacts", { recursive: true });
    worker = spawn("npm", ["run", "worker"], {
      cwd: resolve("."),
      env: {
        ...env, WORKER_ENABLED: "true", CENTRAL_SCHEDULER_ENABLED: "false",
        WORKER_POLL_MS: "1000",
      },
      // The synthetic worker handles only disposable payroll. Do not create
      // predictable log files in /tmp or capture any potentially sensitive
      // process output; database status and the sanitized JSON proof suffice.
      stdio: ["ignore", "ignore", "ignore"],
      shell: false,
    });
    const completed = await waitForCompletedPayroll(client, seed.runId, worker, Date.now() + MAX_WAIT_MS);
    assert.equal(completed.runs[0].status, "Needs review", "financial release must NEVER happen during synthetic proof");
    assert.equal(completed.entries.length, 1);
    assert.equal(completed.runs[0].employee_count, 1);
    assert.ok(Number(completed.entries[0].gross_pay) >= 0);
    assert.ok(Number(completed.entries[0].net_pay) >= 0);
    const report = {
      event: "p0-1-unattended-synthetic-payroll",
      result: "passed",
      mode: "automatic-github-ci-disposable-postgres16",
      source: "GitHub PR/push automation, not workflow_dispatch",
      githubRunId: env.GITHUB_RUN_ID,
      sourceCommit: env.VERCEL_GIT_COMMIT_SHA,
      productionCredentialsUsed: false,
      productionSchedulerEnabled: false,
      externalTransport: "isolated HTTPS origin rewritten to localhost IN TEST ONLY",
      dispatchPreflights: counters.GET,
      dispatchPosts: counters.POST,
      schedulerReceiptPresent: true,
      schedulerLeaseFinalStatus: lease.last_result.status,
      auditChainSealResult: "verified",
      syntheticPayrollJobStatus: completed.jobs[0].status,
      syntheticRunStatus: completed.runs[0].status,
      syntheticEntryCount: completed.entries.length,
      statutoryFilingSubmitted: false,
      externalPaymentProviderConfigured: false,
      actualGitHubScheduledProductionTickProven: false,
      at: new Date().toISOString(),
    };
    writeFileSync("qa-artifacts/p0-1-unattended-scheduler-proof.json", JSON.stringify(report, null, 2));
    process.stdout.write("PASS P0-1: automated external dispatch + fenced heartbeat + autonomous fictional payroll worker; no manual trigger, no payment\n");
  } finally {
    await terminate(worker);
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  proveUnattendedPayroll().catch(() => {
    // Avoid forwarding arbitrary backend errors or secrets into Actions logs.
    console.error("P0-1 unattended proof FAILED; inspect isolated test diagnostics.");
    process.exitCode = 1;
  });
}
