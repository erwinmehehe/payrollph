import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { documents, employees, organizations } from "../src/db/schema";
import { generateAutomationEmployeeDocument } from "../src/lib/automation-document-generation";

test("generated documents use object-only storage with one-time source-key writes when A-5 is enabled", async () => {
  const prior = process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED;
  process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED = "true";
  const [org] = await db.insert(organizations).values({
    name: "A5 Generated QA", legalName: "A5 Generated QA Corp.", plan: "Core",
  }).returning();
  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: "A5-GENERATED", firstName: "Sample",
      lastName: "Person", title: "Associate", avatarInitials: "SP",
      basicRate: "42000.00", startDate: "2026-01-01",
    }).returning();
    const writes: Array<{ key: string; bytes: Uint8Array; mime: string }> = [];
    const deletes: string[] = [];
    const objectStore = {
      async put(key: string, bytes: Uint8Array, mime: string) {
        writes.push({ key, bytes, mime });
      },
      async delete(key: string) { deletes.push(key); },
    };
    const input = {
      organizationId: org.id, employeeId: employee.id,
      trigger: "employee.hired" as const, templateId: "employee-onboarding-summary",
      sourceKey: "employee:" + employee.id + ":hire-summary-a5",
      actor: "Synthetic A5 QA", objectStore,
    };
    const first = await generateAutomationEmployeeDocument(input);
    const second = await generateAutomationEmployeeDocument(input);
    assert.equal(first.idempotent, false);
    assert.equal(second.idempotent, true);
    assert.equal(first.document.id, second.document.id);
    assert.equal(writes.length, 1, "repeat must not write another object");
    assert.equal(deletes.length, 0);
    assert.equal(writes[0].mime, "text/plain; charset=utf-8");
    assert.ok(writes[0].bytes.length > 40);
    assert.equal(writes[0].key, first.document.objectStorageKey);
    assert.equal(first.document.content, "", "no generated employee file bytes/base64 in SQL");
    assert.match(String(first.document.objectStorageKey),
      new RegExp("^private-documents/" + org.id + "/" + employee.id + "/"));
    const rows = await db.select().from(documents).where(eq(documents.organizationId, org.id));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].content, "");
    assert.equal(rows[0].sha256, first.document.sha256);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    if (prior === undefined) delete process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED;
    else process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED = prior;
  }
});

test("generated vault fails closed on object store outage without writing any document row", async () => {
  const prior = process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED;
  process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED = "true";
  const [org] = await db.insert(organizations).values({
    name: "A5 Fail Closed QA", legalName: "A5 Fail Closed Corp.", plan: "Core",
  }).returning();
  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: "A5-STORAGE-DOWN", firstName: "Storage",
      lastName: "Down", title: "Associate", avatarInitials: "SD",
      basicRate: "42000.00", startDate: "2026-01-01",
    }).returning();
    await assert.rejects(() => generateAutomationEmployeeDocument({
      organizationId: org.id, employeeId: employee.id,
      trigger: "employee.hired", templateId: "employee-onboarding-summary",
      sourceKey: "employee:" + employee.id + ":failed-object-store",
      objectStore: {
        async put() { throw new Error("Synthetic storage outage"); },
        async delete() {},
      },
    }), /Private generated-document storage is unavailable/);
    const rows = await db.select().from(documents).where(eq(documents.organizationId, org.id));
    assert.equal(rows.length, 0);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    if (prior === undefined) delete process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED;
    else process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED = prior;
  }
});
