import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidPilotBankDryRunEvidence,
  type PilotBankExportEvent,
} from "../src/lib/pilot-bank-dry-run-evidence";

const releasedAt = new Date("2026-09-30T09:00:00.000Z");
const expected = { employeeCount: 2, netPay: 300.25 };

function preview(overrides: Record<string, unknown> = {}): PilotBankExportEvent {
  return {
    action: "Bank file dry-run generated",
    createdAt: new Date("2026-09-30T09:00:01.000Z"),
    metadata: {
      kind: "bank",
      dryRun: true,
      bankFileCount: 2,
      bankFileParts: [
        { filename: "part-1.csv", rowCount: 1, totalNet: "200.00" },
        { filename: "part-2.csv", rowCount: 1, totalNet: "100.25" },
      ],
      bankExportRowCount: 2,
      bankExportTotalNet: "300.25",
      bankExportMissingDestinations: 0,
      bankExportMissingPaymentSnapshots: 0,
      bankExportMissingIdentitySnapshots: 0,
      bankExportSyntheticDemoDestinations: false,
      bankExportSha256: "f".repeat(64),
      ...overrides,
    },
  };
}

test("post-release multi-part real-destination bank preview qualifies without moving money", () => {
  assert.equal(isValidPilotBankDryRunEvidence(preview(), releasedAt, expected), true);
  assert.equal(isValidPilotBankDryRunEvidence(preview(), null, expected), false);
});

test("bank preview cannot predate release, be a final export, or be used for the wrong population", () => {
  const before = preview();
  before.createdAt = new Date(releasedAt.getTime() - 1);
  assert.equal(isValidPilotBankDryRunEvidence(before, releasedAt, expected), false);
  assert.equal(isValidPilotBankDryRunEvidence({ ...preview(), action: "bank export generated" }, releasedAt, expected), false);
  assert.equal(isValidPilotBankDryRunEvidence(preview({ dryRun: false }), releasedAt, expected), false);
  assert.equal(isValidPilotBankDryRunEvidence(preview(), releasedAt, { ...expected, employeeCount: 1 }), false);
  assert.equal(isValidPilotBankDryRunEvidence({ ...preview(), createdAt: new Date("invalid") }, releasedAt, expected), false);
});

test("missing, legacy, coercible and synthetic metadata are rejected, not normalized to zero", () => {
  for (const field of [
    "bankExportMissingDestinations",
    "bankExportMissingPaymentSnapshots",
    "bankExportMissingIdentitySnapshots",
  ]) {
    for (const value of [null, undefined, "0", false, 1]) {
      assert.equal(isValidPilotBankDryRunEvidence(preview({ [field]: value }), releasedAt, expected), false,
        field + " must be explicit numeric zero, not " + String(value));
    }
  }
  assert.equal(isValidPilotBankDryRunEvidence(preview({ bankExportSyntheticDemoDestinations: true }), releasedAt, expected), false);
  assert.equal(isValidPilotBankDryRunEvidence(preview({ bankExportSyntheticDemoDestinations: null }), releasedAt, expected), false);
  assert.equal(isValidPilotBankDryRunEvidence(preview({ bankExportSha256: null }), releasedAt, expected), false);
  assert.equal(isValidPilotBankDryRunEvidence(preview({ bankExportSha256: "F".repeat(64) }), releasedAt, expected), false);
  assert.equal(isValidPilotBankDryRunEvidence({ ...preview(), metadata: null }, releasedAt, expected), false);
});

test("partial or inconsistent split bank files cannot become independent pilot proof", () => {
  const normal = [
    { filename: "part-1.csv", rowCount: 1, totalNet: "200.00" },
    { filename: "part-2.csv", rowCount: 1, totalNet: "100.25" },
  ];
  const cases: Record<string, unknown>[] = [
    { bankFileCount: null },
    { bankFileCount: 1 },
    { bankFileParts: [] },
    { bankFileParts: [{ ...normal[0], rowCount: 2 }, normal[1]] },
    { bankFileParts: [{ ...normal[0], totalNet: "201.00" }, normal[1]] },
    { bankFileParts: [{ ...normal[0], filename: "" }, normal[1]] },
    { bankExportRowCount: "2" },
    { bankExportRowCount: 3 },
    { bankExportTotalNet: 300.25 },
    { bankExportTotalNet: "300.24" },
    { bankExportTotalNet: "300.250" },
    { bankExportTotalNet: null },
  ];
  for (const overrides of cases) {
    assert.equal(isValidPilotBankDryRunEvidence(preview(overrides), releasedAt, expected), false,
      "must fail closed on " + Object.keys(overrides).join(", "));
  }
});
