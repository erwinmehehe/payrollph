import "dotenv/config";
import { pool } from "../src/db";
import { processNextPayrollJob } from "../src/lib/payroll-engine";
import { tickScheduler } from "../src/lib/scheduler";

const POLL_MS = Math.max(1000, Number(process.env.WORKER_POLL_MS ?? "3000"));
let stopping = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tick() {
  // A failed payroll job must not prevent scheduled HR/compensation work.
  let payrollProcessed = false;
  try {
    payrollProcessed = (await processNextPayrollJob("dedicated-worker")).processed;
  } catch (error) {
    console.error("Payroll worker job failed:", error instanceof Error ? error.message : error);
  }

  // One authoritative scheduler owns outbox/webhook retries, statutory sync,
  // retention, effective-dated HCM/compensation, and workflow continuations.
  // Its durable lease prevents overlapping runs across app instances.
  const scheduled = await tickScheduler();
  return {
    payrollProcessed,
    schedulerTriggered: !scheduled.skipped,
    schedulerSkipReason: scheduled.skipped ? scheduled.reason : null,
    webhookRetries: scheduled.skipped ? 0 : scheduled.webhookRetries,
    mailRetries: scheduled.skipped ? 0 : scheduled.mailRetries,
    marketingLeadNotifications: scheduled.skipped ? 0 : scheduled.marketingLeadNotifications,
  };
}

async function main() {
  if (process.env.WORKER_ENABLED !== "true") {
    throw new Error("WORKER_ENABLED must be true before starting the dedicated worker.");
  }

  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });

  console.log(`Linaw worker started. Poll interval: ${POLL_MS}ms.`);

  while (!stopping) {
    try {
      const result = await tick();
      if (!result.payrollProcessed) {
        await sleep(POLL_MS);
      }
    } catch (error) {
      console.error("Worker tick failed:", error instanceof Error ? error.message : error);
      await sleep(POLL_MS);
    }
  }

  console.log("Linaw worker stopping.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
