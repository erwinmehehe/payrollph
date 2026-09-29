import { parseCsv } from "@/lib/csv-import";

export const MIGRATION_SOURCES = [
  { id: "sprout", label: "Sprout Solutions", note: "Employee List, Payroll Register, YTD and flat-file exports" },
  { id: "salarium", label: "Salarium", note: "Employee 201, payroll and attendance exports" },
  { id: "kami", label: "KAMI Workforce", note: "HRIS and payroll exports" },
  { id: "greatday", label: "GreatDay HR", note: "Employee and payroll exports" },
  { id: "payrollhero", label: "PayrollHero", note: "Employee, timekeeping and payroll exports" },
  { id: "omnihr", label: "Omni HR", note: "Employee and payroll exports" },
  { id: "jeonsoft", label: "JeonSoft", note: "Payroll and employee flat-file exports" },
  { id: "darwinbox", label: "Darwinbox", note: "Enterprise employee and payroll exports" },
  { id: "sunfish", label: "SunFish HR", note: "Employee and payroll exports" },
  { id: "oracle-hcm", label: "Oracle HCM", note: "Enterprise HCM flat-file exports" },
  { id: "employment-hero", label: "Employment Hero", note: "Employee and payroll CSV exports" },
  { id: "bamboohr", label: "BambooHR", note: "Employee directory exports" },
  { id: "zoho-people", label: "Zoho People", note: "Employee and leave exports" },
  { id: "workday", label: "Workday / SAP-style", note: "Enterprise HRIS flat-file exports" },
  { id: "generic", label: "Other software / CSV", note: "Smart header matching for any CSV export" },
] as const;

export type MigrationSource = (typeof MIGRATION_SOURCES)[number]["id"];
export type MigrationKind = "employees" | "payroll_history" | "leave_balances" | "loans";

export type MigrationError = { line: number; problems: string[] };

export type MigratedEmployee = {
  employeeNo: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  title: string;
  employmentType: string;
  status: string;
  monthlyBasic: number;
  mwe: boolean;
  region: string;
  email: string | null;
  mobile: string | null;
  bankAccount: string | null;
  bankCode: string | null;
  tin: string | null;
  tinBranchCode: string | null;
  sssNo: string | null;
  philHealthNo: string | null;
  pagIbigNo: string | null;
  startDate: string | null;
};

export type MigratedPayrollHistory = {
  employeeNo: string;
  payDate: string;
  periodLabel: string;
  sourceReference: string;
  grossPay: number;
  netPay: number;
  taxWithheld: number;
  sssEmployee: number;
  philHealthEmployee: number;
  pagIbigEmployee: number;
  thirteenthMonth: number;
};

export type MigratedLeaveBalance = {
  employeeNo: string;
  leaveType: string;
  year: number;
  opening: number;
  accrued: number;
  used: number;
  pending: number;
};

export type MigratedLoan = {
  employeeNo: string;
  loanType: string;
  referenceNo: string;
  principal: number;
  monthlyAmortization: number;
  cutoffDeduction: number;
  remainingBalance: number;
  totalPaid: number;
  status: string;
  startDate: string | null;
  endDate: string | null;
};

export type MigrationRow =
  | MigratedEmployee
  | MigratedPayrollHistory
  | MigratedLeaveBalance
  | MigratedLoan;

type TargetField =
  | keyof MigratedEmployee
  | keyof MigratedPayrollHistory
  | keyof MigratedLeaveBalance
  | keyof MigratedLoan
  | "fullName";

const COMMON_ALIASES: Record<string, string[]> = {
  employeeNo: ["employee no", "employee number", "employee id", "employee code", "employee #", "emp id", "emp no", "id", "system id", "personnel id"],
  firstName: ["first name", "firstname", "given name", "legal first name"],
  middleName: ["middle name", "middlename", "middle initial"],
  lastName: ["last name", "lastname", "surname", "family name", "legal last name"],
  fullName: ["employee name", "full name", "name"],
  title: ["title", "position", "job title", "designation", "role"],
  employmentType: ["employment type", "employee type", "worker type", "employment category", "contract type"],
  status: ["status", "employment status", "employee status", "work status"],
  monthlyBasic: ["monthly basic", "monthly basic pay", "basic pay", "basic salary", "monthly salary", "base salary", "salary", "monthly rate", "pay rate"],
  mwe: ["mwe", "minimum wage earner"],
  region: ["region", "work region", "work location", "location", "branch"],
  email: ["email", "email address", "work email", "company email"],
  mobile: ["mobile", "mobile no", "mobile number", "phone", "phone number", "contact number"],
  bankAccount: ["bank account", "bank account no", "bank account number", "account number", "payroll account", "payroll account no"],
  bankCode: ["bank code", "bank", "bank name"],
  tin: ["tin", "tax id", "tax identification number", "bir tin"],
  tinBranchCode: ["tin branch code", "bir branch code", "branch code"],
  sssNo: ["sss", "sss no", "sss number"],
  philHealthNo: ["philhealth", "philhealth no", "philhealth number", "philhealth pin", "pin"],
  pagIbigNo: ["pag-ibig", "pag ibig", "pagibig", "pag-ibig no", "pagibig no", "hdmf", "hdmf no", "mid"],
  startDate: ["start date", "hire date", "date hired", "hired date", "employment date"],
  payDate: ["pay date", "payroll date", "payment date", "date paid", "date"],
  periodLabel: ["period", "payroll period", "cutoff", "cut-off", "pay period", "period label"],
  sourceReference: ["reference", "reference no", "payroll run id", "run id", "payroll id", "batch id"],
  grossPay: ["gross", "gross pay", "gross salary", "gross compensation", "total gross", "gross earnings"],
  netPay: ["net", "net pay", "net salary", "take home pay", "take-home pay", "amount paid"],
  taxWithheld: ["withholding tax", "tax withheld", "wht", "bir tax", "income tax", "withholding"],
  sssEmployee: ["sss employee", "sss ee", "employee sss", "sss contribution"],
  philHealthEmployee: ["philhealth employee", "philhealth ee", "employee philhealth", "philhealth contribution"],
  pagIbigEmployee: ["pagibig employee", "pag-ibig employee", "hdmf employee", "pagibig ee", "pag-ibig contribution", "hdmf contribution"],
  thirteenthMonth: ["13th month", "13th month pay", "thirteenth month", "thirteenth month pay"],
  leaveType: ["leave type", "leave", "leave name", "leave category"],
  year: ["year", "leave year", "calendar year"],
  opening: ["opening", "opening balance", "beginning balance", "brought forward"],
  accrued: ["accrued", "earned", "entitlement", "credits"],
  used: ["used", "taken", "consumed"],
  pending: ["pending", "pending leave"],
  loanType: ["loan type", "loan", "loan name", "loan category"],
  referenceNo: ["reference no", "loan reference", "loan no", "loan number", "account no"],
  principal: ["principal", "loan amount", "original amount"],
  monthlyAmortization: ["monthly amortization", "monthly deduction", "amortization"],
  cutoffDeduction: ["cutoff deduction", "per cutoff", "per-cutoff", "payroll deduction"],
  remainingBalance: ["remaining balance", "balance", "loan balance", "outstanding balance"],
  totalPaid: ["total paid", "paid amount", "amount paid"],
  endDate: ["end date", "maturity date", "loan end date"],
};

const SOURCE_ALIASES: Partial<Record<MigrationSource, Record<string, string[]>>> = {
  sprout: {
    employeeNo: ["employee id", "employee id number", "payroll pie id"],
    monthlyBasic: ["basic salary"],
    startDate: ["hire date"],
    email: ["email address"],
    status: ["employment status"],
    periodLabel: ["payroll period", "payroll run"],
    sourceReference: ["payroll run id", "payroll run"],
  },
  salarium: {
    employeeNo: ["employee id", "employee code"],
    title: ["position"],
    startDate: ["date hired"],
    grossPay: ["gross pay", "gross income"],
    netPay: ["net pay"],
  },
  kami: {
    employeeNo: ["employee id", "employee code"],
    title: ["position", "job title"],
    monthlyBasic: ["basic salary", "monthly rate"],
  },
  greatday: {
    employeeNo: ["employee id", "employee number"],
    fullName: ["employee name"],
    monthlyBasic: ["basic salary", "base salary"],
    grossPay: ["gross salary"],
    netPay: ["net salary"],
  },
  payrollhero: {
    employeeNo: ["employee id", "employee number", "employee code"],
    monthlyBasic: ["basic salary", "monthly salary", "pay rate"],
  },
  omnihr: {
    employeeNo: ["employee id", "employee number"],
    monthlyBasic: ["base salary", "monthly salary"],
  },
  jeonsoft: {
    employeeNo: ["employee code", "employee id"],
    monthlyBasic: ["basic pay", "basic salary"],
  },
  darwinbox: {
    employeeNo: ["employee id", "employee code"],
    title: ["designation", "job title"],
    startDate: ["date of joining", "hire date"],
  },
  sunfish: {
    employeeNo: ["employee id", "employee no", "employee code"],
    monthlyBasic: ["basic salary", "basic pay"],
  },
  "oracle-hcm": {
    employeeNo: ["person number", "employee number", "employee id"],
    firstName: ["first name", "legal first name"],
    lastName: ["last name", "legal last name"],
    title: ["job name", "job title"],
    startDate: ["hire date", "enterprise hire date"],
  },
  "employment-hero": {
    employeeNo: ["employee id", "employee number"],
    monthlyBasic: ["primary pay rate", "annual salary", "base rate"],
  },
  bamboohr: {
    employeeNo: ["employee #", "employee number"],
    title: ["job title"],
    startDate: ["hire date"],
    monthlyBasic: ["pay rate"],
  },
  "zoho-people": {
    employeeNo: ["employee id"],
    title: ["designation"],
    startDate: ["date of joining"],
  },
  workday: {
    employeeNo: ["employee id", "worker id", "personnel number"],
    firstName: ["legal first name", "preferred first name"],
    lastName: ["legal last name"],
    title: ["business title", "job profile"],
    startDate: ["hire date"],
  },
};

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\/_-]+/g, " ")
    .replace(/[^a-z0-9# ]+/g, "")
    .replace(/\s+/g, " ");
}

function aliasesFor(source: MigrationSource, target: string) {
  return [
    ...(SOURCE_ALIASES[source]?.[target] ?? []),
    ...(COMMON_ALIASES[target] ?? []),
    target,
  ].map(normalize);
}

function mapHeaders(headers: string[], source: MigrationSource, fields: TargetField[]) {
  const normalized = headers.map(normalize);
  const mapping = new Map<TargetField, number>();

  for (const field of fields) {
    const aliases = aliasesFor(source, field);
    const index = normalized.findIndex((header) => aliases.includes(header));
    if (index >= 0) mapping.set(field, index);
  }
  return mapping;
}

function numberValue(value: string | undefined, fallback = 0) {
  const raw = (value ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function dateValue(value: string | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function boolValue(value: string | undefined) {
  return ["1", "true", "yes", "y"].includes((value ?? "").trim().toLowerCase());
}

function digitsOrNull(value: string | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits || null;
}

function splitName(fullName: string) {
  const cleaned = fullName.trim().replace(/\s+/g, " ");
  if (!cleaned) return { firstName: "", lastName: "" };
  if (cleaned.includes(",")) {
    const [lastName, rest] = cleaned.split(",", 2);
    return { firstName: rest.trim(), lastName: lastName.trim() };
  }
  const parts = cleaned.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) ?? "" };
}

function normalizeEmployeeStatus(value: string) {
  const status = value.trim().toLowerCase();
  if (!status) return "Active";
  if (status.includes("leave")) return "On leave";
  if (["resigned", "terminated", "inactive", "separated", "awol", "end of contract"].some((term) => status.includes(term))) {
    return "Separating";
  }
  return "Active";
}

function rowRecord(headers: string[], cells: string[]) {
  return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
}

function parseEmployee(
  get: (field: TargetField) => string,
): { value?: MigratedEmployee; problems: string[] } {
  const problems: string[] = [];
  const fullName = splitName(get("fullName"));
  const employeeNo = get("employeeNo").trim();
  const firstName = get("firstName").trim() || fullName.firstName;
  const lastName = get("lastName").trim() || fullName.lastName;
  const monthlyBasic = numberValue(get("monthlyBasic"));

  if (!employeeNo) problems.push("employee number / ID is required");
  if (!firstName) problems.push("first name is required");
  if (!lastName) problems.push("last name is required");
  if (!Number.isFinite(monthlyBasic) || monthlyBasic <= 0) problems.push("monthly basic salary must be greater than zero");

  const email = get("email").trim() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push(`email "${email}" is not valid`);

  const startDateRaw = get("startDate").trim();
  const startDate = dateValue(startDateRaw);
  if (startDateRaw && !startDate) problems.push(`start date "${startDateRaw}" is not valid`);

  if (problems.length) return { problems };

  return {
    problems,
    value: {
      employeeNo,
      firstName,
      middleName: get("middleName").trim() || null,
      lastName,
      title: get("title").trim() || "Staff",
      employmentType: get("employmentType").trim() || "Regular",
      status: normalizeEmployeeStatus(get("status")),
      monthlyBasic,
      mwe: boolValue(get("mwe")),
      region: get("region").trim() || "NCR",
      email,
      mobile: digitsOrNull(get("mobile")),
      bankAccount: digitsOrNull(get("bankAccount")),
      bankCode: get("bankCode").trim() || null,
      tin: digitsOrNull(get("tin")),
      tinBranchCode: digitsOrNull(get("tinBranchCode")),
      sssNo: digitsOrNull(get("sssNo")),
      philHealthNo: digitsOrNull(get("philHealthNo")),
      pagIbigNo: digitsOrNull(get("pagIbigNo")),
      startDate,
    },
  };
}

function parsePayrollHistory(
  get: (field: TargetField) => string,
): { value?: MigratedPayrollHistory; problems: string[] } {
  const problems: string[] = [];
  const employeeNo = get("employeeNo").trim();
  const rawPayDate = get("payDate").trim();
  const payDate = dateValue(rawPayDate);
  const grossPay = numberValue(get("grossPay"));
  const netPay = numberValue(get("netPay"));

  if (!employeeNo) problems.push("employee number / ID is required");
  if (!payDate) problems.push(`pay date "${rawPayDate || "(blank)"}" is not valid`);
  if (!Number.isFinite(grossPay) || grossPay < 0) problems.push("gross pay must be zero or greater");
  if (!Number.isFinite(netPay) || netPay < 0) problems.push("net pay must be zero or greater");

  const optional = {
    taxWithheld: numberValue(get("taxWithheld")),
    sssEmployee: numberValue(get("sssEmployee")),
    philHealthEmployee: numberValue(get("philHealthEmployee")),
    pagIbigEmployee: numberValue(get("pagIbigEmployee")),
    thirteenthMonth: numberValue(get("thirteenthMonth")),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (!Number.isFinite(value) || value < 0) problems.push(`${key} must be zero or greater`);
  }

  if (problems.length || !payDate) return { problems };
  const periodLabel = get("periodLabel").trim() || payDate;
  return {
    problems,
    value: {
      employeeNo,
      payDate,
      periodLabel,
      sourceReference: get("sourceReference").trim() || `${payDate}:${periodLabel}`,
      grossPay,
      netPay,
      ...optional,
    },
  };
}

function parseLeaveBalance(
  get: (field: TargetField) => string,
): { value?: MigratedLeaveBalance; problems: string[] } {
  const problems: string[] = [];
  const employeeNo = get("employeeNo").trim();
  const leaveType = get("leaveType").trim();
  const year = Math.trunc(numberValue(get("year"), new Date().getFullYear()));
  const opening = numberValue(get("opening"));
  const accrued = numberValue(get("accrued"));
  const used = numberValue(get("used"));
  const pending = numberValue(get("pending"));

  if (!employeeNo) problems.push("employee number / ID is required");
  if (!leaveType) problems.push("leave type is required");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) problems.push("leave year is invalid");
  for (const [key, value] of Object.entries({ opening, accrued, used, pending })) {
    if (!Number.isFinite(value) || value < 0) problems.push(`${key} must be zero or greater`);
  }
  return problems.length ? { problems } : { problems, value: { employeeNo, leaveType, year, opening, accrued, used, pending } };
}

function parseLoan(
  get: (field: TargetField) => string,
): { value?: MigratedLoan; problems: string[] } {
  const problems: string[] = [];
  const employeeNo = get("employeeNo").trim();
  const loanType = get("loanType").trim();
  const remainingBalance = numberValue(get("remainingBalance"));
  const principalRaw = numberValue(get("principal"), remainingBalance);
  const monthly = numberValue(get("monthlyAmortization"));
  const cutoffRaw = numberValue(get("cutoffDeduction"), monthly > 0 ? monthly / 2 : 0);
  const totalPaid = numberValue(get("totalPaid"));
  const startDateRaw = get("startDate").trim();
  const endDateRaw = get("endDate").trim();
  const startDate = dateValue(startDateRaw);
  const endDate = dateValue(endDateRaw);

  if (!employeeNo) problems.push("employee number / ID is required");
  if (!loanType) problems.push("loan type is required");
  if (!Number.isFinite(remainingBalance) || remainingBalance < 0) problems.push("remaining balance must be zero or greater");
  if (!Number.isFinite(principalRaw) || principalRaw < remainingBalance) problems.push("principal must be at least the remaining balance");
  if (!Number.isFinite(monthly) || monthly < 0) problems.push("monthly amortization must be zero or greater");
  if (!Number.isFinite(cutoffRaw) || cutoffRaw < 0) problems.push("cutoff deduction must be zero or greater");
  if (!Number.isFinite(totalPaid) || totalPaid < 0) problems.push("total paid must be zero or greater");
  if (startDateRaw && !startDate) problems.push("loan start date is invalid");
  if (endDateRaw && !endDate) problems.push("loan end date is invalid");

  const referenceNo = get("referenceNo").trim() || `MIG-${employeeNo}-${loanType.replace(/\s+/g, "-").toUpperCase()}`;
  const statusRaw = get("status").trim().toLowerCase();
  const status = remainingBalance <= 0 ? "paid_off" : statusRaw.includes("pause") ? "paused" : "active";

  return problems.length
    ? { problems }
    : {
        problems,
        value: {
          employeeNo,
          loanType,
          referenceNo,
          principal: principalRaw,
          monthlyAmortization: monthly,
          cutoffDeduction: cutoffRaw,
          remainingBalance,
          totalPaid,
          status,
          startDate,
          endDate,
        },
      };
}

const KIND_FIELDS: Record<MigrationKind, TargetField[]> = {
  employees: [
    "employeeNo", "firstName", "middleName", "lastName", "fullName", "title", "employmentType", "status",
    "monthlyBasic", "mwe", "region", "email", "mobile", "bankAccount", "bankCode", "tin", "tinBranchCode",
    "sssNo", "philHealthNo", "pagIbigNo", "startDate",
  ],
  payroll_history: [
    "employeeNo", "payDate", "periodLabel", "sourceReference", "grossPay", "netPay", "taxWithheld",
    "sssEmployee", "philHealthEmployee", "pagIbigEmployee", "thirteenthMonth",
  ],
  leave_balances: ["employeeNo", "leaveType", "year", "opening", "accrued", "used", "pending"],
  loans: [
    "employeeNo", "loanType", "referenceNo", "principal", "monthlyAmortization", "cutoffDeduction",
    "remainingBalance", "totalPaid", "status", "startDate", "endDate",
  ],
};

export function parseMigrationCsv(input: { csv: string; source: MigrationSource; kind: MigrationKind }) {
  const rows = parseCsv(input.csv);
  if (rows.length < 2) {
    return {
      headers: rows[0] ?? [],
      rows: [] as MigrationRow[],
      errors: [{ line: 1, problems: ["CSV needs a header row and at least one data row"] }] as MigrationError[],
      unmappedColumns: rows[0] ?? [],
      mappings: {} as Record<string, string>,
    };
  }

  const headers = rows[0];
  const fields = KIND_FIELDS[input.kind];
  const mapping = mapHeaders(headers, input.source, fields);
  const usedIndexes = new Set(mapping.values());
  const unmappedColumns = headers.filter((header, index) => header.trim() && !usedIndexes.has(index));
  const mappings = Object.fromEntries(Array.from(mapping.entries()).map(([field, index]) => [field, headers[index]]));

  const valid: MigrationRow[] = [];
  const errors: MigrationError[] = [];

  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index];
    const record = rowRecord(headers, cells);
    void record;
    const get = (field: TargetField) => {
      const column = mapping.get(field);
      return column == null ? "" : cells[column] ?? "";
    };

    const parsed =
      input.kind === "employees"
        ? parseEmployee(get)
        : input.kind === "payroll_history"
          ? parsePayrollHistory(get)
          : input.kind === "leave_balances"
            ? parseLeaveBalance(get)
            : parseLoan(get);

    if (parsed.value) valid.push(parsed.value);
    else errors.push({ line: index + 1, problems: parsed.problems });
  }

  return { headers, rows: valid, errors, unmappedColumns, mappings };
}
