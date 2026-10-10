import { assertIsolatedSchedulerRehearsal } from "./scheduler-isolated-guard";

/**
 * Independent OS process using its own PostgreSQL connection pool.
 * No employer records, scheduler tasks, emails, salary or bank side effects.
 */
async function main() {
  assertIsolatedSchedulerRehearsal(process.env);
  const [action, leaseName, token, receiptName, receiptTag] = process.argv.slice(2);
  if (!["acquire", "refresh", "release", "receipt"].includes(action) ||
      !leaseName?.startsWith("ci-scheduler-") ||
      !/^[a-f0-9-]{36}$/i.test(token ?? "") ||
      (action === "receipt" && (!receiptName?.startsWith("ci-receipt-") || !["recovered", "stale"].includes(receiptTag ?? "")))) {
    throw new Error("Invalid isolated scheduler rehearsal command.");
  }
  const { pool } = await import("../../src/db");
  const lease = await import("../../src/lib/scheduler-lease");
  try {
    let ok: boolean;
    switch (action) {
      case "acquire":
        ok = await lease.acquireSchedulerLease(token, leaseName);
        break;
      case "refresh":
        ok = await lease.refreshSchedulerLease(token, leaseName);
        break;
      case "release":
        ok = await lease.releaseSchedulerLease(token, "completed", leaseName);
        break;
      default:
        ok = await lease.recordSchedulerCompletion(token, { tag: receiptTag }, receiptName, leaseName);
    }
    if (!process.send) throw new Error("Rehearsal subprocess must use IPC.");
    await new Promise<void>((resolve, reject) => {
      process.send?.({ type: "scheduler-rehearsal", ok }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    if (action === "acquire" && ok) {
      // Represents a live worker that might be terminated without releasing
      // its database-backed lease. No scheduler effects are executed.
      setInterval(() => {}, 60_000);
    } else {
      await pool.end();
    }
  } catch {
    await pool.end();
    throw new Error("Isolated scheduler process rehearsal failed.");
  }
}

main().catch(() => {
  console.error("Isolated scheduler rehearsal subprocess failed.");
  process.exitCode = 1;
});
