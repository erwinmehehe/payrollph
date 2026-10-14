import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { spendIsolatedDatabase } from "./helpers/spend-isolated-database";
import { documents, employees, organizations } from "../src/db/schema";

test("failed Spend receipt DELETE preserves unreadable intent and flag-off sweep recovers it", async () => {
  const fixture = await spendIsolatedDatabase();
  // Import only after the generated local DB is bound; no live DB or network.
  const { SPEND_PENDING_RECEIPT_PREFIX, reconcilePendingSpendReceipt,
    sweepPendingSpendReceipts } = await import("../src/lib/spend-receipt-object-reconciliation");
  const { db } = fixture;
  const prior = process.env.SPEND_PAYROLL_REIMBURSEMENTS_ENABLED;
  try {
    const [org] = await db.insert(organizations).values({
      name: "Synthetic Spend orphan", legalName: "Synthetic Spend orphan",
    }).returning();
    const [staff] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: "SPEND-ORPHAN",
      firstName: "Synthetic", lastName: "Employee", title: "Tester",
      avatarInitials: "SE", basicRate: "26000", startDate: "2026-01-01",
    }).returning();
    const key = "private-documents/" + org.id + "/" + staff.id + "/" + randomUUID();
    const [pending] = await db.insert(documents).values({
      organizationId: org.id, employeeId: staff.id,
      kind: "expense_receipt", fileName: "Pending private reimbursement receipt",
      mimeType: "application/pdf", byteSize: 10, sha256: "a".repeat(64),
      scannedClean: false, sourceType: "upload",
      sourceKey: SPEND_PENDING_RECEIPT_PREFIX + randomUUID(),
      uploadedBy: "Fictional claimant", content: "",
      objectStorageKey: key,
      createdAt: new Date("2026-10-10T00:00:00Z"),
    }).returning();

    assert.equal(await reconcilePendingSpendReceipt(pending.id, {
      deleteObject: async () => { throw new Error("synthetic provider DELETE failed"); },
    }), "delete_failed");
    const [retained] = await db.select().from(documents).where(eq(documents.id, pending.id));
    assert.equal(retained.scannedClean, false);
    assert.equal(retained.content, "");
    assert.equal(retained.objectStorageKey, key);
    process.env.SPEND_PAYROLL_REIMBURSEMENTS_ENABLED = "false";

    const deleted: string[] = [];
    const result = await sweepPendingSpendReceipts(
      new Date("2026-10-12T00:00:00Z"), 50, async item => { deleted.push(item); });
    assert.equal(result.enabled, true);
    assert.equal(result.deleted, 1);
    assert.deepEqual(deleted, [key]);
    assert.deepEqual(await db.select().from(documents).where(eq(documents.id, pending.id)), []);
    assert.equal(await reconcilePendingSpendReceipt(pending.id, {
      deleteObject: async () => { throw new Error("already removed"); },
    }), "missing");
  } finally {
    if (prior === undefined) delete process.env.SPEND_PAYROLL_REIMBURSEMENTS_ENABLED;
    else process.env.SPEND_PAYROLL_REIMBURSEMENTS_ENABLED = prior;
    await fixture.close();
  }
});

test("Spend orphan reconciliation refuses fresh, signed-off, or wrong-employee object", async () => {
  const fixture = await spendIsolatedDatabase();
  const { SPEND_PENDING_RECEIPT_PREFIX, SPEND_PENDING_RECEIPT_GRACE_MS,
    reconcilePendingSpendReceipt } = await import("../src/lib/spend-receipt-object-reconciliation");
  const { db } = fixture;
  try {
    const [org] = await db.insert(organizations).values({
      name: "Synthetic Spend scope", legalName: "Synthetic Spend scope",
    }).returning();
    const [staff] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: "SPEND-SCOPE",
      firstName: "Synthetic", lastName: "Reviewer", title: "Tester",
      avatarInitials: "SR", basicRate: "26000", startDate: "2026-01-01",
    }).returning();
    const [recent] = await db.insert(documents).values({
      organizationId: org.id, employeeId: staff.id,
      kind: "expense_receipt", fileName: "Pending",
      mimeType: "application/pdf", byteSize: 1, sha256: "b".repeat(64),
      scannedClean: false, sourceType: "upload",
      sourceKey: SPEND_PENDING_RECEIPT_PREFIX + randomUUID(),
      uploadedBy: "Fictional claimant", content: "",
      objectStorageKey: "private-documents/" + org.id + "/" + staff.id + "/" + randomUUID(),
      createdAt: new Date("2026-10-12T00:00:00Z"),
    }).returning();
    assert.equal(await reconcilePendingSpendReceipt(recent.id, {
      now: new Date("2026-10-12T00:05:00Z"), minAgeMs: SPEND_PENDING_RECEIPT_GRACE_MS,
      deleteObject: async () => { throw new Error("do not delete fresh upload"); },
    }), "too_recent");
    await db.update(documents).set({ scannedClean: true, sourceKey: null })
      .where(eq(documents.id, recent.id));
    assert.equal(await reconcilePendingSpendReceipt(recent.id, {
      deleteObject: async () => { throw new Error("do not delete approved file"); },
    }), "referenced");
    const [wrong] = await db.insert(documents).values({
      organizationId: org.id, employeeId: staff.id,
      kind: "expense_receipt", fileName: "Pending",
      mimeType: "application/pdf", byteSize: 1, sha256: "c".repeat(64),
      scannedClean: false, sourceType: "upload",
      sourceKey: SPEND_PENDING_RECEIPT_PREFIX + randomUUID(),
      uploadedBy: "Fictional claimant", content: "",
      objectStorageKey: "private-documents/" + (org.id + 10) + "/" + staff.id + "/" + randomUUID(),
      createdAt: new Date("2026-10-10T00:00:00Z"),
    }).returning();
    assert.equal(await reconcilePendingSpendReceipt(wrong.id, {
      deleteObject: async () => { throw new Error("wrong tenant object"); },
    }), "invalid_identity");
    assert.equal((await db.select().from(documents).where(eq(documents.id, wrong.id))).length, 1);
  } finally { await fixture.close(); }
});

test("Spend route commits pending intent before remote PUT and blocks unknown receipt downloads", () => {
  const src = readFileSync("src/app/api/expenses/receipts/route.ts", "utf8");
  const cleanup = readFileSync("src/lib/data-retention.ts", "utf8");
  const reserved = src.indexOf("pendingDocumentId = await db.transaction(async tx => {");
  const uploaded = src.indexOf("await putDocumentObject(key, bytes, parsed.mime)", reserved);
  const authenticated = src.indexOf("await readVerifiedSpendReceipt({ key,", uploaded);
  const settled = src.indexOf("await tx.update(expenseClaimEvidence).set({", authenticated);
  assert.ok(reserved >= 0 && reserved < uploaded && uploaded < authenticated && authenticated < settled);
  assert.match(src, /scannedClean: false, scanNote: "Pending private reimbursement/);
  assert.match(src, /await reconcilePendingSpendReceipt\(pendingDocumentId\)/);
  assert.match(cleanup, /await sweepPendingSpendReceipts\(new Date\(now\)\)/);
  assert.doesNotMatch(src, /await deleteDocumentObject\(key\)\.catch\(\(\) => \{\}\)/);
});
