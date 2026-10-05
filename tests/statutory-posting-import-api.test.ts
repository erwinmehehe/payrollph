import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  "src/app/api/compliance/statutory-remittances/posting-import/route.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/workspace/statutory-posting-import.tsx",
  "utf8",
);
const parent = readFileSync(
  "src/components/workspace/statutory-remittance-panel.tsx",
  "utf8",
);

test("bulk posting import is company-wide payroll only and protected", () => {
  assert.ok(route.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(route.includes("access?.companyWide"));
  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit(request"));
});

test("bulk posting import cannot run before employer payment or after reconciliation", () => {
  assert.ok(route.includes('batch.status === "open"'));
  assert.ok(route.includes("Record the agency payment before importing member posting evidence."));
  assert.ok(route.includes('batch.status === "reconciled"'));
  assert.ok(route.includes("A reconciled remittance batch is immutable."));
});

test("bulk posting import validates every row before any write", () => {
  const validationPos = route.indexOf("if (errors.length > 0)");
  const transactionPos = route.indexOf("const result = await db.transaction");
  assert.ok(validationPos > 0);
  assert.ok(transactionPos > validationPos);
  assert.ok(route.includes("No posting rows were applied because the file did not pass full validation."));
});

test("bulk posting import checks batch population, immutability and exact posted amounts", () => {
  assert.ok(route.includes("is not part of this remittance batch."));
  assert.ok(route.includes("already has immutable confirmed posting evidence."));
  assert.ok(route.includes("canConfirmMemberPosting({"));
  assert.ok(route.includes("expectedTotal: Number(member.totalContribution)"));
});

test("clean apply updates members transactionally and recomputes batch reconciliation", () => {
  assert.ok(route.includes('postingStatus: "confirmed"'));
  assert.ok(route.includes('status: reconciled ? "reconciled" : exceptions > 0 ? "exception" : "paid"'));
  assert.ok(route.includes("reconciledAt: reconciled ? new Date() : null"));
  assert.ok(route.includes("reconciledBy: reconciled ? user.name : null"));
});

test("posting evidence import keeps an auditable file fingerprint", () => {
  assert.ok(route.includes("fileHash: parsed.hash"));
  assert.ok(route.includes('action: "Statutory member posting evidence imported"'));
  assert.ok(route.includes("employeeIds: matched.map"));
});

test("bulk posting UI requires a successful dry run before apply", () => {
  assert.ok(panel.includes("Validate only"));
  assert.ok(panel.includes("Apply validated file"));
  assert.ok(panel.includes("!result?.dryRun"));
  assert.ok(panel.includes("(result.errorCount ?? 1) > 0"));
  assert.ok(parent.includes("<StatutoryPostingImport"));
});


test("bulk apply fails closed if batch or member posting state changes concurrently", () => {
  assert.ok(route.includes("currentBatch.status === \"open\" || currentBatch.status === \"reconciled\""));
  assert.ok(route.includes("ne(statutoryRemittanceMembers.postingStatus, \"confirmed\")"));
  assert.ok(route.includes("updated.length !== 1"));
  assert.ok(route.includes("No rows were applied."));
});

test("row validation errors preserve the original CSV source line", () => {
  assert.ok(route.includes("const line = row.sourceLine"));
});
