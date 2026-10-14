import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  auditEvents, documents, employees, hcmDocumentExpiryNotices,
  hcmDocumentRequirements, hcmEmployeeDocumentCompliance,
  organizations, users,
} from "../src/db/schema";
import { acknowledgeEmployeeVaultExpiryNotice } from "../src/lib/employee-vault-expiry-acknowledgement";

test("A5 HR acknowledgement is tenant-bound, replay-safe and rejects a stale compliance snapshot", async () => {
  const previousFlag = process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED;
  process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED = "true";
  const [actor] = await db.insert(users).values({
    email: "a5-expiry-" + randomUUID() + "@example.invalid",
    name: "Synthetic HR reviewer",
    passwordHash: "unused-synthetic-hash",
    role: "hr",
  }).returning();
  const [org] = await db.insert(organizations).values({
    name: "A5 acknowledgement test",
    legalName: "A5 synthetic employer",
    plan: "Core",
  }).returning();
  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: "A5-ACK",
      firstName: "Synthetic", lastName: "Worker", title: "Associate",
      avatarInitials: "SW", basicRate: "32000.00", startDate: "2026-01-01",
    }).returning();
    const [rule] = await db.insert(hcmDocumentRequirements).values({
      organizationId: org.id, code: "A5-ACK-LICENSE", name: "Synthetic license",
      kind: "professional_license", mandatory: true, expiryRequired: true,
      renewalLeadDays: 30, submissionDueDays: 14,
      createdByName: "Synthetic HR", targetConditions: {},
    }).returning();
    const [file] = await db.insert(documents).values({
      organizationId: org.id, employeeId: employee.id,
      kind: "professional_license", fileName: "synthetic.pdf",
      mimeType: "application/pdf", byteSize: 8,
      sha256: "a".repeat(64), scannedClean: true,
      scanNote: "Synthetic scanned evidence", uploadedBy: "Synthetic worker",
      content: "",
      objectStorageKey: "private-documents/" + org.id + "/" + employee.id +
        "/00000000-0000-4000-8000-000000000001",
    }).returning();
    const [compliance] = await db.insert(hcmEmployeeDocumentCompliance).values({
      organizationId: org.id, requirementId: rule.id, employeeId: employee.id,
      documentId: file.id, status: "current",
      expiresAt: "2026-11-11", verifiedAt: new Date("2026-10-01T00:00:00Z"),
      verifiedByName: "Independent synthetic HR",
    }).returning();
    const notices = await db.insert(hcmDocumentExpiryNotices).values([30, 14, 7].map(milestoneDays => ({
      organizationId: org.id, complianceId: compliance.id,
      employeeId: employee.id, documentId: file.id, expiresOn: "2026-11-11",
      milestoneDays,
    }))).returning();

    const input = {
      organizationId: org.id, actorUserId: actor.id,
      actorName: actor.name,
      canAccessOrgUnit: (_unitId: number | null) => true,
    };
    assert.equal(await acknowledgeEmployeeVaultExpiryNotice({
      ...input, organizationId: org.id + 100000, noticeId: notices[0].id,
    }), "not_found", "a different tenant cannot acknowledge this ID");
    assert.equal(await acknowledgeEmployeeVaultExpiryNotice({
      ...input, noticeId: notices[0].id, canAccessOrgUnit: () => false,
    }), "not_found", "unit-scoped reviewers cannot acknowledge other units");

    assert.equal(await acknowledgeEmployeeVaultExpiryNotice({
      ...input, noticeId: notices[0].id,
    }), "acknowledged");
    assert.equal(await acknowledgeEmployeeVaultExpiryNotice({
      ...input, noticeId: notices[0].id,
    }), "already_acknowledged", "the acknowledgement must be idempotent");

    const [recorded] = await db.select().from(hcmDocumentExpiryNotices)
      .where(eq(hcmDocumentExpiryNotices.id, notices[0].id));
    assert.equal(recorded.acknowledgedByUserId, actor.id);
    assert.ok(recorded.acknowledgedAt);
    const audits = await db.select().from(auditEvents).where(and(
      eq(auditEvents.organizationId, org.id),
      eq(auditEvents.action, "HR document expiry notice acknowledged"),
    ));
    assert.equal(audits.length, 1, "a replay cannot duplicate the audit");

    await db.update(hcmEmployeeDocumentCompliance).set({
      status: "waived", verifiedAt: null,
    }).where(eq(hcmEmployeeDocumentCompliance.id, compliance.id));
    assert.equal(await acknowledgeEmployeeVaultExpiryNotice({
      ...input, noticeId: notices[1].id,
    }), "stale", "a concurrent HR waiver invalidates the existing notice");

    await db.update(hcmEmployeeDocumentCompliance).set({
      status: "current", verifiedAt: new Date("2026-10-02T00:00:00Z"),
      expiresAt: "2026-12-01",
    }).where(eq(hcmEmployeeDocumentCompliance.id, compliance.id));
    assert.equal(await acknowledgeEmployeeVaultExpiryNotice({
      ...input, noticeId: notices[2].id,
    }), "stale", "changed document expiry invalidates the old milestone");

    for (const notice of notices.slice(1)) {
      const [latest] = await db.select().from(hcmDocumentExpiryNotices)
        .where(eq(hcmDocumentExpiryNotices.id, notice.id));
      assert.equal(latest.acknowledgedAt, null, "stale notice must stay unread");
    }
    const finalAudits = await db.select().from(auditEvents).where(and(
      eq(auditEvents.organizationId, org.id),
      eq(auditEvents.action, "HR document expiry notice acknowledged"),
    ));
    assert.equal(finalAudits.length, 1);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await db.delete(users).where(eq(users.id, actor.id));
    if (previousFlag === undefined) delete process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED;
    else process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED = previousFlag;
  }
});
