import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRemittanceMonthClose } from "../src/lib/statutory-remittance-close";
import {
  manualPostingEvidenceHash,
  postingCsvEvidence,
  postingEvidenceSourceLabel,
} from "../src/lib/statutory-posting-evidence";

test("CSV posting evidence preserves exact UTF-8 bytes and SHA-256", () => {
  const csv = "employee_no,posted_amount,posting_reference,posted_at\nEMP-001,1500.00,REF-001,2026-10-05\n";
  const evidence = postingCsvEvidence({ csv, fileName: "agency.csv" });

  assert.equal(evidence.sourceType, "csv_import");
  assert.equal(evidence.fileName, "agency.csv");
  assert.equal(evidence.mimeType, "text/csv");
  assert.equal(evidence.byteSize, Buffer.byteLength(csv, "utf8"));
  assert.equal(Buffer.from(evidence.fileDataBase64, "base64").toString("utf8"), csv);
  assert.match(evidence.contentSha256, /^[a-f0-9]{64}$/);
});

test("CSV posting evidence hash changes when source bytes change", () => {
  const a = postingCsvEvidence({
    csv: "employee_no,posted_amount,posting_reference,posted_at\nEMP-001,1500,REF-1,2026-10-05\n",
    fileName: "agency.csv",
  });
  const b = postingCsvEvidence({
    csv: "employee_no,posted_amount,posting_reference,posted_at\nEMP-001,1501,REF-1,2026-10-05\n",
    fileName: "agency.csv",
  });
  assert.notEqual(a.contentSha256, b.contentSha256);
});

test("manual posting evidence hash is deterministic but changes with material fields", () => {
  const base = {
    organizationId: 1,
    batchId: 2,
    memberId: 3,
    postingReference: "REF-001",
    postedAmount: 1500,
    postedAt: "2026-10-05T02:00:00.000Z",
  };
  assert.equal(manualPostingEvidenceHash(base), manualPostingEvidenceHash(base));
  assert.notEqual(
    manualPostingEvidenceHash(base),
    manualPostingEvidenceHash({ ...base, postedAmount: 1500.01 }),
  );
  assert.notEqual(
    manualPostingEvidenceHash(base),
    manualPostingEvidenceHash({ ...base, postingReference: "REF-002" }),
  );
});

test("posting evidence source labels distinguish imported and manual provenance", () => {
  assert.equal(postingEvidenceSourceLabel("csv_import"), "Imported agency evidence");
  assert.equal(postingEvidenceSourceLabel("manual_confirmation"), "Manual payroll confirmation");
  assert.equal(postingEvidenceSourceLabel(null), "Evidence source unavailable");
});


test("month-close evidence preserves the historical member shape when no posting artifact exists", () => {
  const evaluated = evaluateRemittanceMonthClose({
    applicableMonth: "2026-09",
    requiredAgencies: ["SSS"],
    allPayrollRunsReleased: true,
    alerts: [],
    batches: [{
      id: 1,
      agency: "SSS",
      applicableMonth: "2026-09",
      status: "reconciled",
      snapshotHash: "payroll-snapshot",
      reconciledAt: "2026-10-01T00:00:00.000Z",
      pendingPostingCount: 0,
      exceptionCount: 0,
    }],
    members: [{
      batchId: 1,
      employeeId: 10,
      postingStatus: "confirmed",
      postedAmount: "1500.00",
      postingReference: "REF-001",
      confirmedBy: "Payroll",
    }],
    paymentEvidence: [{
      id: 1,
      batchId: 1,
      fileName: "receipt.pdf",
      fileSha256: "a".repeat(64),
      byteSize: 10,
      status: "active",
      uploadedByName: "Payroll",
      uploadedAt: "2026-10-01T00:00:00.000Z",
    }],
  });

  const member = evaluated.members[0] as Record<string, unknown>;
  assert.equal("postingEvidenceArtifactId" in member, false);
  assert.equal("postingEvidenceHashSha256" in member, false);
});

test("month-close evidence binds posting provenance when an artifact exists", () => {
  const evaluated = evaluateRemittanceMonthClose({
    applicableMonth: "2026-09",
    requiredAgencies: ["SSS"],
    allPayrollRunsReleased: true,
    alerts: [],
    batches: [{
      id: 1,
      agency: "SSS",
      applicableMonth: "2026-09",
      status: "reconciled",
      snapshotHash: "payroll-snapshot",
      reconciledAt: "2026-10-01T00:00:00.000Z",
      pendingPostingCount: 0,
      exceptionCount: 0,
    }],
    members: [{
      batchId: 1,
      employeeId: 10,
      postingStatus: "confirmed",
      postedAmount: "1500.00",
      postingReference: "REF-001",
      confirmedBy: "Payroll",
      postingEvidenceArtifactId: 7,
      postingEvidenceSource: "Imported agency evidence",
      postingEvidenceHashSha256: "b".repeat(64),
    }],
    paymentEvidence: [{
      id: 1,
      batchId: 1,
      fileName: "receipt.pdf",
      fileSha256: "a".repeat(64),
      byteSize: 10,
      status: "active",
      uploadedByName: "Payroll",
      uploadedAt: "2026-10-01T00:00:00.000Z",
    }],
  });

  const member = evaluated.members[0] as Record<string, unknown>;
  assert.equal(member.postingEvidenceArtifactId, 7);
  assert.equal(member.postingEvidenceHashSha256, "b".repeat(64));
});
