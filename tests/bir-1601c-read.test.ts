import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { parseBir1601cRead } from "../src/lib/bir-1601c-read";

const valid = () => ({
  organizationId: 17,
  today: "2026-10-19",
  legalEntity: { id: 88, code: "FICT", displayName: "Fictional payroll entity" },
  batches: [{
    id: 101, organizationId: 17, legalEntityId: 88,
    applicableMonth: "2026-09", filingChannel: "non_efps", efpsGroup: null,
    filingDueDate: "2026-10-10", paymentDueDate: "2026-10-10",
    status: "open", displayStatus: "overdue",
    employeeCount: 4, payrollRunCount: 2,
    expectedTaxWithheld: "1140.25", amountPaid: null,
    paymentReference: null, filingReference: null,
    filingCheck: { state: "missing", matched: false,
      message: "Not yet filed", filing: null, comparison: null },
  }],
});

test("verified empty BIR list is distinct from unverified success", () => {
  const response = valid();
  assert.equal(parseBir1601cRead(response, 17)?.length, 1);
  response.batches = [];
  assert.deepEqual(parseBir1601cRead(response, 17), []);
  assert.equal(parseBir1601cRead({}, 17), null);
  assert.equal(parseBir1601cRead({ ...response, batches: undefined }, 17), null);
});

test("wrong employer, wrong legal entity, duplicate IDs, and malformed rows fail closed", () => {
  const correct = valid();
  assert.equal(parseBir1601cRead(correct, 18), null);
  assert.equal(parseBir1601cRead({ ...correct, organizationId: 18 }, 17), null);
  assert.equal(parseBir1601cRead({ ...correct, batches: [{ ...correct.batches[0], organizationId: 18 }] }, 17), null);
  assert.equal(parseBir1601cRead({ ...correct, batches: [{ ...correct.batches[0], legalEntityId: 89 }] }, 17), null);
  assert.equal(parseBir1601cRead({ ...correct, batches: [{ ...correct.batches[0], payrollRunCount: -1 }] }, 17), null);
  assert.equal(parseBir1601cRead({ ...correct, batches: [{ ...correct.batches[0], expectedTaxWithheld: "NaN" }] }, 17), null);
  assert.equal(parseBir1601cRead({ ...correct, batches: [correct.batches[0], correct.batches[0]] }, 17), null);
});

test("a claimed filing match must contain coherent evidence", () => {
  const baseline = valid();
  assert.equal(parseBir1601cRead({ ...baseline, batches: [{
    ...baseline.batches[0], filingCheck: {
      ...baseline.batches[0].filingCheck, state: "matched", matched: true,
    },
  }] }, 17), null);
  assert.equal(parseBir1601cRead({ ...baseline, batches: [{
    ...baseline.batches[0], filingCheck: {
      ...baseline.batches[0].filingCheck, state: "missing", matched: true,
    },
  }] }, 17), null);
});

test("the UI blocks BIR actions until evidence is verified", () => {
  const ui = readFileSync("src/components/workspace/bir-1601c-remittance-panel.tsx", "utf8");
  assert.match(ui, /if \(readState !== "ready"\)/);
  assert.match(ui, /const verified = parseBir1601cRead\(body, organizationId\)/);
  assert.match(ui, /setReadState\("error"\)/);
  assert.match(ui, /setBatches\(\[\]\)/);
  const api = readFileSync("src/app/api/compliance/bir-1601c-remittances/route.ts", "utf8");
  assert.match(api, /return Response\.json\(\{\s*organizationId,\s*today,/);
});
