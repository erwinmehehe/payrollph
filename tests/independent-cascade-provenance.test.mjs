import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySyntheticCascade, corroborateCascadeResiduals,
} from "../scripts/lib/independent-cascade-provenance.mjs";

const before = [
  { childTable:"compensation_automation_intents", referencedTable:"compensation_events",
    constraintName:"compensation_automation_intents_compensation_event_id_compensat",
    definition:"FOREIGN KEY (compensation_event_id) REFERENCES compensation_events(id) ON DELETE CASCADE" },
  { childTable:"legal_entity_transfer_liability_evidence", referencedTable:"entity_transfer_requests",
    constraintName:"entity_transfer_liability_approved_source_fk",
    definition:"FOREIGN KEY (organization_id, transfer_request_id) REFERENCES entity_transfer_requests(organization_id, id)" },
  { childTable:"legal_entity_transfer_liability_evidence", referencedTable:"entity_transfer_requests",
    constraintName:"legal_entity_transfer_liability_evidence_transfer_request_id_en",
    definition:"FOREIGN KEY (transfer_request_id) REFERENCES entity_transfer_requests(id)" },
];
const residuals = before.map(row => ({
  table: row.childTable, object: row.constraintName,
  status: "MISSING", category:"POSSIBLE_SYNTHETIC_DROP_CASCADE_FK_LOSS_REVIEW",
}));

test("the three observed fixture-only FK drop candidates are traced, never waived", () => {
  const report = classifySyntheticCascade(before, [], []);
  assert.equal(report.originalCollateralForeignKeys, 3);
  assert.equal(report.stillAbsentByNameAfterReplay, 3);
  assert.ok(report.foreignKeys.every(row =>
    row.status === "REMOVED_BY_SYNTHETIC_CASCADE_NOT_RESTORED_BY_SOURCE_NAME"));
  const comparison = corroborateCascadeResiduals(residuals, report);
  assert.equal(comparison.witnessedSourceCloneDrop, 3);
  assert.equal(comparison.stillUnresolved, 3);
  assert.equal(comparison.waiverCount, 0);
  assert.deepEqual(comparison.unsupported, []);
  assert.equal(report.productionParityEstablished, false);
});

test("an old FK present immediately after DROP is a hard failure", () => {
  assert.throws(() => classifySyntheticCascade(before, [before[0]], []),
    /DROP CASCADE did not remove original foreign key/);
});

test("same-named recreated FK with different definition cannot be called restored", () => {
  const trace = classifySyntheticCascade(before, [], [
    { ...before[0], definition:"FOREIGN KEY (compensation_event_id) REFERENCES compensation_events(id) ON DELETE SET NULL" },
  ]);
  assert.equal(trace.foreignKeys.find(row => row.childTable ===
    "compensation_automation_intents").status, "NAME_REUSED_WITH_DIFFERENT_CONTRACT_REVIEW");
  const corroboration = corroborateCascadeResiduals(residuals, trace);
  assert.equal(corroboration.witnessedSourceCloneDrop, 2);
  assert.equal(corroboration.unsupported.length, 1);
  assert.equal(corroboration.disposition, "UNPROVEN_CASCADE_CAUSALITY_BLOCK");
});

test("unexpected shape, duplicate provenance and fabricated residual must block", () => {
  assert.throws(() => classifySyntheticCascade([before[0], before[0]], [], []), /duplicate/);
  assert.throws(() => classifySyntheticCascade([{...before[0], definition:""}], [], []), /invalid/);
  assert.throws(() => corroborateCascadeResiduals(residuals, {}), /Missing valid/);
  const trace = classifySyntheticCascade(before, [], []);
  const madeUp = {table:"employees",object:"fake_fk",status:"MISSING",
    category:"POSSIBLE_SYNTHETIC_DROP_CASCADE_FK_LOSS_REVIEW"};
  assert.equal(corroborateCascadeResiduals([...residuals,madeUp],trace).unsupported.length,1);
});

test("non-cascade mismatches remain outside the witnessed subset", () => {
  const trace = classifySyntheticCascade(before, [], []);
  const extra = { table:"payroll_entries",object:"legal_entity_id",
    kind:"column",status:"EXTRA",category:"FORWARD_DDL_VS_SOURCE_MODEL_REVIEW" };
  const result = corroborateCascadeResiduals([...residuals,extra],trace);
  assert.equal(result.possibleFixtureCascadeResiduals,3);
  assert.equal(result.stillUnresolved,3);
  assert.equal(result.waiverCount,0);
});
