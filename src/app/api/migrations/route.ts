import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employeeLoans,
  employeePayProfiles,
  employees,
  historicalPayrollEntries,
  importBatches,
  leaveBalances,
} from "@/db/schema";
import { ORG_ADMIN_ROLES, assertOrganizationRole } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { ensureCoreCompatibilitySchema } from "@/lib/core-schema-compat";
import { ensureMigrationSchema } from "@/lib/migration-schema";
import { ensureEmployeePayProfiles } from "@/lib/pay-basis-schema";
import { getEntitlements, requireFeature, seatUsage } from "@/lib/billing";
import { xlsxToCsv } from "@/lib/xlsx-import";
import {
  MIGRATION_SOURCES,
  type MigratedEmployee,
  type MigratedLeaveBalance,
  type MigratedLoan,
  type MigratedPayrollHistory,
  type MigrationKind,
  type MigrationSource,
  parseMigrationCsv,
} from "@/lib/migration-import";

export const dynamic = "force-dynamic";

const VALID_KINDS = new Set<MigrationKind>(["employees", "payroll_history", "leave_balances", "loans"]);
const VALID_SOURCES = new Set<MigrationSource>(MIGRATION_SOURCES.map((source) => source.id));
const MAX_MIGRATION_FILE_BYTES = 15 * 1024 * 1024;

function migrationRowKey(kind: MigrationKind, row: unknown) {
  if (kind === "employees") {
    const value = row as MigratedEmployee;
    return `employee:${value.employeeNo.trim().toLowerCase()}`;
  }
  if (kind === "payroll_history") {
    const value = row as MigratedPayrollHistory;
    return `payroll:${value.employeeNo.trim().toLowerCase()}:${value.sourceReference.trim().toLowerCase()}`;
  }
  if (kind === "leave_balances") {
    const value = row as MigratedLeaveBalance;
    return `leave:${value.employeeNo.trim().toLowerCase()}:${value.leaveType.trim().toLowerCase()}:${value.year}`;
  }
  const value = row as MigratedLoan;
  return `loan:${value.employeeNo.trim().toLowerCase()}:${value.referenceNo.trim().toLowerCase()}`;
}

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const cents = (value: number) => value.toFixed(2);
const oneDecimal = (value: number) => value.toFixed(1);

export async function GET(request: Request) {
  await ensureCoreCompatibilitySchema();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    ORG_ADMIN_ROLES,
    "Only organization administrators and bookkeepers can view migration history.",
  );
  if (denied) return denied;

  await ensureMigrationSchema();

  const batches = await db
    .select()
    .from(importBatches)
    .where(eq(importBatches.organizationId, organizationId))
    .orderBy(desc(importBatches.createdAt))
    .limit(20);

  return Response.json({
    sources: MIGRATION_SOURCES,
    batches: batches.map((batch) => ({
      id: batch.id,
      fileName: batch.fileName,
      sourceSystem: batch.sourceSystem,
      importKind: batch.importKind,
      totalRows: batch.totalRows,
      createdCount: batch.createdCount,
      updatedCount: batch.updatedCount,
      errorCount: batch.errorCount,
      status: batch.status,
      createdBy: batch.createdBy,
      createdAt: batch.createdAt,
    })),
  });
}

export async function POST(request: Request) {
  await ensureCoreCompatibilitySchema();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  let organizationId = Number.NaN;
  let source = "generic" as MigrationSource;
  let kind = "employees" as MigrationKind;
  let csv = "";
  let fileName = "migration.csv";
  let dryRun = true;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    organizationId = Number(form.get("organizationId"));
    source = String(form.get("source") ?? "generic") as MigrationSource;
    kind = String(form.get("kind") ?? "employees") as MigrationKind;
    dryRun = String(form.get("dryRun") ?? "true") !== "false";

    const upload = form.get("file");
    if (!upload || typeof upload === "string") {
      return Response.json({ error: "Choose a CSV or XLSX file to migrate." }, { status: 400 });
    }
    if (upload.size > MAX_MIGRATION_FILE_BYTES) {
      return Response.json({ error: "Migration files must be 15 MB or smaller." }, { status: 413 });
    }

    fileName = upload.name.slice(0, 200) || "migration.csv";
    const lowerName = fileName.toLowerCase();
    const isXlsx =
      lowerName.endsWith(".xlsx") ||
      upload.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const isCsv =
      lowerName.endsWith(".csv") ||
      upload.type === "text/csv" ||
      upload.type === "application/csv";

    try {
      if (isXlsx) csv = xlsxToCsv(new Uint8Array(await upload.arrayBuffer()));
      else if (isCsv) csv = await upload.text();
      else {
        return Response.json({ error: "Unsupported file type. Upload a .csv or .xlsx export." }, { status: 415 });
      }
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "The Excel file could not be read.",
      }, { status: 400 });
    }
  } else {
    const body = await request.json().catch(() => ({}));
    organizationId = Number(body.organizationId);
    source = String(body.source ?? "generic") as MigrationSource;
    kind = String(body.kind ?? "employees") as MigrationKind;
    csv = typeof body.csv === "string" ? body.csv : "";
    fileName = String(body.fileName ?? "migration.csv").slice(0, 200);
    dryRun = body.dryRun !== false;
  }

  if (!Number.isInteger(organizationId) || !csv.trim()) {
    return Response.json({ error: "organizationId and migration file content are required." }, { status: 400 });
  }
  if (!VALID_SOURCES.has(source)) {
    return Response.json({ error: "Unsupported migration source." }, { status: 400 });
  }
  if (!VALID_KINDS.has(kind)) {
    return Response.json({ error: "Unsupported migration data type." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    ORG_ADMIN_ROLES,
    "Only organization administrators and bookkeepers can migrate payroll or HR data.",
  );
  if (denied) return denied;

  await ensureMigrationSchema();
  await ensureEmployeePayProfiles(organizationId);

  const entitlements = await getEntitlements(organizationId);
  const gate = requireFeature(entitlements, "imports");
  if (gate) return gate;

  const parsed = parseMigrationCsv({ csv, source, kind });
  const rowErrors = [...parsed.errors];
  const rowLines = parsed.rowLines ?? [];
  const lineByRow = new Map(parsed.rows.map((row, index) => [row, rowLines[index] ?? 0]));
  const duplicateIndexes = new Set<number>();
  const firstSeen = new Map<string, number>();

  parsed.rows.forEach((row, index) => {
    const key = migrationRowKey(kind, row);
    const line = rowLines[index] ?? 0;
    const firstLine = firstSeen.get(key);
    if (firstLine != null) {
      duplicateIndexes.add(index);
      rowErrors.push({
        line,
        problems: [`Duplicate record inside the upload; the first matching row is line ${firstLine}.`],
      });
    } else {
      firstSeen.set(key, line);
    }
  });

  const duplicateCount = duplicateIndexes.size;
  const importRows = parsed.rows.filter((_row, index) => !duplicateIndexes.has(index));

  const staff = await db.select().from(employees).where(eq(employees.organizationId, organizationId));
  const employeeByNo = new Map(staff.map((employee) => [employee.employeeNo.trim().toLowerCase(), employee]));

  let createdCount = 0;
  let updatedCount = 0;
  let seatInfo: { used: number; limit: number | null } | undefined;

  if (kind === "employees") {
    const rows = importRows as MigratedEmployee[];
    const seen = new Set<string>();
    let newEmployees = 0;

    for (const row of rows) {
      const key = row.employeeNo.toLowerCase();
      if (seen.has(key)) {
        rowErrors.push({ line: 0, problems: [`Duplicate employee ID "${row.employeeNo}" inside the upload`] });
        continue;
      }
      seen.add(key);
      if (employeeByNo.has(key)) updatedCount += 1;
      else {
        createdCount += 1;
        newEmployees += 1;
      }
    }

    const seats = await seatUsage(organizationId, entitlements.seatLimit);
    seatInfo = { used: seats.used + (dryRun ? 0 : newEmployees), limit: seats.limit };
    if (seats.limit != null && seats.used + newEmployees > seats.limit) {
      return Response.json({
        error: `Migration would take you to ${seats.used + newEmployees} employees but the ${entitlements.plan} plan allows ${seats.limit} seats.`,
        plan: entitlements.plan,
        seatLimit: seats.limit,
        currentlyUsed: seats.used,
        newEmployees,
        upgradeRequired: true,
        mappings: parsed.mappings,
        unmappedColumns: parsed.unmappedColumns,
      }, { status: 402 });
    }
  }

  if (kind === "payroll_history") {
    const rows = importRows as MigratedPayrollHistory[];
    const existing = await db
      .select()
      .from(historicalPayrollEntries)
      .where(and(
        eq(historicalPayrollEntries.organizationId, organizationId),
        eq(historicalPayrollEntries.sourceSystem, source),
      ));
    const existingKeys = new Set(existing.map((row) => `${row.employeeId}:${row.sourceReference}`));

    for (const row of rows) {
      const employee = employeeByNo.get(row.employeeNo.toLowerCase());
      if (!employee) {
        rowErrors.push({ line: lineByRow.get(row) ?? 0, problems: [`Employee "${row.employeeNo}" does not exist yet. Import employees first.`] });
        continue;
      }
      if (existingKeys.has(`${employee.id}:${row.sourceReference}`)) updatedCount += 1;
      else createdCount += 1;
    }
  }

  if (kind === "leave_balances") {
    const rows = importRows as MigratedLeaveBalance[];
    const existing = await db.select().from(leaveBalances).where(eq(leaveBalances.organizationId, organizationId));
    const existingKeys = new Set(existing.map((row) => `${row.employeeId}:${row.leaveType.toLowerCase()}:${row.year}`));

    for (const row of rows) {
      const employee = employeeByNo.get(row.employeeNo.toLowerCase());
      if (!employee) {
        rowErrors.push({ line: lineByRow.get(row) ?? 0, problems: [`Employee "${row.employeeNo}" does not exist yet. Import employees first.`] });
        continue;
      }
      const key = `${employee.id}:${row.leaveType.toLowerCase()}:${row.year}`;
      if (existingKeys.has(key)) updatedCount += 1;
      else createdCount += 1;
    }
  }

  if (kind === "loans") {
    const rows = importRows as MigratedLoan[];
    const existing = await db.select().from(employeeLoans).where(eq(employeeLoans.organizationId, organizationId));
    const existingKeys = new Set(existing.map((row) => `${row.employeeId}:${row.referenceNo.toLowerCase()}`));

    for (const row of rows) {
      const employee = employeeByNo.get(row.employeeNo.toLowerCase());
      if (!employee) {
        rowErrors.push({ line: lineByRow.get(row) ?? 0, problems: [`Employee "${row.employeeNo}" does not exist yet. Import employees first.`] });
        continue;
      }
      const key = `${employee.id}:${row.referenceNo.toLowerCase()}`;
      if (existingKeys.has(key)) updatedCount += 1;
      else createdCount += 1;
    }
  }

  const readyCount = createdCount + updatedCount;
  const attentionCount = Math.max(0, rowErrors.length - duplicateCount);
  const totalRows = parsed.rows.length + parsed.errors.length;

  if (readyCount === 0 && rowErrors.length > 0) {
    return Response.json({
      error: "No rows are ready to import.",
      dryRun,
      source,
      kind,
      fileName,
      totalRows,
      readyCount: 0,
      attentionCount,
      duplicateCount,
      createdCount: 0,
      updatedCount: 0,
      errorCount: rowErrors.length,
      errors: rowErrors.slice(0, 50),
      mappings: parsed.mappings,
      unmappedColumns: parsed.unmappedColumns,
    }, { status: 422 });
  }

  if (dryRun) {
    return Response.json({
      dryRun: true,
      source,
      kind,
      fileName,
      totalRows,
      readyCount,
      attentionCount,
      duplicateCount,
      createdCount,
      updatedCount,
      errorCount: rowErrors.length,
      errors: rowErrors.slice(0, 50),
      mappings: parsed.mappings,
      unmappedColumns: parsed.unmappedColumns,
      seatUsage: seatInfo,
    });
  }

  const [batch] = await db.insert(importBatches).values({
    organizationId,
    fileName,
    sourceSystem: source,
    importKind: kind,
    totalRows,
    createdCount,
    updatedCount,
    errorCount: rowErrors.length,
    status: rowErrors.length > 0 ? "partial" : "completed",
    errors: rowErrors.slice(0, 100),
    createdBy: user.name,
  }).returning();

  if (kind === "employees") {
    const rows = importRows as MigratedEmployee[];
    const seen = new Set<string>();
    for (const row of rows) {
      const key = row.employeeNo.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const existing = employeeByNo.get(key);
      const values = {
        firstName: row.firstName,
        middleName: row.middleName,
        lastName: row.lastName,
        title: row.title,
        employmentType: row.employmentType,
        status: row.status,
        basicRate: cents(row.monthlyBasic),
        mwe: row.mwe,
        region: row.region,
        email: row.email,
        mobile: row.mobile,
        bankAccount: row.bankAccount,
        bankCode: row.bankCode,
        tin: row.tin,
        tinBranchCode: row.tinBranchCode,
        sssNo: row.sssNo,
        philHealthNo: row.philHealthNo,
        pagIbigNo: row.pagIbigNo,
      };
      let employeeId: number;
      if (existing) {
        await db.update(employees).set(values).where(and(
          eq(employees.organizationId, organizationId),
          eq(employees.id, existing.id),
        ));
        employeeId = existing.id;
      } else {
        const [createdEmployee] = await db.insert(employees).values({
          organizationId,
          employeeNo: row.employeeNo,
          ...values,
          avatarInitials: `${row.firstName[0] ?? "?"}${row.lastName[0] ?? "?"}`.toUpperCase(),
          startDate: row.startDate ?? today(),
        }).returning({ id: employees.id });
        employeeId = createdEmployee.id;
      }

      // Employee migration currently maps a field explicitly named monthly
      // basic salary. Preserve that source meaning as an explicit monthly pay
      // profile rather than letting payroll infer behavior from attendance.
      await db.insert(employeePayProfiles).values({
        employeeId,
        organizationId,
        payBasis: "monthly",
        rateAmount: cents(row.monthlyBasic),
        standardWorkDaysPerMonth: "22.00",
        standardHoursPerDay: "8.00",
      }).onConflictDoUpdate({
        target: employeePayProfiles.employeeId,
        set: {
          payBasis: "monthly",
          rateAmount: cents(row.monthlyBasic),
          standardWorkDaysPerMonth: "22.00",
          standardHoursPerDay: "8.00",
          updatedAt: new Date(),
        },
      });
    }
  }

  if (kind === "payroll_history") {
    const rows = importRows as MigratedPayrollHistory[];
    for (const row of rows) {
      const employee = employeeByNo.get(row.employeeNo.toLowerCase());
      if (!employee) continue;
      const values = {
        importBatchId: batch.id,
        periodLabel: row.periodLabel,
        payDate: row.payDate,
        grossPay: cents(row.grossPay),
        netPay: cents(row.netPay),
        taxWithheld: cents(row.taxWithheld),
        sssEmployee: cents(row.sssEmployee),
        philHealthEmployee: cents(row.philHealthEmployee),
        pagIbigEmployee: cents(row.pagIbigEmployee),
        thirteenthMonth: cents(row.thirteenthMonth),
      };
      await db.insert(historicalPayrollEntries).values({
        organizationId,
        employeeId: employee.id,
        sourceSystem: source,
        sourceReference: row.sourceReference,
        ...values,
      }).onConflictDoUpdate({
        target: [
          historicalPayrollEntries.organizationId,
          historicalPayrollEntries.employeeId,
          historicalPayrollEntries.sourceSystem,
          historicalPayrollEntries.sourceReference,
        ],
        set: values,
      });
    }
  }

  if (kind === "leave_balances") {
    const rows = importRows as MigratedLeaveBalance[];
    for (const row of rows) {
      const employee = employeeByNo.get(row.employeeNo.toLowerCase());
      if (!employee) continue;
      const values = {
        opening: oneDecimal(row.opening),
        accrued: oneDecimal(row.accrued),
        used: oneDecimal(row.used),
        pending: oneDecimal(row.pending),
        updatedAt: new Date(),
      };
      await db.insert(leaveBalances).values({
        organizationId,
        employeeId: employee.id,
        leaveType: row.leaveType,
        year: row.year,
        ...values,
      }).onConflictDoUpdate({
        target: [leaveBalances.employeeId, leaveBalances.leaveType, leaveBalances.year],
        set: values,
      });
    }
  }

  if (kind === "loans") {
    const rows = importRows as MigratedLoan[];
    const existing = await db.select().from(employeeLoans).where(eq(employeeLoans.organizationId, organizationId));
    const existingByKey = new Map(existing.map((loan) => [`${loan.employeeId}:${loan.referenceNo.toLowerCase()}`, loan]));

    for (const row of rows) {
      const employee = employeeByNo.get(row.employeeNo.toLowerCase());
      if (!employee) continue;
      const values = {
        loanType: row.loanType,
        principal: cents(row.principal),
        monthlyAmortization: cents(row.monthlyAmortization),
        cutoffDeduction: cents(row.cutoffDeduction),
        remainingBalance: cents(row.remainingBalance),
        totalPaid: cents(row.totalPaid),
        status: row.status,
        startDate: row.startDate,
        endDate: row.endDate,
        notes: `Migrated from ${source} in batch #${batch.id}`,
      };
      const existingLoan = existingByKey.get(`${employee.id}:${row.referenceNo.toLowerCase()}`);
      if (existingLoan) {
        await db.update(employeeLoans).set(values).where(eq(employeeLoans.id, existingLoan.id));
      } else {
        await db.insert(employeeLoans).values({
          organizationId,
          employeeId: employee.id,
          referenceNo: row.referenceNo,
          ...values,
        });
      }
    }
  }

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Migration import completed",
    resource: fileName,
    metadata: {
      batchId: batch.id,
      source,
      kind,
      created: createdCount,
      updated: updatedCount,
      errors: rowErrors.length,
      duplicateCount,
      mappings: parsed.mappings,
      unmappedColumns: parsed.unmappedColumns,
    },
  });

  return Response.json({
    batchId: batch.id,
    dryRun: false,
    source,
    kind,
    fileName,
    totalRows: batch.totalRows,
    readyCount,
    attentionCount,
    duplicateCount,
    createdCount,
    updatedCount,
    errorCount: rowErrors.length,
    errors: rowErrors.slice(0, 50),
    mappings: parsed.mappings,
    unmappedColumns: parsed.unmappedColumns,
    seatUsage: seatInfo,
  });
}
