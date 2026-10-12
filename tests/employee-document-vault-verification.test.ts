import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  auditEvents, documents, employees, hcmDocumentRequirements,
  hcmEmployeeDocumentCompliance, organizations, users,
} from "../src/db/schema";
import {
  verifyEmployeeVaultDocument, vaultIndependentCheckerDecision,
} from "../src/lib/employee-document-vault-verification";

test("independent 201-file verification rejects unscanned, untracked and self-approved files", () => {
  const sample = {
    status: "submitted", sourceType: "upload", uploadedByUserId: 3,
    checkerUserId: 4, scannedClean: true,
    objectStorageKey: "private-documents/2/9/00000000-0000-4000-8000-000000000001",
    organizationId: 2, employeeId: 9,
  };
  assert.equal(vaultIndependentCheckerDecision(sample), null);
  assert.equal(vaultIndependentCheckerDecision({ ...sample, checkerUserId: 3 }), "SELF_APPROVAL");
  assert.equal(vaultIndependentCheckerDecision({ ...sample, scannedClean: false }), "NOT_SCANNED");
  assert.equal(vaultIndependentCheckerDecision({ ...sample, uploadedByUserId: null }), "NO_UPLOADER_EVIDENCE");
  assert.equal(vaultIndependentCheckerDecision({ ...sample, sourceType: "generated" }), "NO_UPLOADER_EVIDENCE");
  assert.equal(vaultIndependentCheckerDecision({ ...sample, status: "waived" }), "NOT_SUBMITTED");
  assert.equal(vaultIndependentCheckerDecision({ ...sample, organizationId: 8 }), "STORAGE_EVIDENCE_INVALID");
  assert.equal(vaultIndependentCheckerDecision({ ...sample, employeeId: 8 }), "STORAGE_EVIDENCE_INVALID");
});

test("new HR upload is independently approved once, preserves status and records both user IDs", async () => {
  const previous = process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED;
  process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED = "true";
  const [org] = await db.insert(organizations).values({
    name: "A5 Maker Checker QA", legalName: "A5 Maker Checker Corp.", plan: "Core",
  }).returning();
  let userIds: number[] = [];
  try {
    const people = await db.insert(users).values([
      {
        email: "a5-uploader-" + org.id + "@example.invalid", name: "Uploading HR",
        passwordHash: "synthetic-hash-unusable", role: "hr",
      },
      {
        email: "a5-checker-" + org.id + "@example.invalid", name: "Reviewing HR",
        passwordHash: "synthetic-hash-unusable", role: "hr",
      },
    ]).returning();
    userIds = people.map(person => person.id);
    const [employee] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: "A5-MAKER-CHECKER",
      firstName: "Independent", lastName: "Review", title: "Worker",
      avatarInitials: "IR", basicRate: "27000.00", startDate: "2026-01-01",
    }).returning();
    const [rule] = await db.insert(hcmDocumentRequirements).values({
      organizationId: org.id, code: "A5-EXACT-ROLE", name: "Synthetic medical certificate",
      kind: "medical_certificate", expiryRequired: true, mandatory: true,
      renewalLeadDays: 30, createdByName: "QA reviewer", targetConditions: {},
    }).returning();
    const [file] = await db.insert(documents).values({
      organizationId: org.id, employeeId: employee.id, kind: "medical_certificate",
      fileName: "medical-certificate.pdf", mimeType: "application/pdf", byteSize: 8,
      sha256: "e".repeat(64), scannedClean: true, uploadedBy: people[0].name,
      uploadedByUserId: people[0].id, objectStorageKey:
        "private-documents/" + org.id + "/" + employee.id + "/00000000-0000-4000-8000-000000000001",
      content: "",
    }).returning();
    const [compliance] = await db.insert(hcmEmployeeDocumentCompliance).values({
      organizationId: org.id, employeeId: employee.id, requirementId: rule.id,
      documentId: file.id, status: "submitted", expiresAt: "2026-12-12",
    }).returning();
    const common = {
      organizationId: org.id, employeeId: employee.id,
      complianceId: compliance.id, expectedDocumentId: file.id,
      checkerUserId: people[0].id, checkerName: people[0].name,
    };
    const sameActor = await verifyEmployeeVaultDocument(common);
    assert.equal(sameActor.ok, false);
    if (!sameActor.ok) assert.equal(sameActor.code, "SELF_APPROVAL");
    const [unchanged] = await db.select().from(hcmEmployeeDocumentCompliance).where(
      eq(hcmEmployeeDocumentCompliance.id, compliance.id),
    );
    assert.equal(unchanged.status, "submitted");
    assert.equal(unchanged.verifiedAt, null);

    const independent = await verifyEmployeeVaultDocument({
      ...common, checkerUserId: people[1].id, checkerName: people[1].name,
    });
    assert.equal(independent.ok, true);
    if (independent.ok) {
      assert.equal(independent.row.verifiedByUserId, people[1].id);
      assert.ok(independent.row.verifiedAt);
    }
    const duplicate = await verifyEmployeeVaultDocument({
      ...common, checkerUserId: people[1].id, checkerName: people[1].name,
    });
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok) assert.equal(duplicate.code, "NOT_SUBMITTED");
    const audit = await db.select().from(auditEvents).where(and(
      eq(auditEvents.organizationId, org.id),
      eq(auditEvents.action, "Employee document independently verified"),
    ));
    assert.equal(audit.length, 1, "maker-checker acceptance is audited once");
    const evidence = audit[0].metadata as Record<string, unknown>;
    assert.equal(evidence.uploaderUserId, people[0].id);
    assert.equal(evidence.checkerUserId, people[1].id);
    const wrongTenant = await verifyEmployeeVaultDocument({
      ...common, organizationId: org.id + 50000,
      checkerUserId: people[1].id, checkerName: people[1].name,
    });
    assert.equal(wrongTenant.ok, false);
    if (!wrongTenant.ok) assert.equal(wrongTenant.code, "NOT_FOUND");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    if (previous === undefined) delete process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED;
    else process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED = previous;
  }
});
