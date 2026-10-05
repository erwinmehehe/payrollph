import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const storage = readFileSync("src/lib/storage.ts", "utf8");
const uploadRoute = readFileSync(
  "src/app/api/compliance/statutory-remittances/payment-evidence/route.ts",
  "utf8",
);
const downloadRoute = readFileSync(
  "src/app/api/compliance/statutory-remittances/payment-evidence/[id]/route.ts",
  "utf8",
);
const remittanceRoute = readFileSync(
  "src/app/api/compliance/statutory-remittances/route.ts",
  "utf8",
);
const evidenceRoute = readFileSync(
  "src/app/api/self/contribution-evidence/route.ts",
  "utf8",
);
const closeRoute = readFileSync(
  "src/app/api/compliance/remittance-month-close/route.ts",
  "utf8",
);
const closeLib = readFileSync("src/lib/statutory-remittance-close.ts", "utf8");
const proofUi = readFileSync(
  "src/components/workspace/statutory-payment-proof.tsx",
  "utf8",
);

test("payment proof is a first-class immutable hashed artifact", () => {
  assert.ok(schema.includes('export const statutoryRemittancePaymentEvidence = pgTable('));
  assert.ok(schema.includes('fileSha256: varchar("file_sha256"'));
  assert.ok(schema.includes('fileDataBase64: text("file_data_base64")'));
  assert.ok(schema.includes('status: varchar("status"'));
  assert.ok(schema.includes('supersededAt: timestamp("superseded_at"'));
});

test("payment proof upload is tenant-scoped, MFA-protected, bounded and hashed server-side", () => {
  assert.ok(uploadRoute.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(uploadRoute.includes("access.companyWide"));
  assert.ok(uploadRoute.includes("requireSensitiveActionMfa(user)"));
  assert.ok(uploadRoute.includes("enforceSameOriginMutation(request)"));
  assert.ok(uploadRoute.includes("const MAX_BYTES = 2 * 1024 * 1024"));
  assert.ok(storage.includes("application/pdf"));
  assert.ok(storage.includes("image/jpeg"));
  assert.ok(storage.includes("image/png"));
  assert.ok(uploadRoute.includes("validateUpload(bytes, file.type, file.name)"));
  assert.ok(uploadRoute.includes('createHash("sha256").update(bytes).digest("hex")'));
});

test("paid remittance cannot be recorded without an active proof artifact", () => {
  assert.ok(remittanceRoute.includes("statutoryRemittancePaymentEvidence"));
  assert.ok(remittanceRoute.includes('eq(statutoryRemittancePaymentEvidence.status, "active")'));
  assert.ok(remittanceRoute.includes("Upload the official payment receipt or acknowledgement"));
  assert.ok(remittanceRoute.includes("paymentProofSha256"));
});

test("proof is immutable after payment except one-time historical backfill when missing", () => {
  assert.ok(uploadRoute.includes("Payment proof is immutable once payment has been recorded."));
  assert.ok(uploadRoute.includes("Historical payment proof backfill requires an explanation"));
  assert.ok(uploadRoute.includes("Historical statutory remittance payment proof backfilled"));
  assert.ok(uploadRoute.includes('status: "superseded"'));
});

test("proof downloads are audited and expose the stored hash", () => {
  assert.ok(downloadRoute.includes("Statutory remittance payment proof downloaded"));
  assert.ok(downloadRoute.includes("X-Payment-Proof-Sha256"));
  assert.ok(downloadRoute.includes('createHash("sha256").update(bytes).digest("hex")'));
  assert.ok(downloadRoute.includes("failed its SHA-256 integrity check"));
  assert.ok(downloadRoute.includes("Statutory remittance payment proof integrity check failed"));
  assert.ok(downloadRoute.includes('Cache-Control": "no-store, private"'));
});

test("employee evidence export includes the exact payment proof hash but not raw file bytes", () => {
  assert.ok(evidenceRoute.includes("statutoryRemittancePaymentEvidence"));
  assert.ok(evidenceRoute.includes("paymentProof: paymentProof ?"));
  assert.ok(evidenceRoute.includes("fileSha256: paymentProof.fileSha256"));
  assert.ok(!evidenceRoute.includes("fileDataBase64"));
});

test("month-close certification binds to payment proof and blocks missing proof", () => {
  assert.ok(closeRoute.includes("statutoryRemittancePaymentEvidence"));
  assert.ok(closeRoute.includes("paymentEvidence,"));
  assert.ok(closeLib.includes("has no active hashed payment proof artifact"));
  assert.ok(closeLib.includes("fileSha256: evidence.fileSha256"));
  assert.ok(closeLib.includes("paymentEvidence: evidence.paymentEvidence"));
});

test("payroll UI makes proof upload and historical backfill explicit", () => {
  assert.ok(proofUi.includes("Payment proof required."));
  assert.ok(proofUi.includes("Upload proof"));
  assert.ok(proofUi.includes("Backfill proof"));
  assert.ok(proofUi.includes("SHA-256"));
  assert.ok(proofUi.includes("Superseded proof history"));
});


test("payment proof uses the shared fail-closed malware scanner before storage", () => {
  assert.ok(uploadRoute.includes('from "@/lib/storage"'));
  assert.ok(uploadRoute.includes("validateUpload(bytes, file.type, file.name)"));
  assert.ok(uploadRoute.includes("await scanUpload(bytes"));
  assert.ok(uploadRoute.includes("MALWARE_SCAN_UNAVAILABLE"));
  assert.ok(uploadRoute.includes("MALWARE_DETECTED"));
  assert.ok(uploadRoute.includes("Statutory remittance payment proof scan unavailable"));
  assert.ok(uploadRoute.includes("Statutory remittance payment proof blocked by malware scan"));
});

test("payment proof is stored only after a clean scan and records scan telemetry", () => {
  const scanGate = uploadRoute.indexOf("if (!scan.scannedClean)");
  const insert = uploadRoute.indexOf("tx.insert(statutoryRemittancePaymentEvidence)");
  assert.ok(scanGate >= 0);
  assert.ok(insert > scanGate);
  assert.ok(uploadRoute.includes("malwareScannedClean: scan.scannedClean"));
  assert.ok(uploadRoute.includes("malwareScanEngine: scan.engine"));
  assert.ok(uploadRoute.includes("malwareScanNote: scan.note"));
});
