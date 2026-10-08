import { retryUnstartedCompensationAutomationIntent } from "../src/lib/compensation-automation-outbox";

async function main() {
  const [orgRaw, intentRaw, reviewer, confirmation] = process.argv.slice(2);
  const organizationId = Number(orgRaw);
  const intentId = Number(intentRaw);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0
    || !Number.isSafeInteger(intentId) || intentId <= 0
    || !reviewer?.trim() || reviewer.length > 120 || confirmation !== "--confirm-reviewed") {
    console.error("Usage: npm run compensation:automation:recover -- <organizationId> <intentId> <reviewer> --confirm-reviewed");
    console.error("Human approval and authorized database credentials required. Never requeue an ambiguous execution.");
    process.exitCode = 2;
    return;
  }
  try {
    const result = await retryUnstartedCompensationAutomationIntent({
      organizationId, intentId, reviewer,
    });
    console.log(JSON.stringify(result));
  } catch {
    console.error("Recovery was refused. The intent is not a safe, unstarted event or the tenant scope was invalid.");
    process.exitCode = 1;
  }
}

void main();
