import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  legalEntities,
  orgUnits,
  payrollEntries,
  payrollRuns,
  workforceTimesheets,
} from "@/db/schema";
import { toCsv } from "@/lib/csv";

export const BI_EXPORT_MAX_ROWS = 50_000;
export const BI_EXPORT_MAX_DAYS = 366;
export const BI_EXPORT_SCHEMA_VERSION = "2026-10-07.1";

export type BiExportKey = "payroll_runs" | "payroll_entries" | "workforce_timesheets";
export type BiExportFormat = "json" | "csv" | "ndjson";

type BiColumn = { key: string; label: string; description: string };

export const BI_EXPORT_DEFINITIONS: Array<{
  key: BiExportKey;
  name: string;
  description: string;
  schemaVersion: string;
  columns: BiColumn[];
}> = [
  {
    key: "payroll_runs",
    name: "Payroll runs",
    description: "Payroll-run facts with legal-employer and organization-unit dimensions.",
    schemaVersion: BI_EXPORT_SCHEMA_VERSION,
    columns: [
      { key: "payrollRunId", label: "Payroll run ID", description: "Stable Linaw payroll-run identifier." },
      { key: "periodStart", label: "Period start", description: "Payroll period start date." },
      { key: "periodEnd", label: "Period end", description: "Payroll period end date." },
      { key: "payDate", label: "Pay date", description: "Payroll pay date." },
      { key: "periodLabel", label: "Period label", description: "Human-readable payroll period." },
      { key: "status", label: "Status", description: "Stored payroll-run status." },
      { key: "legalEntityCode", label: "Legal entity", description: "Legal-employer code when scoped." },
      { key: "orgUnitCode", label: "Organization unit", description: "Organization-unit code when scoped." },
      { key: "employeeCount", label: "Employees", description: "Stored payroll-run employee count." },
      { key: "grossPay", label: "Gross pay", description: "Stored gross payroll amount." },
      { key: "deductions", label: "Deductions", description: "Gross minus net from the stored payroll run." },
      { key: "netPay", label: "Net pay", description: "Stored net payroll amount." },
      { key: "exceptions", label: "Exceptions", description: "Stored payroll-run exception count." },
      { key: "ruleVersion", label: "Rule version", description: "Payroll rule version recorded on the run." },
    ],
  },
  {
    key: "payroll_entries",
    name: "Payroll employee facts",
    description: "Employee-level payroll facts without bank, tax-registration, or government-member identifiers.",
    schemaVersion: BI_EXPORT_SCHEMA_VERSION,
    columns: [
      { key: "payrollRunId", label: "Payroll run ID", description: "Stable Linaw payroll-run identifier." },
      { key: "payDate", label: "Pay date", description: "Payroll pay date." },
      { key: "periodStart", label: "Period start", description: "Payroll period start date." },
      { key: "periodEnd", label: "Period end", description: "Payroll period end date." },
      { key: "employeeId", label: "Employee ID", description: "Stable Linaw employee identifier." },
      { key: "employeeNo", label: "Employee number", description: "Employer-assigned employee number." },
      { key: "employeeName", label: "Employee name", description: "Employee display name." },
      { key: "legalEntityCode", label: "Payroll legal entity", description: "Legal-employer code stored on the payroll run." },
      { key: "orgUnitCode", label: "Payroll scope unit", description: "Organization-unit code stored as the payroll-run scope; blank for company-wide runs." },
      { key: "grossPay", label: "Gross pay", description: "Stored employee gross pay." },
      { key: "deductions", label: "Deductions", description: "Stored employee deductions." },
      { key: "netPay", label: "Net pay", description: "Stored employee net pay." },
      { key: "status", label: "Entry status", description: "Stored payroll-entry status." },
    ],
  },
  {
    key: "workforce_timesheets",
    name: "Workforce timesheets",
    description: "Versioned workforce-time facts and evidence hashes without raw attendance snapshots.",
    schemaVersion: BI_EXPORT_SCHEMA_VERSION,
    columns: [
      { key: "timesheetId", label: "Timesheet ID", description: "Stable timesheet identifier." },
      { key: "employeeId", label: "Employee ID", description: "Stable Linaw employee identifier." },
      { key: "employeeNo", label: "Employee number", description: "Employer-assigned employee number." },
      { key: "employeeName", label: "Employee name", description: "Employee display name." },
      { key: "currentLegalEntityCode", label: "Current legal entity", description: "Employee legal-employer code at export time; not a historical timesheet snapshot." },
      { key: "currentOrgUnitCode", label: "Current organization unit", description: "Employee organization-unit code at export time; not a historical timesheet snapshot." },
      { key: "periodStart", label: "Period start", description: "Timesheet period start date." },
      { key: "periodEnd", label: "Period end", description: "Timesheet period end date." },
      { key: "version", label: "Version", description: "Immutable timesheet version." },
      { key: "status", label: "Status", description: "Stored timesheet approval status." },
      { key: "scheduledMinutes", label: "Scheduled minutes", description: "Stored scheduled minutes." },
      { key: "workedMinutes", label: "Worked minutes", description: "Stored worked minutes." },
      { key: "overtimeMinutes", label: "Overtime minutes", description: "Stored overtime minutes." },
      { key: "exceptionCount", label: "Exceptions", description: "Stored exception count." },
      { key: "blockerCount", label: "Blockers", description: "Stored blocking exception count." },
      { key: "snapshotHash", label: "Evidence SHA-256", description: "Hash of the immutable workforce evidence snapshot." },
    ],
  },
];

export type BiExportFilters = {
  startDate: string;
  endDate: string;
  legalEntityId?: number | null;
  orgUnitId?: number | null;
  dynamicGroupCode?: string | null;
};

type BiRow = Record<string, string | number | null>;

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function inclusiveDays(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function validateBiExportFilters(filters: BiExportFilters) {
  if (!validIsoDate(filters.startDate) || !validIsoDate(filters.endDate)) {
    return "startDate and endDate must be valid calendar dates using YYYY-MM-DD.";
  }
  const days = inclusiveDays(filters.startDate, filters.endDate);
  if (days == null || days < 1) return "endDate must be on or after startDate.";
  if (days > BI_EXPORT_MAX_DAYS) return `BI exports are limited to ${BI_EXPORT_MAX_DAYS} days per request.`;
  if (filters.legalEntityId != null && !Number.isInteger(filters.legalEntityId)) return "legalEntityId must be an integer.";
  if (filters.orgUnitId != null && !Number.isInteger(filters.orgUnitId)) return "orgUnitId must be an integer.";
  return null;
}

export function biExportDefinition(key: string) {
  return BI_EXPORT_DEFINITIONS.find((definition) => definition.key === key) ?? null;
}

async function payrollRunRows(organizationId: number, filters: BiExportFilters): Promise<BiRow[]> {
  const conditions = [
    eq(payrollRuns.organizationId, organizationId),
    gte(payrollRuns.payDate, filters.startDate),
    lte(payrollRuns.payDate, filters.endDate),
  ];
  if (filters.legalEntityId != null) conditions.push(eq(payrollRuns.legalEntityId, filters.legalEntityId));
  if (filters.orgUnitId != null) conditions.push(eq(payrollRuns.scopeOrgUnitId, filters.orgUnitId));

  const rows = await db.select({
    id: payrollRuns.id,
    periodStart: payrollRuns.periodStart,
    periodEnd: payrollRuns.periodEnd,
    payDate: payrollRuns.payDate,
    periodLabel: payrollRuns.periodLabel,
    status: payrollRuns.status,
    legalEntityCode: legalEntities.code,
    orgUnitCode: orgUnits.code,
    employeeCount: payrollRuns.employeeCount,
    grossPay: payrollRuns.grossPay,
    netPay: payrollRuns.netPay,
    exceptions: payrollRuns.exceptions,
    ruleVersion: payrollRuns.ruleVersion,
  }).from(payrollRuns)
    .leftJoin(legalEntities, eq(payrollRuns.legalEntityId, legalEntities.id))
    .leftJoin(orgUnits, eq(payrollRuns.scopeOrgUnitId, orgUnits.id))
    .where(and(...conditions))
    .orderBy(desc(payrollRuns.payDate), desc(payrollRuns.id))
    .limit(BI_EXPORT_MAX_ROWS + 1);

  return rows.map((row) => ({
    payrollRunId: row.id,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    payDate: row.payDate,
    periodLabel: row.periodLabel,
    status: row.status,
    legalEntityCode: row.legalEntityCode ?? "",
    orgUnitCode: row.orgUnitCode ?? "",
    employeeCount: row.employeeCount,
    grossPay: Number(row.grossPay).toFixed(2),
    deductions: (Number(row.grossPay) - Number(row.netPay)).toFixed(2),
    netPay: Number(row.netPay).toFixed(2),
    exceptions: row.exceptions,
    ruleVersion: row.ruleVersion,
  }));
}

async function payrollEntryRows(organizationId: number, filters: BiExportFilters, employeeIds?: number[] | null): Promise<BiRow[]> {
  if (employeeIds && employeeIds.length === 0) return [];
  const conditions = [
    eq(payrollRuns.organizationId, organizationId),
    gte(payrollRuns.payDate, filters.startDate),
    lte(payrollRuns.payDate, filters.endDate),
  ];
  if (filters.legalEntityId != null) conditions.push(eq(payrollRuns.legalEntityId, filters.legalEntityId));
  if (filters.orgUnitId != null) conditions.push(eq(payrollRuns.scopeOrgUnitId, filters.orgUnitId));
  if (employeeIds) conditions.push(inArray(payrollEntries.employeeId, employeeIds));

  const rows = await db.select({
    payrollRunId: payrollRuns.id,
    payDate: payrollRuns.payDate,
    periodStart: payrollRuns.periodStart,
    periodEnd: payrollRuns.periodEnd,
    employeeId: employees.id,
    employeeNo: employees.employeeNo,
    firstName: employees.firstName,
    lastName: employees.lastName,
    legalEntityCode: legalEntities.code,
    orgUnitCode: orgUnits.code,
    grossPay: payrollEntries.grossPay,
    deductions: payrollEntries.deductions,
    netPay: payrollEntries.netPay,
    status: payrollEntries.status,
  }).from(payrollEntries)
    .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
    .innerJoin(employees, eq(payrollEntries.employeeId, employees.id))
    .leftJoin(legalEntities, eq(payrollRuns.legalEntityId, legalEntities.id))
    .leftJoin(orgUnits, eq(payrollRuns.scopeOrgUnitId, orgUnits.id))
    .where(and(...conditions))
    .orderBy(desc(payrollRuns.payDate), payrollRuns.id, employees.employeeNo)
    .limit(BI_EXPORT_MAX_ROWS + 1);

  return rows.map((row) => ({
    payrollRunId: row.payrollRunId,
    payDate: row.payDate,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    employeeId: row.employeeId,
    employeeNo: row.employeeNo,
    employeeName: `${row.firstName} ${row.lastName}`,
    legalEntityCode: row.legalEntityCode ?? "",
    orgUnitCode: row.orgUnitCode ?? "",
    grossPay: Number(row.grossPay).toFixed(2),
    deductions: Number(row.deductions).toFixed(2),
    netPay: Number(row.netPay).toFixed(2),
    status: row.status,
  }));
}

async function timesheetRows(organizationId: number, filters: BiExportFilters, employeeIds?: number[] | null): Promise<BiRow[]> {
  if (employeeIds && employeeIds.length === 0) return [];
  const conditions = [
    eq(workforceTimesheets.organizationId, organizationId),
    lte(workforceTimesheets.periodStart, filters.endDate),
    gte(workforceTimesheets.periodEnd, filters.startDate),
  ];
  if (filters.legalEntityId != null) conditions.push(eq(employees.legalEntityId, filters.legalEntityId));
  if (filters.orgUnitId != null) conditions.push(eq(employees.orgUnitId, filters.orgUnitId));
  if (employeeIds) conditions.push(inArray(workforceTimesheets.employeeId, employeeIds));

  const rows = await db.select({
    id: workforceTimesheets.id,
    employeeId: employees.id,
    employeeNo: employees.employeeNo,
    firstName: employees.firstName,
    lastName: employees.lastName,
    currentLegalEntityCode: legalEntities.code,
    currentOrgUnitCode: orgUnits.code,
    periodStart: workforceTimesheets.periodStart,
    periodEnd: workforceTimesheets.periodEnd,
    version: workforceTimesheets.version,
    status: workforceTimesheets.status,
    scheduledMinutes: workforceTimesheets.scheduledMinutes,
    workedMinutes: workforceTimesheets.workedMinutes,
    overtimeMinutes: workforceTimesheets.overtimeMinutes,
    exceptionCount: workforceTimesheets.exceptionCount,
    blockerCount: workforceTimesheets.blockerCount,
    snapshotHash: workforceTimesheets.snapshotHash,
  }).from(workforceTimesheets)
    .innerJoin(employees, eq(workforceTimesheets.employeeId, employees.id))
    .leftJoin(legalEntities, eq(employees.legalEntityId, legalEntities.id))
    .leftJoin(orgUnits, eq(employees.orgUnitId, orgUnits.id))
    .where(and(...conditions))
    .orderBy(desc(workforceTimesheets.periodEnd), employees.employeeNo, desc(workforceTimesheets.version))
    .limit(BI_EXPORT_MAX_ROWS + 1);

  return rows.map((row) => ({
    timesheetId: row.id,
    employeeId: row.employeeId,
    employeeNo: row.employeeNo,
    employeeName: `${row.firstName} ${row.lastName}`,
    currentLegalEntityCode: row.currentLegalEntityCode ?? "",
    currentOrgUnitCode: row.currentOrgUnitCode ?? "",
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    version: row.version,
    status: row.status,
    scheduledMinutes: row.scheduledMinutes,
    workedMinutes: row.workedMinutes,
    overtimeMinutes: row.overtimeMinutes,
    exceptionCount: row.exceptionCount,
    blockerCount: row.blockerCount,
    snapshotHash: row.snapshotHash,
  }));
}

export async function runBiExport(input: {
  key: BiExportKey;
  organizationId: number;
  filters: BiExportFilters;
  employeeIds?: number[] | null;
}) {
  const definition = biExportDefinition(input.key);
  if (!definition) throw new Error("Unknown BI export dataset.");

  const rows =
    input.key === "payroll_runs"
      ? await payrollRunRows(input.organizationId, input.filters)
      : input.key === "payroll_entries"
        ? await payrollEntryRows(input.organizationId, input.filters, input.employeeIds)
        : await timesheetRows(input.organizationId, input.filters, input.employeeIds);

  if (rows.length > BI_EXPORT_MAX_ROWS) {
    throw new Error(`BI export exceeds the ${BI_EXPORT_MAX_ROWS.toLocaleString("en-US")} row limit. Narrow the date or scope filters.`);
  }

  return { definition, rows };
}

export function serializeBiExport(input: {
  key: BiExportKey;
  format: BiExportFormat;
  filters: BiExportFilters;
  rows: BiRow[];
}) {
  const definition = biExportDefinition(input.key);
  if (!definition) throw new Error("Unknown BI export dataset.");

  const generatedAt = new Date().toISOString();
  const columns = definition.columns.map((column) => column.key);
  const rowArrays = input.rows.map((row) => columns.map((column) => String(row[column] ?? "")));
  const payload =
    input.format === "csv"
      ? toCsv({ columns, rows: rowArrays })
      : input.format === "ndjson"
        ? input.rows.map((row) => JSON.stringify(row)).join("\n")
        : JSON.stringify({
            manifest: {
              dataset: input.key,
              schemaVersion: definition.schemaVersion,
              generatedAt,
              filters: input.filters,
              rowCount: input.rows.length,
            },
            columns: definition.columns,
            rows: input.rows,
          });
  const sha256 = createHash("sha256").update(payload, "utf8").digest("hex");

  return {
    payload,
    sha256,
    generatedAt,
    rowCount: input.rows.length,
    schemaVersion: definition.schemaVersion,
  };
}
