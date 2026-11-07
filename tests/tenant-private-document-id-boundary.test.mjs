import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const predicatePath = "src/lib/private-document-tenant-lookup.ts";
const downloadPath = "src/app/api/documents/[id]/route.ts";
const removalPath = "src/app/api/employee-vault/[id]/route.ts";

// Source-contract tests only. A disposable-PG16, signed-in, real-HTTP
// isolation proof and final-head security review are still required.
function assertMembershipPrefilter(source) {
  for (const fragment of [
    "eq(documents.id, documentId)",
    "exists(",
    "db.select({ id: userOrganizations.id }).from(userOrganizations)",
    "eq(userOrganizations.userId, userId)",
    "eq(userOrganizations.organizationId, documents.organizationId)",
    "eq(userOrganizations.active, true)",
    'ne(userOrganizations.role, "group_hr")',
  ]) {
    assert.ok(source.includes(fragment), "missing tenant-bound predicate: " + fragment);
  }
  assert.ok(source.indexOf("eq(documents.id, documentId)") <
    source.indexOf("exists("), "document ID and active membership must form one SQL predicate");
}

test("document ID predicate requires the same active employer membership and excludes group HR", () => {
  assertMembershipPrefilter(read(predicatePath));
});

test("predicate regression guard rejects absent, inactive, forged and group-HR-only membership", () => {
  const original = read(predicatePath);
  const fragments = [
    "eq(documents.id, documentId)",
    "exists(",
    "db.select({ id: userOrganizations.id }).from(userOrganizations)",
    "eq(userOrganizations.userId, userId)",
    "eq(userOrganizations.organizationId, documents.organizationId)",
    "eq(userOrganizations.active, true)",
    'ne(userOrganizations.role, "group_hr")',
  ];
  for (const fragment of fragments) {
    assert.ok(original.includes(fragment), "test fixture missing " + fragment);
    assert.throws(() => assertMembershipPrefilter(original.replace(fragment, "REMOVED")),
      /missing tenant-bound predicate|document ID and active membership/,
      "must reject removal of " + fragment);
  }
});

test("document download has signed-in positive-ID validation and scopes lookup before role or byte access", () => {
  const source = read(downloadPath);
  const signedIn = source.indexOf("const user = await getSessionUser()");
  const idValidation = source.indexOf("Number.isSafeInteger(documentId) || documentId <= 0");
  const scopedLookup = source.indexOf(".where(documentVisibleToActiveMember(user.id, documentId)).limit(1)");
  const roleGate = source.indexOf("if (user.role === \"employee\")");
  const storage = source.indexOf("if (document.objectStorageKey)");
  assert.ok(signedIn >= 0 && idValidation > signedIn &&
    scopedLookup > idValidation && roleGate > scopedLookup && storage > roleGate);
  assert.doesNotMatch(source, /\.where\(eq\(documents\.id,\s*documentId\)\)/,
    "never retrieve an unscoped document by path ID");
  assert.match(source, /if \(!document \|\| vaultRecordRemoved\(document.sourceKey\)\) return Response\.json\(\{ error: "Document not found\." \}, \{ status: 404 \}\)/);
  for (const guard of [
    "assertMembership(user.id, document.organizationId)",
    "assertOrganizationRole(",
    "assertScope(access, employee.orgUnitId)",
    "documentBytesMayBeReleased(",
    "documentObjectIdentityMatches(",
  ]) assert.ok(source.includes(guard), "preserve download authorization: " + guard);
});

test("vault removal scopes document lookup before employee authorization and preserves mutation safeguards", () => {
  const source = read(removalPath);
  const signedIn = source.indexOf("const user = await getSessionUser()");
  const scopedLookup = source.indexOf(".where(documentVisibleToActiveMember(user.id, documentId)).limit(1)");
  const vaultAuth = source.indexOf("const authorized = await authorizeEmployeeVault(");
  const remove = source.indexOf("const result = await removeEmployeeVaultDocument(");
  assert.ok(signedIn >= 0 && scopedLookup > signedIn &&
    vaultAuth > scopedLookup && remove > vaultAuth);
  assert.doesNotMatch(source, /\.where\(eq\(documents\.id,\s*documentId\)\)/);
  assert.match(source, /if \(!row \|\| row.employeeId === null\) \{/);
  assert.ok(source.includes('{ error: "Document not found." }, { status: 404, headers }'),
    "foreign and absent IDs must have the same not-found response");
  for (const guard of [
    "enforceSameOriginMutation(request)",
    "employeeVaultCanRemove(",
    "enforceSensitiveActionRateLimit(",
    "requireSensitiveActionMfa(user)",
    "organizationId: row.organizationId, employeeId: row.employeeId",
  ]) assert.ok(source.includes(guard), "preserve removal authorization: " + guard);
});
