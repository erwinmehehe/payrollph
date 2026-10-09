import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { schedulerState } from "../src/db/schema";
import { assertIsolatedSchedulerRehearsal } from "./helpers/scheduler-isolated-guard";

const childPath = fileURLToPath(new URL("./helpers/scheduler-lease-process.ts", import.meta.url));
type ProcessResult = { child: ChildProcess; ok: boolean };

async function runIndependentProcess(
  action: "acquire" | "refresh" | "release" | "receipt",
  leaseName: string,
  ownerToken: string,
  receiptName = "",
  receiptTag = "",
): Promise<ProcessResult> {
  const child = fork(childPath, [action, leaseName, ownerToken, receiptName, receiptTag], {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: process.env,
  });
  return new Promise<ProcessResult>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      fail("Isolated scheduler contender timed out.");
    }, 30_000);
    function fail(message: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(new Error(message));
    }
    child.on("message", (value: unknown) => {
      if (settled) return;
      if (!value || typeof value !== "object" ||
          (value as {type?: string}).type !== "scheduler-rehearsal" ||
          typeof (value as {ok?: unknown}).ok !== "boolean") {
        fail("Isolated scheduler contender returned an invalid result.");
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({child, ok: (value as {ok: boolean}).ok});
    });
    child.once("error", () => fail("Isolated scheduler contender could not start."));
    child.once("exit", (code) => {
      if (!settled) fail("Isolated scheduler contender exited before reporting an outcome.");
    });
  });
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    if (!child.kill("SIGKILL")) {
      clearTimeout(timer);
      resolve();
    }
  });
}

test("synthetic rehearsal refuses every remote DB, missing opt-in and non-CI execution", () => {
  const valid = {
    CI: "true",
    SCHEDULER_REHEARSAL_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  };
  assert.doesNotThrow(() => assertIsolatedSchedulerRehearsal(valid));
  for (const disallowed of [
    {...valid, CI: "false"},
    {...valid, SCHEDULER_REHEARSAL_MODE: "staging"},
    {...valid, DATABASE_URL: "postgresql://postgres:postgres@prod.example.com:5432/app_db"},
    {...valid, DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/payroll_production"},
    {...valid, DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5433/app_db"},
    {...valid, DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db?sslmode=require"},
    {...valid, DATABASE_URL: "postgresql://other:secret@127.0.0.1:5432/app_db"},
  ]) assert.throws(() => assertIsolatedSchedulerRehearsal(disallowed), /scheduler rehearsal/i);
});

test("two separate OS processes serialize a lease; crash, takeover and stale completion are fenced", {
  skip: process.env.SCHEDULER_REHEARSAL_MODE !== "isolated-ci-only" || process.platform === "win32",
  timeout: 110_000,
}, async () => {
  // IMPORTANT: every subprocess independently enforces this same host/database
  // allowlist before importing db modules or opening any database connection.
  assertIsolatedSchedulerRehearsal(process.env);
  const leaseName = "ci-scheduler-" + randomUUID();
  const receiptName = "ci-receipt-" + randomUUID();
  const firstOwner = randomUUID();
  const rivalOwner = randomUUID();
  const recoveredOwner = randomUUID();
  const tracked = new Set<ChildProcess>();
  async function perform(
    action: "acquire" | "refresh" | "release" | "receipt",
    owner: string,
    tag = "",
  ) {
    const result = await runIndependentProcess(action, leaseName, owner, receiptName, tag);
    tracked.add(result.child);
    return result;
  }
  try {
    // These are two real node OS processes and two separate DB pools.
    const competitors = await Promise.all([
      perform("acquire", firstOwner),
      perform("acquire", rivalOwner),
    ]);
    assert.equal(competitors.filter(x => x.ok).length, 1,
      "exactly one independently running process may own the scheduler lease");
    const winner = competitors.find(x => x.ok);
    assert.ok(winner);
    const oldOwner = competitors[0].ok ? firstOwner : rivalOwner;
    const waitingOwner = competitors[0].ok ? rivalOwner : firstOwner;

    assert.equal((await perform("acquire", waitingOwner)).ok, false,
      "second worker must not start before the current owner's lease expires");
    await terminate(winner.child); // Simulated worker crash: no graceful release.
    assert.equal((await perform("acquire", waitingOwner)).ok, false,
      "an abandoned but not expired lease must still prevent duplicate work");

    // Jump the synthetic lease clock forward instead of sleeping 15 minutes.
    // Updates only the unique isolated-ci scheduler_state fixture.
    await db.update(schedulerState)
      .set({lastRunAt: new Date(Date.now() - 16 * 60_000)})
      .where(eq(schedulerState.jobName, leaseName));

    const replacement = await perform("acquire", recoveredOwner);
    assert.equal(replacement.ok, true,
      "one new worker must be able to recover a genuinely expired lease");
    assert.equal((await perform("refresh", oldOwner)).ok, false);
    assert.equal((await perform("release", oldOwner)).ok, false);
    assert.equal((await perform("receipt", oldOwner, "stale")).ok, false,
      "former owner must not write the completion receipt after takeover");

    assert.equal((await perform("refresh", recoveredOwner)).ok, true);
    assert.equal((await perform("receipt", recoveredOwner, "recovered")).ok, true);
    const [receipt] = await db.select({payload: schedulerState.lastResult})
      .from(schedulerState).where(eq(schedulerState.jobName, receiptName)).limit(1);
    assert.equal((receipt?.payload as {tag?: string}|undefined)?.tag, "recovered",
      "only the active process may write success evidence");
    assert.equal((await perform("release", recoveredOwner)).ok, true);
    await terminate(replacement.child);
    assert.equal((await perform("acquire", waitingOwner)).ok, true,
      "a fresh owner can start after a successful completed lease");
  } finally {
    await Promise.all([...tracked].map(terminate));
    await db.delete(schedulerState)
      .where(inArray(schedulerState.jobName, [leaseName, receiptName]));
  }
});
