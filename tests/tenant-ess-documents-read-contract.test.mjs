import test from "node:test";
import assert from "node:assert/strict";
import { assertEssDocumentDenial, assertEssDocumentView } from "../scripts/qa/tenant-ess-documents-read-contract.mjs";

const expected = {
  employee: { id: 13, employeeNo: "SYNTH-ATTA", name: "Synthetic Attacker A" },
  policies: [{
    assignmentId: 25, policyId: 24, policyCode: "OWN-POLICY",
    content: "OWN-PUBLISHED-POLICY", status: "assigned", policyStatus: "published",
  }],
  documents: [
    { complianceId: 30, requirementId: 20, code: "REQ-OWN", name: "Own requirement",
      status: "submitted", documentId: 40, fileName: "own.pdf" },
    { complianceId: 31, requirementId: 21, code: "REQ-MISMATCH", name: "Own missing",
      status: "missing", documentId: null, fileName: null },
  ],
  forbiddenValues: ["VICTIM-SECRET", "COWORKER-SECRET"],
};

function view(changes = {}) {
  const data = {
    employee: { ...expected.employee },
    policies: expected.policies.map((p) => ({ ...p })),
    documentRequirements: expected.documents.map((d) => ({ ...d })),
    summary: { acknowledgementRequired: 1, submittedDocuments: 1 },
  };
  if (changes.modify) changes.modify(data);
  return {
    status: changes.status ?? 200,
    json: data,
    text: JSON.stringify(data) + (changes.appendText ?? ""),
    headers: new Headers(changes.headers ?? {}),
  };
}
function mustReject(modify, reason) {
  assert.throws(() => assertEssDocumentView(view({ modify }), expected), reason);
}

test("populated session-owned policy and document compliance must pass", () => {
  assert.doesNotThrow(() => assertEssDocumentView(view(), expected));
});
test("empty policy 200 cannot masquerade as positive proof", () => {
  mustReject((d) => { d.policies = []; }, /real policy assignments/);
});
test("a wrong employee ID cannot inherit the own positive contract", () => {
  mustReject((d) => { d.employee.id = 99; }, /signed-in worker/);
});
test("foreign employee policy row is never accepted even beside own policy", () => {
  mustReject((d) => { d.policies.push({ ...d.policies[0], assignmentId: 150 }); },
    /real policy assignments/);
});
test("substituted foreign policy content is rejected", () => {
  mustReject((d) => { d.policies[0].content = "FOREIGN-TENANT-POLICY"; }, /own persisted content/);
});
test("foreign or coworker compliance row is rejected", () => {
  mustReject((d) => { d.documentRequirements.push({
    ...d.documentRequirements[0], complianceId: 152,
  }); }, /own compliance rows/);
});
test("wrong-tenant document ID joined to own compliance fails", () => {
  mustReject((d) => { d.documentRequirements[1].documentId = 999; },
    /own documentId/);
});
test("same-employer coworker filename joined to own compliance fails", () => {
  mustReject((d) => { d.documentRequirements[1].fileName = "COWORKER-SECRET"; },
    /own fileName/);
});
test("sensitive stored document bytes or object keys may not appear in response", () => {
  mustReject((d) => { d.documentRequirements[0].sourceKey = "secrets/key"; },
    /must not include sourceKey/);
});
test("victim marker in any body field rejects otherwise correct data", () => {
  assert.throws(() => assertEssDocumentView(view({ appendText: "VICTIM-SECRET" }), expected),
    /document\/policy marker disclosed/);
});
test("summary cannot report another employee's submitted records", () => {
  mustReject((d) => { d.summary.submittedDocuments = 5; }, /submitted count/);
});
test("cache policy must not permit shared public caches", () => {
  assert.throws(() => assertEssDocumentView(view({
    headers: { "cache-control": "public, max-age=300" },
  }), expected), /public caching/);
});
test("non-success response is never a positive read", () => {
  assert.throws(() => assertEssDocumentView(view({ status: 403 }), expected), /HTTP 200/);
});
test("correct 403 denial without victim details passes", () => {
  assert.doesNotThrow(() => assertEssDocumentDenial({
    status: 403, text: '{"error":"Forbidden."}', headers: new Headers(),
  }, 403, ["VICTIM-SECRET"]));
});
test("foreign read 200 cannot pass denial contract", () => {
  assert.throws(() => assertEssDocumentDenial({
    status: 200, text: "{}", headers: new Headers(),
  }, 403, ["VICTIM-SECRET"]), /expected HTTP status/);
});
test("victim policy leaked through denial body is rejected", () => {
  assert.throws(() => assertEssDocumentDenial({
    status: 403, text: "VICTIM-SECRET", headers: new Headers(),
  }, 403, ["VICTIM-SECRET"]), /denial body/);
});
test("victim filename leaked through denial headers is rejected", () => {
  assert.throws(() => assertEssDocumentDenial({
    status: 403, text: "{}", headers: new Headers({ "x-file-name": "VICTIM-SECRET" }),
  }, 403, ["VICTIM-SECRET"]), /denial header/);
});
