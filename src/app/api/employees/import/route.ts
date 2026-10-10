import { encryptBankAccount } from "@/lib/bank-account-crypto";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employeePayProfiles, employees, hcmBusinessProcessDefinitions, importBatches } from "@/db/schema";
import { GOVERNED_HIRE_REQUIRED, hasConfiguredHireBusinessProcess } from "@/lib/hcm-direct-entry-policy";
import { getSessionUser } from "@/lib/auth";
import { getEntitlements, requireFeature, seatUsage } from "@/lib/billing";
import { parseEmployeeCsv } from "@/lib/csv-import";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { ensureMigrationSchema } from "@/lib/migration-schema";
import { ensureEmployeePayProfiles } from "@/lib/pay-basis-schema";
import { requireSaasPaidWrites } from "@/lib/saas-workspace-access";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const csv = typeof body.csv === "string" ? body.csv : "";
  if (Buffer.byteLength(csv, "utf8") > 2 * 1024 * 1024) {
    return Response.json({ error: "CSV import exceeds the 2 MB limit." }, { status: 413 });
  }
  const fileName = String(body.fileName ?? "upload.csv").slice(0, 200);
  const dryRun = Boolean(body.dryRun);

  if (!Number.isInteger(organizationId) || !csv.trim()) {
    return Response.json({ error: "organizationId and csv content are required." }, { status: 400 });
  }

  const deniedImport = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can import employee records.",
  );
  if (deniedImport) return deniedImport;
  if (!dryRun) {
    const subscriptionDenied = await requireSaasPaidWrites(organizationId);
    if (subscriptionDenied) return subscriptionDenied;
  }
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Bulk employee import requires company-wide People administrator access." }, { status: 403 });
  }
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  // A configured enterprise Hire business process cannot be bypassed by
  // uploading a CSV, including a CSV that supplies valid employee numbers.
  if (await hasConfiguredHireBusinessProcess(organizationId)) {
    return Response.json(GOVERNED_HIRE_REQUIRED, { status: 409 });
  }

  await ensureMigrationSchema();
  await ensureEmployeePayProfiles(organizationId);

  const entitlements = await getEntitlements(organizationId);
  const gate = requireFeature(entitlements, "imports");
  if (gate) return gate;

  const parsed = parseEmployeeCsv(csv);
  if (parsed.valid.length === 0 && parsed.errors.length > 0) {
    return Response.json({
      error: "No valid rows found.",
      errors: parsed.errors.slice(0, 25),
      unmappedColumns: parsed.unmapped,
    }, { status: 422 });
  }

  const existing = await db.select({ employeeNo: employees.employeeNo })
    .from(employees)
    .where(eq(employees.organizationId, organizationId));
  const knownNumbers = new Set(existing.map((row) => row.employeeNo));

  const seen = new Set<string>();
  const toInsert: typeof employees.$inferInsert[] = [];
  const rowErrors = [...parsed.errors];
  let skippedExistingCount = 0;

  for (const { line, value: row } of parsed.validRows) {
    if (seen.has(row.employeeNo)) {
      rowErrors.push({ line, problems: [`Duplicate employeeNo "${row.employeeNo}" inside the upload`] });
      continue;
    }
    seen.add(row.employeeNo);

    // Never mutate an existing employee's pay, bank account, title, status,
    // or MWE classification from a CSV. Existing workers use the appropriate
    // governed change, payout review or audited correction process.
    if (knownNumbers.has(row.employeeNo)) {
      skippedExistingCount += 1;
      rowErrors.push({
        line,
        problems: [
          `Employee "${row.employeeNo}" already exists. No fields were changed. Use the governed HCM/payroll/payout workflow for corrections; CSV import creates new employees only.`,
        ],
      });
      continue;
    }

    toInsert.push({
      organizationId,
      employeeNo: row.employeeNo,
      firstName: row.firstName,
      lastName: row.lastName,
      title: row.title,
      employmentType: row.employmentType,
      status: row.status,
      avatarInitials: `${row.firstName[0] ?? "?"}${row.lastName[0] ?? "?"}`.toUpperCase(),
      basicRate: row.monthlyBasic.toFixed(2),
      mwe: row.mwe,
      region: row.region,
      email: row.email,
      mobile: row.mobile,
      bankAccount: encryptBankAccount(row.bankAccount),
      bankCode: row.bankCode,
      startDate: row.startDate,
    });
  }

  // Existing employees and duplicate rows do not consume additional seats.
  const seats = await seatUsage(organizationId, entitlements.seatLimit);
  if (seats.limit != null && seats.used + toInsert.length > seats.limit) {
    return Response.json({
      error: `Import would take you to ${seats.used + toInsert.length} employees but the ${entitlements.plan} plan allows ${seats.limit} seats.`,
      plan: entitlements.plan,
      seatLimit: seats.limit,
      currentlyUsed: seats.used,
      rowsRequested: toInsert.length,
      upgradeRequired: true,
    }, { status: 402 });
  }

  if (toInsert.length === 0 && rowErrors.length > 0) {
    return Response.json({
      error: "No new employees can be created from this file.",
      dryRun,
      newEligibleCount: 0,
      skippedExistingCount,
      errorCount: rowErrors.length,
      errors: rowErrors.slice(0, 25),
      unmappedColumns: parsed.unmapped,
    }, { status: 422 });
  }

  let committed: { batch: typeof importBatches.$inferSelect; createdCount: number };
  try {
    committed = await db.transaction(async (tx) => {
      // Serializes concurrent CSV intake per tenant. Rechecking membership in
      // this transaction prevents two importer requests from inserting the same
      // worker after both observed the same preflight snapshot.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(4212, ${organizationId})`);
      // Revalidate configured Hire policy in the transaction: a CSV upload
      // cannot outrun an organization HCM definition being saved.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(4195, ${organizationId})`);
      const [configuredHire] = await tx.select({ id: hcmBusinessProcessDefinitions.id })
        .from(hcmBusinessProcessDefinitions)
        .where(and(
          eq(hcmBusinessProcessDefinitions.organizationId, organizationId),
          eq(hcmBusinessProcessDefinitions.processType, "hire"),
        )).limit(1);
      if (configuredHire) throw new Error("HCM_GOVERNED_HIRE_REQUIRED");
      let inserted: Array<{ id: number; employeeNo: string; basicRate: string }> = [];
      if (!dryRun && toInsert.length) {
        // Employee numbers are unique only within a tenant. Never reject
        // another employer's worker merely for sharing an employee number.
        const collisionForTenant = await tx.select({ employeeNo: employees.employeeNo })
          .from(employees)
          .where(eq(employees.organizationId, organizationId));
        const current = new Set(collisionForTenant.map((row) => row.employeeNo));
        if (toInsert.some((row) => current.has(row.employeeNo ?? ""))) {
          throw new Error("IMPORT_DUPLICATE_AFTER_PREFLIGHT");
        }
        // Keep the transaction atomic across the worker, pay-profile, batch
        // summary and audit; no half-created workers if a later write fails.
        inserted = await tx.insert(employees).values(toInsert).returning({
          id: employees.id,
          employeeNo: employees.employeeNo,
          basicRate: employees.basicRate,
        });
        await tx.insert(employeePayProfiles).values(inserted.map((row) => ({
          employeeId: row.id,
          organizationId,
          payBasis: "monthly",
          rateAmount: row.basicRate,
          standardWorkDaysPerMonth: "22.00",
          standardHoursPerDay: "8.00",
        })));
      }

      const [batch] = await tx.insert(importBatches).values({
        organizationId,
        fileName,
        totalRows: parsed.valid.length + parsed.errors.length,
        createdCount: inserted.length,
        updatedCount: 0,
        errorCount: rowErrors.length,
        status: rowErrors.length ? "partial" : "completed",
        errors: rowErrors.slice(0, 100),
        createdBy: user.name,
      }).returning();

      await tx.insert(auditEvents).values({
        organizationId,
        actor: user.name,
        action: dryRun ? "Employee import validated (create-only)" : "Employee import completed (create-only)",
        resource: fileName,
        metadata: {
          batchId: batch.id,
          importedEmployeeIds: inserted.map((row) => row.id),
          created: inserted.length,
          updated: 0,
          skippedExisting: skippedExistingCount,
          errors: rowErrors.length,
          plan: entitlements.plan,
          dryRun,
        },
      });

      return { batch, createdCount: inserted.length };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "HCM_GOVERNED_HIRE_REQUIRED") {
      return Response.json(GOVERNED_HIRE_REQUIRED, { status: 409 });
    }
    if (error instanceof Error && error.message === "IMPORT_DUPLICATE_AFTER_PREFLIGHT") {
      return Response.json({
        error: "Another request created one of these employee numbers during the import. Refresh and validate the CSV again.",
        code: "EMPLOYEE_IMPORT_CONCURRENT_CONFLICT",
      }, { status: 409 });
    }
    throw error;
  }

  return Response.json({
    batchId: committed.batch.id,
    dryRun,
    fileName,
    totalRows: committed.batch.totalRows,
    createdCount: committed.createdCount,
    updatedCount: 0,
    newEligibleCount: toInsert.length,
    skippedExistingCount,
    errorCount: rowErrors.length,
    errors: rowErrors.slice(0, 25),
    unmappedColumns: parsed.unmapped,
    seatUsage: { used: seats.used + committed.createdCount, limit: seats.limit },
  });
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId") ?? "1");
  const deniedList = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can view import history.",
  );
  if (deniedList) return deniedList;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Import history is available only to company-wide People administrators." }, { status: 403 });
  }
  await ensureMigrationSchema();
  const batches = await db.select().from(importBatches).where(eq(importBatches.organizationId, organizationId));
  return Response.json({ batches: batches.slice(-10).reverse() });
}

export const TEMPLATE_CSV = `Employee No,First Name,Last Name,Title,Employment Type,Status,Start Date,Monthly Basic,MWE,Region,Email,Mobile,Bank Account,Bank Code
EMP-001,Juan,Dela Cruz,Driver,Regular,Active,2026-01-15,21500.00,no,NCR,juan@example.com,09171234567,1234567890,BDO
EMP-002,Maria,Santos,Bookkeeper,Regular,Active,2026-03-01,28000.00,no,III,maria@example.com,09181234567,1234567891,BPI
EMP-003,Pedro,Reyes,Helper,Probationary,Active,2026-06-01,22500.00,no,NCR,,,,
`;
