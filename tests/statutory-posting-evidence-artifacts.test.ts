import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const manual = readFileSync("src/app/api/compliance/statutory-remittances/route.ts", "utf8");
const postingImport = readFileSync("src/app/api/compliance/statutory-remittances/posting-import/route.ts", "utf8");
const state = readFileSync("src/lib/statutory-remittance-state.ts", "utf8");
const selfPayslips = readFileSync("src/app/api/self/payslips/route.ts", "utf8");
const selfEvidence = readFileSync("src/app/api/self/contribution-evidence/route.ts", "utf8");
const employeeUi = readFileSync("src/components/self-service-portal.tsx", "utf8");
const payrollUi = readFileSync("src/components/workspace/statutory-remittance-panel.tsx", "utf8");

test("posting evidence artifacts are first-class and member-linked", () => {
  assert.ok(schema.includes('export const statutoryPostingEvidenceArtifacts = pgTable('));
  assert.ok(schema.includes('"statutory_posting_evidence_artifacts"'));
  assert.ok(schema.includes('postingEvidenceArtifactId: integer("posting_evidence_artifact_id")'));
  assert.ok(schema.includes('uniqueIndex("statutory_posting_evidence_batch_hash_unique")'));
});

test("manual posting confirmation creates and links a manual evidence artifact transactionally", () => {
  assert.ok(manual.includes('sourceType: "manual_confirmation"'));
  assert.ok(manual.includes("manualPostingEvidenceHash"));
  assert.ok(manual.includes("postingEvidenceArtifactId: artifact.id"));
  assert.ok(manual.includes("const confirmation = await db.transaction"));
  assert.ok(manual.includes("evidenceHashSha256: confirmation.artifact.contentSha256"));
});

test("posting exception clears any stale evidence artifact link", () => {
  assert.ok(manual.includes("postingEvidenceArtifactId: null"));
});

test("CSV posting import persists the exact file hash and links all applied rows", () => {
  assert.ok(postingImport.includes('sourceType: "csv_import"'));
  assert.ok(postingImport.includes("contentSha256: parsed.hash"));
  assert.ok(postingImport.includes("rowCount: matched.length"));
  assert.ok(postingImport.includes("postingEvidenceArtifactId: artifact.id"));
  assert.ok(postingImport.includes("evidenceHashSha256: result.artifact.contentSha256"));
});

test("remittance state enriches members with source provenance", () => {
  assert.ok(state.includes("statutoryPostingEvidenceArtifacts"));
  assert.ok(state.includes("postingEvidenceSource"));
  assert.ok(state.includes("postingEvidenceHashSha256"));
});

test("employee self-service scopes posting artifact lookup to employee organization and batch", () => {
  assert.ok(selfPayslips.includes("statutoryPostingEvidenceArtifacts"));
  assert.ok(selfEvidence.includes("eq(statutoryPostingEvidenceArtifacts.organizationId, employee.organizationId)"));
  assert.ok(selfEvidence.includes("eq(statutoryPostingEvidenceArtifacts.batchId, batch!.id)"));
  assert.ok(selfEvidence.includes("postingEvidence: postingEvidenceArtifact ?"));
});

test("payroll and employee UI distinguish imported agency evidence from manual confirmation", () => {
  for (const source of [payrollUi, employeeUi]) {
    assert.ok(source.includes("Imported agency evidence"));
    assert.ok(source.includes("Manual payroll confirmation"));
  }
});
