import { inspectEndedCompensationEvidence } from "../src/lib/compensation-expiry-evidence-audit";

/**
 * Read-only operator reconciliation. Call one organization and one bounded
 * page at a time. No attempt is made to recreate missing historical evidence.
 */
async function main() {
  const args = process.argv.slice(2);
  const [orgRaw, afterRaw = "0", limitRaw = "100"] = args;
  const organizationId = Number(orgRaw);
  const afterAssignmentId = Number(afterRaw);
  const limit = Number(limitRaw);
  if (args.length < 1 || args.length > 3 || !Number.isSafeInteger(organizationId)
    || organizationId <= 0 || !Number.isSafeInteger(afterAssignmentId)
    || afterAssignmentId < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 250) {
    console.error("Usage: npm run compensation:expiry:audit -- <organizationId> [afterAssignmentId=0] [limit=100]");
    console.error("Requires explicitly scoped read-only database credentials. Never run this against payroll with write permissions.");
    process.exitCode = 2;
  } else {
    try {
      const report = await inspectEndedCompensationEvidence({
        organizationId,
        afterAssignmentId,
        limit,
      });
      console.log(JSON.stringify(report, null, 2));
      // These exit statuses are for an evidence-review workflow, never GA:
      // 0 = this is the last page and no discrepancies were detected
      // 1 = this page contains rows requiring independent review
      // 3 = no findings yet, but another page MUST be inspected
      process.exitCode = report.needsReviewCount > 0 ? 1 : report.nextCursor != null ? 3 : 0;
    } catch {
      console.error("Compensation expiration evidence could not be inspected. Confirm read-only database access and organization scope.");
      process.exitCode = 2;
    }
  }
}

void main();
