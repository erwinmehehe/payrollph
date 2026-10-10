import { inspectAppliedSalaryEvidence } from "../src/lib/compensation-salary-evidence-preflight";

async function main() {
  const args = process.argv.slice(2);
  const [orgRaw, afterRaw = "0", limitRaw = "100"] = args;
  const organizationId = Number(orgRaw);
  const afterProposalId = Number(afterRaw);
  const limit = Number(limitRaw);
  if (args.length < 1 || args.length > 3
    || !Number.isSafeInteger(organizationId) || organizationId <= 0
    || !Number.isSafeInteger(afterProposalId) || afterProposalId < 0
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 250) {
    console.error("Usage: npm run compensation:salary:evidence -- <organizationId> [afterProposalId=0] [limit=100]");
    console.error("Use only an approved tenant-scoped read-only database connection; never share sensitive database secrets.");
    process.exitCode = 2;
    return;
  }
  try {
    const result = await inspectAppliedSalaryEvidence({
      organizationId, afterProposalId, limit,
    });
    console.log(JSON.stringify(result, null, 2));
    // Code 0: clean final page, 1: review findings, 2: invalid input/query,
    // 3: this page is clean but there are further pages to inspect.
    process.exitCode = result.needsReviewCount > 0 ? 1 : result.nextCursor != null ? 3 : 0;
  } catch {
    console.error("Could not inspect applied salary evidence. Confirm organization scope and reporting DB access.");
    process.exitCode = 2;
  }
}

void main();
