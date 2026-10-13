import assert from "node:assert/strict";
import test from "node:test";
import { getTableColumns } from "drizzle-orm";
import { documents } from "../src/db/schema";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import { documentObjectIdentityMatches, documentBytesMayBeReleased } from "../src/lib/employee-document-vault";

test("A-3 COE and A-5 vault share one canonical documents identity contract", () => {
  const columns = getTableColumns(documents);
  assert.equal(columns.objectStorageKey.name, "object_storage_key");
  assert.equal(columns.uploadedByUserId.name, "uploaded_by_user_id");
  assert.equal(Object.hasOwn(columns, "storageKey"), false,
    "superseded documents.storage_key must never be restored");
  const key = "private-documents/7/23/00000000-0000-4000-8000-000000000001";
  assert.equal(documentObjectIdentityMatches(key, 7, 23), true);
  assert.equal(documentObjectIdentityMatches(key, 8, 23), false);
  assert.equal(documentObjectIdentityMatches(key, 7, 24), false);
  assert.equal(documentObjectIdentityMatches(key, 7, null), false);
});

test("COE cannot be issued or revealed when HR/vault gates are OFF", () => {
  for (const flag of ["employeeHrCases", "employeeDocumentVault"] as const) {
    assert.equal(criticalReleaseFlagEnabled(flag, {}), false);
  }
  assert.equal(documentBytesMayBeReleased({
    scannedClean: false, isProduction: false, vaultEnabled: false, hasPrivateObject: true,
  }), false, "pending object must remain unreadable even after rollback");
});
