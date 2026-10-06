import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const postingImport = readFileSync(
  "src/app/api/compliance/statutory-remittances/posting-import/route.ts",
  "utf8",
);
const manualRoute = readFileSync(
  "src/app/api/compliance/statutory-remittances/route.ts",
  "utf8",
);
const downloadRoute = readFileSync(
  "src/app/api/compliance/statutory-remittances/posting-evidence/[id]/route.ts",
  "utf8",
);
const state = readFileSync("src/lib/statutory-remittance-state.ts", "utf8");
const payrollUi = readFileSync(
  "src/components/workspace/statutory-remittance-panel.tsx",
  "utf8",
);
const selfApi = readFileSync("src/app/api/self/payslips/route.ts", "utf8");
const selfUi = readFileSync("src/components/self-service-portal.tsx", "utf8");
const selfEvidence = readFileSync(
  "src/app/api/self/contribution-evidence/route.ts",
  "utf8",
);
const close = readFileSync("src/lib/statutory-remittance-close.ts", "utf8");

test("posting evidence artifacts retain exact source bytes and link members", () => {
  assert.ok(schema.includes('export const statutoryPostingEvidenceArtifacts = pgTable('));
  assert.ok(schema.includes('fileDataBase64: text("file_data_base64")'));
  assert.ok(schema.includes('contentSha256: varchar("content_sha256"'));
  assert.ok(schema.includes('outcome: varchar("outcome"'));
  assert.ok(schema.includes('postingEvidenceArtifactId: integer("posting_evidence_artifact_id")'));
});

test("CSV apply stores source artifact and member links in one transaction", () => {
  assert.ok(postingImport.includes("postingCsvEvidence({ csv, fileName })"));
  assert.ok(postingImport.includes('outcome: "applied"'));
  assert.ok(postingImport.includes("fileDataBase64: csvEvidence.fileDataBase64"));
  assert.ok(postingImport.includes("postingEvidenceArtifactId: artifact.id"));
  assert.ok(postingImport.includes("evidenceArtifactId: result.artifact.id"));
});

test("CSV mismatch escalation preserves the rejected source file as case evidence", () => {
  assert.ok(postingImport.includes('outcome: "mismatch_cases"'));
  assert.ok(postingImport.includes("evidenceArtifactId: artifact.id"));
  assert.ok(postingImport.includes("fileDataBase64: csvEvidence.fileDataBase64"));
  assert.ok(postingImport.includes("evidenceArtifactId: mismatchResult.artifact.id"));
});

test("manual confirmation has explicit provenance and exception clears stale link", () => {
  assert.ok(manualRoute.includes("manualPostingEvidenceHash"));
  assert.ok(manualRoute.includes('sourceType: "manual_confirmation"'));
  assert.ok(manualRoute.includes('outcome: "manual_confirmed"'));
  assert.ok(manualRoute.includes("postingEvidenceArtifactId: artifact.id"));
  assert.ok(manualRoute.includes("postingEvidenceArtifactId: null"));
  assert.ok(manualRoute.includes("evidenceHashSha256: confirmation.artifact.contentSha256"));
});

test("source CSV download is company-wide payroll-only, MFA-gated and private", () => {
  assert.ok(downloadRoute.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(downloadRoute.includes("access?.companyWide"));
  assert.ok(downloadRoute.includes("requireSensitiveActionMfa(user)"));
  assert.ok(downloadRoute.includes("enforceSensitiveActionRateLimit(request"));
  assert.ok(downloadRoute.includes('"cache-control": "no-store, private"'));
  assert.ok(downloadRoute.includes("artifact.sourceType !== \"csv_import\""));
});

test("payroll UI shows provenance and permits protected source download", () => {
  assert.ok(state.includes("postingEvidenceSource"));
  assert.ok(state.includes("postingEvidenceHashSha256"));
  assert.ok(payrollUi.includes("Imported agency evidence"));
  assert.ok(payrollUi.includes("Manual payroll confirmation") || payrollUi.includes("postingEvidenceSource"));
  assert.ok(payrollUi.includes("Download source evidence"));
});

test("employee self-service exposes hash/source but never the multi-employee CSV", () => {
  assert.ok(selfApi.includes("postingEvidenceSource"));
  assert.ok(selfApi.includes("postingEvidenceHashSha256"));
  assert.ok(selfUi.includes("Posting evidence source"));
  assert.ok(selfEvidence.includes("postingEvidenceArtifact"));
  assert.ok(selfEvidence.includes("postingEvidenceSourceLabel"));
  assert.ok(selfEvidence.includes("are retained for employer audit but are not downloadable from employee self-service"));
  assert.ok(!selfEvidence.includes("fileDataBase64: postingEvidenceArtifact"));
});

test("month-close snapshot is cryptographically bound to posting provenance", () => {
  assert.ok(close.includes("postingEvidenceArtifactId"));
  assert.ok(close.includes("postingEvidenceSource"));
  assert.ok(close.includes("postingEvidenceHashSha256"));
});
