import assert from "node:assert/strict";
import test from "node:test";
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
