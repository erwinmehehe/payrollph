import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  documents, employeeHrCaseMessages, employeeHrCases, employees, organizations, users,
} from "../src/db/schema";

test("HR cases, case messages and COE documents must share the same employer in PostgreSQL", async () => {
  const suffix = randomUUID().slice(0, 11);
  const orgs: number[] = [];
  let actorId: number | null = null;
  try {
    const [alpha, beta] = await db.insert(organizations).values([
      { name: "Case alpha " + suffix, legalName: "Case alpha " + suffix },
      { name: "Case beta " + suffix, legalName: "Case beta " + suffix },
    ]).returning();
    orgs.push(alpha.id, beta.id);
    const [actor] = await db.insert(users).values({
      email: "hr-case-" + suffix + "@example.test", name: "Synthetic applicant",
      role: "employee", passwordHash: "not-valid",
    }).returning();
    actorId = actor.id;
    const [workerA, workerB] = await db.insert(employees).values([
      { organizationId: alpha.id, employeeNo: "A-" + suffix, firstName: "Synthetic",
        lastName: "A", title: "Staff", avatarInitials: "SA",
        basicRate: "12000", startDate: "2026-01-01" },
      { organizationId: beta.id, employeeNo: "B-" + suffix, firstName: "Synthetic",
        lastName: "B", title: "Staff", avatarInitials: "SB",
        basicRate: "12000", startDate: "2026-01-01" },
    ]).returning();

    const base = {
      organizationId: alpha.id, createdByUserId: actor.id,
      caseType: "coe", subject: "Employment confirmation",
      description: "Synthetic request for database isolation.",
      assignedRole: "hr", slaDueAt: new Date("2026-11-01T00:00:00Z"),
    };
    await assert.rejects(db.insert(employeeHrCases).values({
      ...base, employeeId: workerB.id,
    }), "a valid employee ID from another employer cannot satisfy the composite FK");

    const [owned] = await db.insert(employeeHrCases).values({
      ...base, employeeId: workerA.id,
    }).returning();
    await assert.rejects(db.insert(employeeHrCaseMessages).values({
      organizationId: beta.id, caseId: owned.id, actorUserId: actor.id,
      visibility: "employee", body: "Foreign case injection",
    }), "a foreign employer cannot attach a case message");

    const [foreignCoe] = await db.insert(documents).values({
      organizationId: beta.id, employeeId: workerB.id,
      kind: "coe", fileName: "foreign-coe.txt", mimeType: "text/plain",
      byteSize: 0, sha256: "e".repeat(64), scannedClean: true,
      uploadedBy: "Synthetic reviewer", content: "",
    }).returning();
    await assert.rejects(db.update(employeeHrCases).set({
      coeDocumentId: foreignCoe.id,
    }).where(eq(employeeHrCases.id, owned.id)), 
    "a case cannot certify a document belonging to another employer");

    const [unmodified] = await db.select().from(employeeHrCases)
      .where(eq(employeeHrCases.id, owned.id));
    assert.equal(unmodified.coeDocumentId, null);
    const [validMessage] = await db.insert(employeeHrCaseMessages).values({
      organizationId: alpha.id, caseId: owned.id, actorUserId: actor.id,
      visibility: "internal", body: "Synthetic private note",
    }).returning();
    assert.equal(validMessage.organizationId, alpha.id);
  } finally {
    for (const id of orgs) await db.delete(organizations).where(eq(organizations.id, id));
    if (actorId !== null) await db.delete(users).where(eq(users.id, actorId));
  }
});
