import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { documents, employees, organizations } from "../src/db/schema";
import { documentObjectKey } from "../src/lib/document-object-storage";
import {
  COE_PENDING_SOURCE_PREFIX, reconcilePendingCoeDocument,
  sweepPendingCoeObjects,
} from "../src/lib/hr-case-coe-object-reconciliation";

test("COE reconciliation retains a failed storage delete and the leased sweep safely retries", async () => {
  const suffix = randomUUID().slice(0, 12);
  const [org] = await db.insert(organizations).values({
    name: "COE recovery QA " + suffix, legalName: "COE recovery QA " + suffix,
  }).returning();
  const beforeHr = process.env.EMPLOYEE_HR_CASES_ENABLED;
  const beforeVault = process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED;
  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: "QA-" + suffix,
      firstName: "Synthetic", lastName: "Employee", title: "Associate",
      avatarInitials: "SE", basicRate: "25000.00", startDate: "2026-01-01",
    }).returning();
    const key = documentObjectKey(org.id, employee.id);
    const pendingKey = COE_PENDING_SOURCE_PREFIX + randomUUID();
    const [pending] = await db.insert(documents).values({
      organizationId: org.id, employeeId: employee.id, kind: "coe",
      fileName: "synthetic-coe.txt", mimeType: "text/plain", byteSize: 12,
      sha256: "a".repeat(64), scannedClean: false,
      sourceType: "generated", sourceKey: pendingKey,
      uploadedBy: "Synthetic approver", objectStorageKey: key, content: "",
      createdAt: new Date("2026-10-10T00:00:00Z"),
    }).returning();
    assert.equal((await reconcilePendingCoeDocument(pending.id, {
      deleteObject: async () => { throw new Error("simulated external timeout"); },
    })), "delete_failed");
    const [remains] = await db.select().from(documents).where(eq(documents.id, pending.id));
    assert.equal(remains.objectStorageKey, key);
    assert.equal(remains.scannedClean, false);
    // Cleanup continues even if the HR/vault rollout is immediately switched OFF.
    process.env.EMPLOYEE_HR_CASES_ENABLED = "false";
    process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED = "false";
    const called: string[] = [];
    const sweep = await sweepPendingCoeObjects(new Date("2026-10-12T00:00:00Z"), 50,
      async (objectKey) => { called.push(objectKey); });
    assert.equal(sweep.deleted, 1);
    assert.deepEqual(called, [key]);
    assert.deepEqual((await db.select().from(documents).where(eq(documents.id, pending.id))), []);
    assert.equal((await reconcilePendingCoeDocument(pending.id, {
      deleteObject: async () => { throw new Error("must not be called on missing"); },
    })), "missing");
  } finally {
    if (beforeHr === undefined) delete process.env.EMPLOYEE_HR_CASES_ENABLED;
    else process.env.EMPLOYEE_HR_CASES_ENABLED = beforeHr;
    if (beforeVault === undefined) delete process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED;
    else process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED = beforeVault;
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("pending COE recovery cannot delete a document already approved, wrongly scoped, or recent", async () => {
  const suffix = randomUUID().slice(0, 12);
  const [org] = await db.insert(organizations).values({
    name: "COE retention QA " + suffix, legalName: "COE retention QA " + suffix,
  }).returning();
  try {
    const [worker] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: "QA-" + suffix,
      firstName: "Synthetic", lastName: "Worker", title: "Clerk",
      avatarInitials: "SW", basicRate: "21000.00", startDate: "2026-01-01",
    }).returning();
    const [pending] = await db.insert(documents).values({
      organizationId: org.id, employeeId: worker.id, kind: "coe",
      fileName: "synthetic.pdf", mimeType: "application/pdf", byteSize: 1,
      sha256: "b".repeat(64), scannedClean: false,
      sourceType: "generated", sourceKey: COE_PENDING_SOURCE_PREFIX + randomUUID(),
      uploadedBy: "Synthetic HR", objectStorageKey: documentObjectKey(org.id, worker.id),
      content: "", createdAt: new Date("2026-10-12T00:00:00Z"),
    }).returning();
    const now = new Date("2026-10-12T00:00:01Z");
    assert.equal(await reconcilePendingCoeDocument(pending.id, {
      now, minAgeMs: 60_000, deleteObject: async () => { throw new Error("not eligible"); },
    }), "referenced");
    await db.update(documents).set({ scannedClean: true, sourceKey: "hr-case-coe:99999" })
      .where(eq(documents.id, pending.id));
    assert.equal(await reconcilePendingCoeDocument(pending.id, {
      deleteObject: async () => { throw new Error("must not delete signed-off COE"); },
    }), "referenced");
    const [wrong] = await db.insert(documents).values({
      organizationId: org.id, employeeId: worker.id, kind: "coe",
      fileName: "wrong-scope.txt", mimeType: "text/plain", byteSize: 1,
      sha256: "c".repeat(64), scannedClean: false,
      sourceType: "generated", sourceKey: COE_PENDING_SOURCE_PREFIX + randomUUID(),
      uploadedBy: "Synthetic HR", objectStorageKey: documentObjectKey(org.id + 100, worker.id),
      content: "", createdAt: new Date("2026-10-10T00:00:00Z"),
    }).returning();
    assert.equal(await reconcilePendingCoeDocument(wrong.id, {
      deleteObject: async () => { throw new Error("wrong employer key must not be deleted"); },
    }), "invalid_identity");
    const unchanged = await db.select().from(documents).where(eq(documents.id, wrong.id));
    assert.equal(unchanged.length, 1);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
