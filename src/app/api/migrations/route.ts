import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employeeLoans,
  employees,
  historicalPayrollEntries,
  importBatches,
  leaveBalances,
} from "@/db/schema";
import { ORG_ADMIN_ROLES, assertOrganizationRole } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { ensureMigrationSchema } from "@/lib/migration-schema";
import { getEntitlements, requireFeature, seatUsage } from "@/lib/billing";
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
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const source = String(body.source ?? "generic") as MigrationSource;
  const kind = String(body.kind ?? "employees") as MigrationKind;
  const csv = typeof body.csv === "string" ? body.csv : "";
  const fileName = String(body.fileName ?? "migration.csv").slice(0, 200);
  const dryRun = body.dryRun !== false;

  if (!Number.isInteger(organizationId) || !csv.trim()) {
    return Response.json({ error: "organizationId and csv content are required." }, { status: 400 });
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

  const entitlements = await getEntitlements(organizationId);
  const gate = requireFeature(entitlements, "imports");
  if (gate) return gate;

  const parsed = parseMigrationCsv({ csv, source, kind });
  const rowErrors = [...parsed.errors];

  const staff = await db.select().from(employees).where(eq(employees.organizationId, organizationId));
  const employeeByNo = new Map(staff.map((employee) => [employee.employeeNo.trim().toLowerCase(), employee]));

  let createdCount = 0;
  let updatedCount = 0;
  let seatInfo: { used: number; limit: number | null } | undefined;

  if (kind === "employees") {
    const rows = parsed.rows as MigratedEmployee[];
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
    const rows = parsed.rows as MigratedPayrollHistory[];
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
        rowErrors.push({ line: 0, problems: [`Employee "${row.employeeNo}" does not exist yet. Import employees first.`] });
        continue;
      }
      if (existingKeys.has(`${employee.id}:${row.sourceReference}`)) updatedCount += 1;
      else createdCount += 1;
    }
  }

  if (kind === "leave_balances") {
    const rows = parsed.rows as MigratedLeaveBalance[];
    const existing = await db.select().from(leaveBalances).where(eq(leaveBalances.organizationId, organizationId));
    const existingKeys = new Set(existing.map((row) => `${row.employeeId}:${row.leaveType.toLowerCase()}:${row.year}`));

    for (const row of rows) {
      const employee = employeeByNo.get(row.employeeNo.toLowerCase());
      if (!employee) {
        rowErrors.push({ line: 0, problems: [`Employee "${row.employeeNo}" does not exist yet. Import employees first.`] });
        continue;
      }
      const key = `${employee.id}:${row.leaveType.toLowerCase()}:${row.year}`;
      if (existingKeys.has(key)) updatedCount += 1;
      else createdCount += 1;
    }
  }

  if (kind === "loans") {
    const rows = parsed.rows as MigratedLoan[];
    const existing = await db.select().from(employeeLoans).where(eq(employeeLoans.organizationId, organizationId));
    const existingKeys = new Set(existing.map((row) => `${row.employeeId}:${row.referenceNo.toLowerCase()}`));

    for (const row of rows) {
      const employee = employeeByNo.get(row.employeeNo.toLowerCase());
      if (!employee) {
        rowErrors.push({ line: 0, problems: [`Employee "${row.employeeNo}" does not exist yet. Import employees first.`] });
        continue;
      }
      const key = `${employee.id}:${row.referenceNo.toLowerCase()}`;
      if (existingKeys.has(key)) updatedCount += 1;
      else createdCount += 1;
    }
  }

  if (parsed.rows.length === 0 && rowErrors.length > 0) {
    return Response.json({
      error: "No valid rows found.",
      dryRun,
      source,
      kind,
      totalRows: parsed.errors.length,
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
      totalRows: parsed.rows.length + parsed.errors.length,
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
    totalRows: parsed.rows.length + parsed.errors.length,
    createdCount,
    updatedCount,
    errorCount: rowErrors.length,
    status: rowErrors.length > 0 ? "partial" : "completed",
    errors: rowErrors.slice(0, 100),
    createdBy: user.name,
  }).returning();

  if (kind === "employees") {
    const rows = parsed.rows as MigratedEmployee[];
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
      if (existing) {
        await db.update(employees).set(values).where(and(
          eq(employees.organizationId, organizationId),
          eq(employees.id, existing.id),
        ));
      } else {
        await db.insert(employees).values({
          organizationId,
          employeeNo: row.employeeNo,
          ...values,
          avatarInitials: `${row.firstName[0] ?? "?"}${row.lastName[0] ?? "?"}`.toUpperCase(),
          startDate: row.startDate ?? today(),
        });
      }
    }
  }

  if (kind === "payroll_history") {
    const rows = parsed.rows as MigratedPayrollHistory[];
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
    const rows = parsed.rows as MigratedLeaveBalance[];
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
    const rows = parsed.rows as MigratedLoan[];
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
    createdCount,
    updatedCount,
    errorCount: rowErrors.length,
    errors: rowErrors.slice(0, 50),
    mappings: parsed.mappings,
    unmappedColumns: parsed.unmappedColumns,
    seatUsage: seatInfo,
  });
}
