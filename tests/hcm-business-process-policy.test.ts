import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseHcmBusinessProcessDefinition,
  processTypeForMovement,
  supervisoryOrgPath,
  validateHcmBusinessProcessSteps,
  type HcmBusinessProcessDefinitionLike,
} from "../src/lib/hcm-business-process";

const units = [
  { id: 1, parentId: null, type: "supervisory" },
  { id: 2, parentId: 1, type: "supervisory" },
  { id: 3, parentId: 2, type: "supervisory" },
  { id: 4, parentId: null, type: "department" },
];

const definitions: HcmBusinessProcessDefinitionLike[] = [
  { id: 1, code: "default", name: "Company default", processType: "transfer", supervisoryOrgUnitId: null, version: 9, effectiveFrom: "2026-01-01", effectiveUntil: null, steps: [] },
  { id: 2, code: "parent", name: "Parent scope", processType: "transfer", supervisoryOrgUnitId: 1, version: 1, effectiveFrom: "2026-01-01", effectiveUntil: null, steps: [] },
  { id: 3, code: "child", name: "Nearest scope", processType: "transfer", supervisoryOrgUnitId: 2, version: 2, effectiveFrom: "2026-01-01", effectiveUntil: "2026-06-30", steps: [] },
  { id: 4, code: "child-later", name: "Nearest future", processType: "transfer", supervisoryOrgUnitId: 2, version: 3, effectiveFrom: "2026-07-01", effectiveUntil: null, steps: [] },
];

test("nearest supervisory policy wins before global higher-version policy", () => {
  assert.deepEqual(supervisoryOrgPath(3, units), [3,2,1]);
  const first = chooseHcmBusinessProcessDefinition(definitions, units, { processType: "transfer", supervisoryOrgUnitId: 3, effectiveDate: "2026-06-30" });
  const later = chooseHcmBusinessProcessDefinition(definitions, units, { processType: "transfer", supervisoryOrgUnitId: 3, effectiveDate: "2026-07-01" });
  assert.equal(first?.code, "child");
  assert.equal(later?.code, "child-later");
});

test("scopes outside the supervisory lineage cannot hijack approval routing", () => {
  const other = { ...definitions[2], supervisoryOrgUnitId: 4, code: "incorrect" };
  const rule = chooseHcmBusinessProcessDefinition([definitions[0], other], units, { processType: "transfer", supervisoryOrgUnitId: 3, effectiveDate: "2026-10-08" });
  assert.equal(rule?.code, "default");
});

test("cycles in supervisory hierarchy fail closed", () => {
  assert.throws(() => supervisoryOrgPath(1, [
    { id: 1, parentId: 2, type: "supervisory" },
    { id: 2, parentId: 1, type: "supervisory" },
  ]), /cycle/);
});

test("steps reject unbounded and invalid approval routing", () => {
  assert.equal(validateHcmBusinessProcessSteps([]), null);
  assert.equal(validateHcmBusinessProcessSteps(Array.from({length:13},() => ({type:"approval",label:"Test",assignee:"role:hr"}))), null);
  assert.equal(validateHcmBusinessProcessSteps([{type:"approval",label:"Review",assignee:"",dueDays:3}]), null);
  assert.equal(validateHcmBusinessProcessSteps([{type:"approve_payroll",label:"Review",assignee:"role:hr"}]), null);
  assert.equal(validateHcmBusinessProcessSteps([{type:"approval",label:"Review",assignee:"role:hr",dueDays:-1}]), null);
  assert.equal(validateHcmBusinessProcessSteps([{type:"approval",label:"Review",assignee:"role:hr",dueDays:3}])?.[0].assignee,"role:hr");
});

test("movement types map to explicit HCM business-process families", () => {
  assert.equal(processTypeForMovement("promotion"),"promotion");
  assert.equal(processTypeForMovement("transfer"),"transfer");
  assert.equal(processTypeForMovement("legal_employer_change"),"transfer");
  assert.equal(processTypeForMovement("job_change"),"change_job");
});
