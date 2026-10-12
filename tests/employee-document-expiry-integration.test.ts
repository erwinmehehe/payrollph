import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  documents, employees, hcmDocumentExpiryNotices,
  hcmDocumentRequirements, hcmEmployeeDocumentCompliance, organizations,
} from "../src/db/schema";
import { runScheduledHcmDocumentExpiry } from "../src/lib/hcm-documents";

test("Manila 30/14/7-day HR notices insert once per milestone and never auto-verify a submitted file", async () => {
  const previous = process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED;
  process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED = "true";
  const [org] = await db.insert(organizations).values({
    name: "A5 Expiry QA", legalName: "A5 Expiry QA Inc.", plan: "Core",
  }).returning();
  try {
    const [verifiedEmployee, submittedEmployee] = await db.insert(employees).values([
      {
        organizationId: org.id, employeeNo: "A5-VERIFIED", firstName: "Verified",
        lastName: "Employee", title: "Associate", avatarInitials: "VE",
        basicRate: "32000.00", startDate: "2025-01-01",
      },
      {
        organizationId: org.id, employeeNo: "A5-SUBMITTED", firstName: "Submitted",
        lastName: "Employee", title: "Associate", avatarInitials: "SE",
        basicRate: "32000.00", startDate: "2025-01-01",
      },
    ]).returning();
    const [rule] = await db.insert(hcmDocumentRequirements).values({
      organizationId: org.id, code: "A5-TEST-LICENSE", name: "Synthetic professional license",
      kind: "professional_license", mandatory: true, expiryRequired: true,
      renewalLeadDays: 30, submissionDueDays: 14,
      createdByName: "QA test", targetConditions: {},
    }).returning();

    const files = await db.insert(documents).values(
      [verifiedEmployee, submittedEmployee].map((employee, index) => ({
        organizationId: org.id, employeeId: employee.id,
        kind: "professional_license", fileName: "synthetic-license.pdf",
        mimeType: "application/pdf", byteSize: 8,
        sha256: "b".repeat(64), scannedClean: true, scanNote: "Synthetic test",
        uploadedBy: "Synthetic QA", content: "",
        objectStorageKey: "private-documents/" + org.id + "/" + employee.id +
          "/00000000-0000-4000-8000-00000000000" + (index + 1),
      })),
    ).returning();
    const [verified, submitted] = await db.insert(hcmEmployeeDocumentCompliance).values([
      {
        organizationId: org.id, requirementId: rule.id, employeeId: verifiedEmployee.id,
        documentId: files[0].id, status: "current", verifiedAt: new Date("2026-10-01T00:00:00Z"),
        verifiedByName: "HR QA", expiresAt: "2026-11-11",
      },
      {
        organizationId: org.id, requirementId: rule.id, employeeId: submittedEmployee.id,
        documentId: files[1].id, status: "submitted", expiresAt: "2026-11-11",
      },
    ]).returning();
    const cases: Array<{ now: Date; expect: number[] }> = [
      { now: new Date("2026-10-11T16:01:00Z"), expect: [30] },
      { now: new Date("2026-10-27T16:01:00Z"), expect: [30, 14] },
      { now: new Date("2026-11-03T16:01:00Z"), expect: [30, 14, 7] },
    ];
    for (const step of cases) {
      // Replay of the same scheduled tick must never create duplicate notices.
      await runScheduledHcmDocumentExpiry({ actor: "A5 QA", now: step.now, organizationId: org.id });
      await runScheduledHcmDocumentExpiry({ actor: "A5 QA", now: step.now, organizationId: org.id });
      const notices = await db.select().from(hcmDocumentExpiryNotices).where(and(
        eq(hcmDocumentExpiryNotices.organizationId, org.id),
        eq(hcmDocumentExpiryNotices.complianceId, verified.id),
      ));
      assert.deepEqual(notices.map(item => item.milestoneDays).sort((a, b) => b - a),
        step.expect, "one unique durable HR notice per reached milestone");
      const pendingNotices = await db.select().from(hcmDocumentExpiryNotices).where(and(
        eq(hcmDocumentExpiryNotices.organizationId, org.id),
        eq(hcmDocumentExpiryNotices.complianceId, submitted.id),
      ));
      assert.equal(pendingNotices.length, 0);
      const [unverified] = await db.select().from(hcmEmployeeDocumentCompliance).where(
        eq(hcmEmployeeDocumentCompliance.id, submitted.id),
      );
      assert.equal(unverified.status, "submitted", "scheduler is never an HR verifier");
      assert.equal(unverified.verifiedAt, null);
    }
    // A changed expiry date must not reuse an older notice's idempotency key.
    await db.update(hcmEmployeeDocumentCompliance).set({
      expiresAt: "2026-12-03", status: "current",
    }).where(eq(hcmEmployeeDocumentCompliance.id, verified.id));
    await runScheduledHcmDocumentExpiry({
      actor: "A5 QA", now: new Date("2026-11-02T16:01:00Z"), organizationId: org.id,
    });
    const freshNotices = await db.select().from(hcmDocumentExpiryNotices).where(and(
      eq(hcmDocumentExpiryNotices.organizationId, org.id),
      eq(hcmDocumentExpiryNotices.complianceId, verified.id),
      eq(hcmDocumentExpiryNotices.expiresOn, "2026-12-03"),
    ));
    assert.equal(freshNotices.length, 1);
    assert.equal(freshNotices[0].milestoneDays, 30);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    if (previous === undefined) delete process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED;
    else process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED = previous;
  }
});
