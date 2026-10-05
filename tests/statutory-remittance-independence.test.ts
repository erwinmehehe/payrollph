import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEvidenceActorIdentity,
  certifierConflictsWithEvidence,
} from "../src/lib/statutory-remittance-independence";

test("stable user ID blocks self-certification even after a display-name change", () => {
  const evidence = buildEvidenceActorIdentity([
    { userId: 42, name: "Old Payroll Name" },
  ]);

  assert.equal(certifierConflictsWithEvidence({
    certifierUserId: 42,
    certifierName: "Renamed Payroll User",
    evidence,
  }), true);
});

test("duplicate display names do not block a different user when stable IDs exist", () => {
  const evidence = buildEvidenceActorIdentity([
    { userId: 42, name: "Alex Santos" },
  ]);

  assert.equal(certifierConflictsWithEvidence({
    certifierUserId: 84,
    certifierName: "Alex Santos",
    evidence,
  }), false);
});

test("legacy evidence without a user ID remains fail-closed by actor name", () => {
  const evidence = buildEvidenceActorIdentity([
    { userId: null, name: "Legacy Payroll User" },
  ]);

  assert.equal(certifierConflictsWithEvidence({
    certifierUserId: 100,
    certifierName: "Legacy Payroll User",
    evidence,
  }), true);
});

test("blank legacy actor names are ignored", () => {
  const evidence = buildEvidenceActorIdentity([
    { userId: null, name: "   " },
    { userId: null, name: null },
  ]);

  assert.equal(evidence.userIds.size, 0);
  assert.equal(evidence.legacyNames.size, 0);
});
