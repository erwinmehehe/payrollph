import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employeePayProfiles, employees, hcmBusinessProcessDefinitions, importBatches, orgUnits } from "@/db/schema";
import { encryptBankAccount } from "./bank-account-crypto";
import { encryptGovernmentId } from "./government-id-crypto";
import { ensurePrimaryLegalEntity } from "./legal-entity";
import { previewEmployeeImport, type EmployeeImportPreview } from "./employee-import-preview";

export class ImportBatchRejected extends Error {
  constructor(public preview: EmployeeImportPreview, message = "Fix or explicitly skip every error row before committing.") { super(message); }
}
export async function readEmployeeImportContext(organizationId: number, reader: Pick<typeof db, "select"> = db) {
  const [existing, departments] = await Promise.all([
    reader.select({ employeeNo: employees.employeeNo }).from(employees).where(eq(employees.organizationId, organizationId)),
    reader.select({ id: orgUnits.id, name: orgUnits.name, code: orgUnits.code, type: orgUnits.type }).from(orgUnits).where(and(eq(orgUnits.organizationId, organizationId), eq(orgUnits.active, true))),
  ]);
  return { existingNumbers: existing.map(r => r.employeeNo), departments: departments.filter(d => d.type.toLowerCase() === "department") };
}

/** Every selected employee, profile, legal-employer bootstrap, batch and audit
 * commits together. Preflight results never authorize a stale database snapshot. */
export async function commitEmployeeImport(input: {
  organizationId: number; csv: string; skipLines: number[]; fileName: string;
  actor: string; actorId: number; seatLimit: number | null;
}, database = db) {
  return database.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(4212, ${input.organizationId})`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(4195, ${input.organizationId})`);
    const [hire] = await tx.select({ id: hcmBusinessProcessDefinitions.id }).from(hcmBusinessProcessDefinitions).where(and(eq(hcmBusinessProcessDefinitions.organizationId, input.organizationId), eq(hcmBusinessProcessDefinitions.processType, "hire"))).limit(1);
    if (hire) throw new Error("HCM_GOVERNED_HIRE_REQUIRED");
    const context = await readEmployeeImportContext(input.organizationId, tx);
    const preview = previewEmployeeImport(input.csv, { ...context, skipLines: input.skipLines });
    if (preview.fileErrors.length || preview.blockingErrorCount) throw new ImportBatchRejected(preview);
    if (!preview.candidates.length) throw new ImportBatchRejected(preview, "No employee rows selected for import.");
    if (input.seatLimit !== null && context.existingNumbers.length + preview.candidates.length > input.seatLimit) throw new ImportBatchRejected(preview, "Import exceeds this tenant's employee seat limit.");
    const entity = await ensurePrimaryLegalEntity(input.organizationId, input.actorId, tx);
    if (!entity?.active) throw new ImportBatchRejected(preview, "An active legal employer is required.");
    const inserted: Array<{ id: number; basicRate: string }> = [];
    for (let start = 0; start < preview.candidates.length; start += 500) {
      const chunk = await tx.insert(employees).values(preview.candidates.slice(start, start + 500).map(row => ({
      organizationId: input.organizationId, legalEntityId: entity.id, orgUnitId: row.orgUnitId,
      employeeNo: row.employeeNo, firstName: row.firstName, lastName: row.lastName,
      title: row.title, employmentType: row.employmentType, status: row.status,
      avatarInitials: `${row.firstName[0]}${row.lastName[0]}`.toUpperCase(),
      basicRate: row.monthlyBasic.toFixed(2), mwe: row.mwe, region: row.region,
      email: row.email, mobile: row.mobile, bankCode: row.bankCode,
      bankAccount: encryptBankAccount(row.bankAccount),
      tin: encryptGovernmentId(row.tin, { required: process.env.NODE_ENV === "production" }),
      startDate: row.startDate,
      }))).returning({ id: employees.id, basicRate: employees.basicRate });
      inserted.push(...chunk);
    }
    for (let start = 0; start < inserted.length; start += 500) {
      await tx.insert(employeePayProfiles).values(inserted.slice(start, start + 500).map(row => ({ organizationId: input.organizationId, employeeId: row.id, payBasis: "monthly", rateAmount: row.basicRate, standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00" })));
    }
    const [batch] = await tx.insert(importBatches).values({ organizationId: input.organizationId, fileName: input.fileName, totalRows: preview.totalRows, createdCount: inserted.length, updatedCount: 0, errorCount: preview.errorCount, status: "completed", errors: preview.rows.filter(r => r.status === "error").map(r => ({ line: r.line, problems: r.reasons, skipped: r.skipped })), createdBy: input.actor }).returning();
    await tx.insert(auditEvents).values({ organizationId: input.organizationId, actor: input.actor, action: "Employee import committed (atomic)", resource: input.fileName, metadata: { batchId: batch.id, importedEmployeeIds: inserted.map(r => r.id), created: inserted.length, skipped: preview.skippedCount } });
    return { batchId: batch.id, createdCount: inserted.length, preview };
  });
}
