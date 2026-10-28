/**
 * Fail-closed, source-independent HTTP contract for Employee Self-Service documents GET.
 * This is evidence only; it does not assign method-level tenant coverage credits.
 */
import assert from "node:assert/strict";

const sorted = (xs) => [...xs].sort((a, b) => a - b);

export function assertEssDocumentView(response, expected) {
  assert.equal(response.status, 200, "genuine employee read must return HTTP 200");
  const data = response.json;
  assert.ok(data && typeof data === "object" && !Array.isArray(data), "documents GET must return JSON");
  assert.deepEqual(data.employee, expected.employee, "employee identity must come from the signed-in worker");

  assert.ok(Array.isArray(data.policies), "policy assignments must be an array");
  assert.deepEqual(sorted(data.policies.map((p) => p.assignmentId)),
    sorted(expected.policies.map((p) => p.assignmentId)),
    "exactly the owned employee's real policy assignments must appear");
  for (const expectedPolicy of expected.policies) {
    const actual = data.policies.find((p) => p.assignmentId === expectedPolicy.assignmentId);
    for (const field of ["policyId", "policyCode", "content", "status", "policyStatus"]) {
      assert.equal(actual?.[field], expectedPolicy[field],
        "policy " + expectedPolicy.assignmentId + " must match own persisted " + field);
    }
  }

  assert.ok(Array.isArray(data.documentRequirements), "document requirements must be an array");
  assert.deepEqual(sorted(data.documentRequirements.map((p) => p.complianceId)),
    sorted(expected.documents.map((p) => p.complianceId)),
    "only persisted own compliance rows may be returned");
  for (const expectedDoc of expected.documents) {
    const actual = data.documentRequirements.find((p) => p.complianceId === expectedDoc.complianceId);
    for (const field of ["requirementId", "code", "name", "status", "documentId", "fileName"]) {
      assert.equal(actual?.[field] ?? null, expectedDoc[field] ?? null,
        "compliance " + expectedDoc.complianceId + " must match own " + field);
    }
    for (const secret of ["content", "sourceKey", "objectStorageKey", "sha256"]) {
      assert.ok(!Object.hasOwn(actual, secret), "document metadata must not include " + secret);
    }
  }

  assert.equal(data.summary?.acknowledgementRequired,
    expected.policies.filter((p) => p.status === "assigned").length,
    "acknowledgement count must agree with owned assignments");
  assert.equal(data.summary?.submittedDocuments,
    expected.documents.filter((p) => p.status === "submitted").length,
    "submitted count must agree with owned compliance");
  for (const forbidden of expected.forbiddenValues ?? []) {
    assert.ok(forbidden, "negative control requires a real forbidden marker");
    assert.ok(!response.text.includes(forbidden),
      "foreign-employer or coworker document/policy marker disclosed");
  }
  assert.ok(!/\bpublic\b/i.test(response.headers?.get("cache-control") ?? ""),
    "sensitive employee document response must not declare public caching");
}

export function assertEssDocumentDenial(response, status, forbiddenValues = []) {
  assert.equal(response.status, status, "denial must use the expected HTTP status");
  for (const value of forbiddenValues) {
    assert.ok(value && !response.text.includes(value), "denial body exposed another employer's document");
    assert.ok(![...(response.headers ?? [])].some(([k, v]) => (k + ": " + v).includes(value)),
      "denial header exposed another employer's document");
  }
}
