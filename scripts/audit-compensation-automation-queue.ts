import { inspectCompensationAutomationIntents } from "../src/lib/compensation-automation-outbox";

async function main() {
  const args = process.argv.slice(2);
  const [orgRaw, afterRaw = "0", limitRaw = "100"] = args;
  const organizationId = Number(orgRaw);
  const afterId = Number(afterRaw);
  const limit = Number(limitRaw);
  if (args.length < 1 || args.length > 3
    || !Number.isSafeInteger(organizationId) || organizationId <= 0
    || !Number.isSafeInteger(afterId) || afterId < 0
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 250) {
    console.error("Usage: npm run compensation:automation:audit -- <organizationId> [afterId=0] [limit=100]");
    process.exitCode = 2;
    return;
  }
  try {
    const result = await inspectCompensationAutomationIntents({
      organizationId, afterId, limit,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.needsReview > 0 ? 1 : result.nextCursor != null ? 3 : 0;
  } catch {
    console.error("Could not inspect compensation automation. Confirm tenant scope and read-only database access.");
    process.exitCode = 2;
  }
}

void main();
