import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  "src/app/api/compliance/statutory-remittance-corrections/route.ts",
  "utf8",
);
const schema = readFileSync("src/db/schema.ts", "utf8");
const panel = readFileSync(
  "src/components/workspace/statutory-remittance-corrections-panel.tsx",
  "utf8",
);
const payroll = readFileSync("src/components/workspace/payroll-run.tsx", "utf8");

test("remittance corrections are first-class immutable audit requests", () => {
  assert.ok(schema.includes("export const statutoryRemittanceCorrectionRequests"));
  assert.ok(schema.includes('"original_snapshot"'));
  assert.ok(schema.includes('"proposed_snapshot"'));
  assert.ok(schema.includes('"requested_by_user_id"'));
  assert.ok(schema.includes('"decided_by_user_id"'));
  assert.ok(schema.includes('"applied_at"'));
});

test("requester and approver powers are separated with no self-approval", () => {
  assert.ok(route.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(route.includes('const APPROVER_ROLES = ["owner", "admin", "checker"]'));
  assert.ok(route.includes("correction.requestedByUserId === user.id"));
  assert.ok(route.includes("The requester cannot approve or reject their own"));
  assert.ok(route.includes("company-wide"));
});

test("only one pending correction is allowed per target", () => {
  assert.ok(route.includes('eq(statutoryRemittanceCorrectionRequests.status, "pending")'));
  assert.ok(route.includes("A payment correction is already pending"));
  assert.ok(route.includes("A posting correction is already pending"));
});

test("approval fails closed when evidence changed after the request", () => {
  assert.ok(route.includes("snapshotsMatch(current, correction.originalSnapshot)"));
  assert.ok(route.includes("Payment evidence changed after this correction was requested."));
  assert.ok(route.includes("Employee posting evidence changed after this correction was requested."));
});

test("correction approval revalidates contribution amounts before applying", () => {
  assert.ok(route.includes("validatePaymentCorrection"));
  assert.ok(route.includes("validatePostingCorrection"));
  assert.ok(route.includes("expectedTotal: Number(batch.expectedTotal)"));
  assert.ok(route.includes("expectedTotal: Number(member.totalContribution)"));
});

test("corrections preserve original recorder/confirmer and rely on audit for approver identity", () => {
  const paymentUpdate = route.slice(
    route.indexOf("await tx.update(statutoryRemittanceBatches).set({"),
    route.indexOf("resource =", route.indexOf("await tx.update(statutoryRemittanceBatches).set({")),
  );
  assert.ok(!paymentUpdate.includes("paymentRecordedBy:"));

  const postingUpdate = route.slice(
    route.indexOf("await tx.update(statutoryRemittanceMembers).set({"),
    route.indexOf("resource =", route.indexOf("await tx.update(statutoryRemittanceMembers).set({")),
  );
  assert.ok(!postingUpdate.includes("confirmedBy:"));
  assert.ok(route.includes("requestedByName: correction.requestedByName"));
  assert.ok(route.includes("action: \"Statutory remittance evidence correction approved\""));
});

test("correction mutations use same-origin, MFA, rate limits and audit events", () => {
  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit(request"));
  assert.ok(route.includes("recordAuditEvent"));
});

test("payroll UI exposes four-eyes request and approval workflow", () => {
  assert.ok(panel.includes("AUDITED EVIDENCE CORRECTIONS"));
  assert.ok(panel.includes("Needs another approver"));
  assert.ok(panel.includes("request_payment_correction"));
  assert.ok(panel.includes("request_posting_correction"));
  assert.ok(panel.includes('void decide(correction, "approve")'));
  assert.ok(payroll.includes("<StatutoryRemittanceCorrectionsPanel"));
});


test("correction API self-initializes its additive table for existing deployments", () => {
  const schemaGuard = readFileSync("src/lib/statutory-remittance-correction-schema.ts", "utf8");
  assert.ok(route.includes("ensureStatutoryRemittanceCorrectionSchema"));
  assert.ok(schemaGuard.includes("CREATE TABLE IF NOT EXISTS statutory_remittance_correction_requests"));
  assert.ok(schemaGuard.includes("pg_advisory_xact_lock"));
});
