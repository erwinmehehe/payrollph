import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { auditEvents, documents, employees, organizations } from "../src/db/schema";
import { documentObjectKey } from "../src/lib/document-object-storage";
import {
  VAULT_PENDING_SOURCE_PREFIX, VAULT_ORPHAN_GRACE_MS,
  reconcilePendingVaultUpload, sweepPendingVaultUploads,
} from "../src/lib/employee-vault-object-reconciliation";

function pendingFields(organizationId: number, employeeId: number,
  overrides: Record<string, unknown> = {}) {
  return {
    organizationId, employeeId, kind: "contract",
    fileName: "synthetic-201-file.pdf", mimeType: "application/pdf",
    byteSize: 12, sha256: "a".repeat(64), scannedClean: false,
    sourceType: "upload" as const,
    sourceKey: VAULT_PENDING_SOURCE_PREFIX + randomUUID(),
    scanNote: "Pending verified private storage",
    uploadedBy: "Synthetic file owner", content: "",
    objectStorageKey: documentObjectKey(organizationId, employeeId),
    createdAt: new Date("2026-10-10T00:00:00Z"),
    ...overrides,
  };
}

test("failed private DELETE retains unreadable intent and scheduler retries with rollout OFF", async () => {
  const suffix = randomUUID().slice(0, 12);
  const [org] = await db.insert(organizations).values({
    name: "Vault recovery QA " + suffix, legalName: "Vault recovery QA " + suffix,
  }).returning();
  const before = process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED;
  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: "VAULT-" + suffix,
      firstName: "Synthetic", lastName: "Vault",
      title: "Analyst", avatarInitials: "SV",
      basicRate: "22000.00", startDate: "2026-01-01",
    }).returning();
    const [pending] = await db.insert(documents).values(
      pendingFields(org.id, employee.id),
    ).returning();
    const failed = await reconcilePendingVaultUpload(pending.id, {
      deleteObject: async () => { throw new Error("simulated private storage outage"); },
    });
    assert.equal(failed, "delete_failed");
    const [retained] = await db.select().from(documents).where(eq(documents.id, pending.id));
    assert.ok(retained, "failed external DELETE must not destroy recovery evidence");
    assert.equal(retained.scannedClean, false);
    assert.ok(retained.sourceKey?.startsWith(VAULT_PENDING_SOURCE_PREFIX));
    assert.equal(retained.content, "", "no base64 document bytes stored in the intent");

    process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED = "false";
    const deleted: string[] = [];
    const sweep = await sweepPendingVaultUploads(
      new Date("2026-10-12T00:00:00Z"), 50,
      async key => { deleted.push(key); },
    );
    assert.equal(sweep.enabled, true);
    assert.ok(sweep.deleted >= 1);
    assert.deepEqual(deleted.filter(key => key === retained.objectStorageKey),
      [retained.objectStorageKey]);
    assert.deepEqual(await db.select().from(documents).where(eq(documents.id, pending.id)), []);
    assert.equal(await reconcilePendingVaultUpload(pending.id, {
      deleteObject: async () => { throw new Error("do not retry missing"); },
    }), "missing");
    const audit = await db.select().from(auditEvents).where(eq(
      auditEvents.organizationId, org.id,
    ));
    assert.ok(audit.some(row => row.action === "Uncommitted private vault object reconciled"),
      "cleanup must leave minimal durable audit receipt");
  } finally {
    if (before === undefined) delete process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED;
    else process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED = before;
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("pending objects cannot be erased while young, signed-off, or mismatched to employer", async () => {
  const suffix = randomUUID().slice(0, 12);
  const [org] = await db.insert(organizations).values({
    name: "Vault scope QA " + suffix, legalName: "Vault scope QA " + suffix,
  }).returning();
  try {
    const [worker] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: "SCOPE-" + suffix,
      firstName: "Scoped", lastName: "Worker",
      title: "Associate", avatarInitials: "SW",
      basicRate: "22000.00", startDate: "2026-01-01",
    }).returning();
    const [pending] = await db.insert(documents).values(
      pendingFields(org.id, worker.id, { createdAt: new Date("2026-10-12T00:00:00Z") }),
    ).returning();
    assert.equal(await reconcilePendingVaultUpload(pending.id, {
      now: new Date("2026-10-12T00:01:00Z"), minAgeMs: VAULT_ORPHAN_GRACE_MS,
      deleteObject: async () => { throw new Error("too young to delete"); },
    }), "too_recent");

    await db.update(documents).set({
      scannedClean: true, sourceKey: null,
    }).where(eq(documents.id, pending.id));
    assert.equal(await reconcilePendingVaultUpload(pending.id, {
      deleteObject: async () => { throw new Error("signed-off file must be retained"); },
    }), "referenced");

    const [badScope] = await db.insert(documents).values(
      pendingFields(org.id, worker.id, {
        objectStorageKey: documentObjectKey(org.id + 500, worker.id),
      }),
    ).returning();
    assert.equal(await reconcilePendingVaultUpload(badScope.id, {
      deleteObject: async () => { throw new Error("wrong employer key must not be used"); },
    }), "invalid_identity");
    assert.equal((await db.select().from(documents).where(eq(documents.id, badScope.id))).length, 1);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("private vault PUT is preceded by durable intent; only verified rows become visible", () => {
  const upload = readFileSync("src/app/api/documents/route.ts", "utf8");
  const recover = readFileSync("src/lib/data-retention.ts", "utf8");
  const download = readFileSync("src/app/api/documents/[id]/route.ts", "utf8");
  const staged = upload.indexOf("pendingDocumentId = await db.transaction(async tx => {");
  const sent = upload.indexOf("await putDocumentObject(storageKey, bytes, check.mime)", staged);
  const verified = upload.indexOf("await verifyStoredDocumentObject(storageKey, hash, bytes.byteLength)", sent);
  const finalized = upload.indexOf("await tx.update(documents).set({", verified);
  assert.ok(staged >= 0 && staged < sent && sent < verified && verified < finalized);
  assert.match(upload, /scannedClean: false, scanNote: "Pending verified private storage"/);
  assert.match(upload, /scannedClean: true, scanNote: scan.note, sourceKey: null/);
  assert.match(upload, /notLike\(documents.sourceKey, VAULT_PENDING_SOURCE_PREFIX/);
  assert.match(download, /documentBytesMayBeReleased/);
  assert.match(recover, /await sweepPendingVaultUploads\(new Date\(now\)\)/);
  assert.doesNotMatch(upload, /await deleteDocumentObject\(storageKey\)\.catch\(\(\) => \{\}\)/);
});
