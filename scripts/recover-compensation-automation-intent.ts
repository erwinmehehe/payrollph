import { readSignedCompensationRecoveryApprovalFile } from "./read-compensation-recovery-approval";
import { retryUnstartedCompensationAutomationIntent } from "../src/lib/compensation-automation-outbox";

async function main() {
  const [orgRaw, intentRaw, approvalFile, confirmation, ...extra] = process.argv.slice(2);
  const organizationId = Number(orgRaw);
  const intentId = Number(intentRaw);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0
    || !Number.isSafeInteger(intentId) || intentId <= 0
    || !approvalFile || confirmation !== "--confirm-reviewed" || extra.length > 0) {
    console.error("Usage: npm run compensation:automation:recover -- <organizationId> <intentId> <signed-approval.json> --confirm-reviewed");
    console.error("An independently signed Ed25519 approval, dedicated authorized operator identity and least-privilege DB credential are required.");
    process.exitCode = 2;
    return;
  }
  try {
    const approval = readSignedCompensationRecoveryApprovalFile(approvalFile);
    const result = await retryUnstartedCompensationAutomationIntent({
      organizationId, intentId, approval,
    });
    console.log(JSON.stringify(result));
  } catch {
    console.error("Recovery refused: missing/invalid approval or unsafe/changed intent evidence.");
    process.exitCode = 1;
  }
}

void main();
