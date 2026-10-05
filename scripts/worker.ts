import "dotenv/config";
import { pool } from "../src/db";
import { processNextPayrollJob } from "../src/lib/payroll-engine";
import { drainWebhookRetries } from "../src/lib/webhooks";
import { drainOutboxRetries } from "../src/lib/mailer";
import { runScheduledStatutoryRemittanceSync } from "../src/lib/statutory-remittance-actions";
import { runScheduledContributionCaseEscalations } from "../src/lib/statutory-contribution-case-escalations";
import { runScheduledEmployeeLifecycleTransactions } from "../src/lib/hcm-employee-lifecycle";

const POLL_MS = Math.max(1000, Number(process.env.WORKER_POLL_MS ?? "3000"));
let stopping = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tick() {
  const payroll = await processNextPayrollJob("dedicated-worker");
  const webhooks = await drainWebhookRetries(20);
  const mail = await drainOutboxRetries(20);
  const statutoryRemittanceActions = await runScheduledStatutoryRemittanceSync({
    actor: "Dedicated worker",
  });
  const contributionCaseEscalations = await runScheduledContributionCaseEscalations({
    actor: "Dedicated worker",
  });
  const employeeLifecycleTransactions = await runScheduledEmployeeLifecycleTransactions({
    actor: "Dedicated HCM worker",
  });
  return {
    payrollProcessed: payroll.processed,
    webhookRetries: webhooks.length,
    mailRetries: mail.filter((item) => item.retried).length,
    statutoryRemittanceActions,
    contributionCaseEscalations,
    employeeLifecycleTransactions,
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
      if (!result.payrollProcessed && result.webhookRetries === 0 && result.mailRetries === 0) {
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
