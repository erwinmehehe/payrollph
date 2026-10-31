import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/documents/route.ts", "utf8");
const post = route.split("export async function POST")[1];
const legacy = post.slice(post.indexOf("// Legacy database-backed document"));

test("POST legacy document, compliance and audit are a single transaction", () => {
  assert.ok(legacy.includes("const result = await db.transaction(async (tx) => {"));
  assert.ok(legacy.includes("tx.insert(legacyDocumentInsertTable)"));
  assert.ok(legacy.includes("tx.update(hcmEmployeeDocumentCompliance)"));
  assert.ok(legacy.includes("await recordAuditEvent({"));
  assert.ok(legacy.includes("}, tx);"));
  assert.ok(legacy.includes("}).catch(() => null)"));
  assert.ok(legacy.includes("if (!result) return Response.json("));
  assert.ok(!legacy.includes("db.insert(legacyDocumentInsertTable)"));
});

test("POST legacy compliance update rechecks employer, employee and requirement at the final write", () => {
  for (const token of [
    "eq(hcmEmployeeDocumentCompliance.id, complianceRow.id)",
    "eq(hcmEmployeeDocumentCompliance.organizationId, organizationId)",
    "eq(hcmEmployeeDocumentCompliance.employeeId, complianceRow.employeeId)",
    "eq(hcmEmployeeDocumentCompliance.requirementId, requirement.id)",
    'if (!compliance) throw new Error("DOCUMENT_COMPLIANCE_SCOPE_CHANGED")',
  ]) assert.ok(legacy.includes(token), "Missing final tenant write guard: " + token);
});

test("Document POST keeps auth, upload policy and private-vault boundaries", () => {
  for (const token of [
    "enforceSameOriginMutation(request)", "getSessionUser()",
    "documentUploadsEnabled()", "assertMembership(user.id, organizationId)",
    "assertOrganizationRole(", "assertScope(access, employee.orgUnitId)",
    "canMutateLegacyHcmDocument(", "scanUpload(bytes",
  ]) assert.ok(post.includes(token), "Missing document boundary: " + token);
});
