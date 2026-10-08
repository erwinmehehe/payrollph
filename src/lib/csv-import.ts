import { WAGE_ORDERS } from "@/lib/wage-orders";

export type ImportRow = Record<string, string>;

export type ParsedEmployee = {
  employeeNo: string;
  firstName: string;
  lastName: string;
  title: string;
  employmentType: string;
  status: "Active" | "On leave";
  startDate: string;
  monthlyBasic: number;
  mwe: boolean;
  region: string;
  email: string | null;
  mobile: string | null;
  bankAccount: string | null;
  bankCode: string | null;
};

export const IMPORT_COLUMNS: Record<string, keyof ParsedEmployee> = {
  "employee no": "employeeNo",
  employeeno: "employeeNo",
  employee_no: "employeeNo",
  "first name": "firstName",
  firstname: "firstName",
  "last name": "lastName",
  lastname: "lastName",
  title: "title",
  position: "title",
  "employment type": "employmentType",
  status: "status",
  "start date": "startDate",
  "hire date": "startDate",
  "employment start date": "startDate",
  startdate: "startDate",
  "monthly basic": "monthlyBasic",
  "monthly basic pay": "monthlyBasic",
  basic: "monthlyBasic",
  "basic pay": "monthlyBasic",
  mwe: "mwe",
  region: "region",
  email: "email",
  mobile: "mobile",
  "bank account": "bankAccount",
  "bank code": "bankCode",
};

const REGIONS = new Set(WAGE_ORDERS.map((row) => row.region));
const REQUIRED_COLUMNS = ["employeeNo", "firstName", "lastName", "startDate", "monthlyBasic"] as const;

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Minimal RFC-4180-ish CSV reader: quoted fields, doubled quotes and CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(field); field = ""; continue; }
    if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (char === "\r") continue;
    field += char;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ""));
}

function headerKey(header: string) {
  return header.trim().toLowerCase();
}

export function mapHeaders(headers: string[]) {
  const map = new Map<number, keyof ParsedEmployee>();
  headers.forEach((header, index) => {
    const key = IMPORT_COLUMNS[headerKey(header)];
    if (key) map.set(index, key);
  });
  return map;
}

/** Validate exact worker attributes; never infer an employment date or exit action. */
export function parseEmployeeRow(row: ImportRow): { ok: true; value: ParsedEmployee } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const str = (key: string) => (row[key] ?? "").trim();

  const employeeNo = str("employeeNo");
  if (!employeeNo) problems.push("employeeNo is required");
  else if (employeeNo.length > 32) problems.push("employeeNo exceeds 32 characters");

  const firstName = str("firstName");
  const lastName = str("lastName");
  if (!firstName) problems.push("firstName is required");
  if (!lastName) problems.push("lastName is required");
  if (firstName.length > 80) problems.push("firstName exceeds 80 characters");
  if (lastName.length > 80) problems.push("lastName exceeds 80 characters");

  const title = str("title") || "Staff";
  if (title.length > 120) problems.push("title exceeds 120 characters");
  const employmentType = str("employmentType") || "Regular";
  if (employmentType.length > 32) problems.push("employmentType exceeds 32 characters");

  const statusInput = str("status").toLowerCase();
  const status = statusInput === "on leave" ? "On leave" : "Active";
  if (statusInput && statusInput !== "active" && statusInput !== "on leave") {
    problems.push("status must be Active or On leave; use governed lifecycle/migration for separations");
  }

  const startDate = str("startDate");
  if (!isCalendarDate(startDate)) {
    problems.push("startDate (hire date) must be a real YYYY-MM-DD date; it is never inferred from the import date");
  }

  const monthlyRaw = str("monthlyBasic").replace(/[,₱\s]/g, "");
  const monthlyBasic = Number(monthlyRaw);
  if (!monthlyRaw) problems.push("monthlyBasic is required");
  else if (!Number.isFinite(monthlyBasic)) problems.push(`monthlyBasic "${str("monthlyBasic")}" is not a number`);
  else if (monthlyBasic <= 0) problems.push("monthlyBasic must be greater than zero");
  else if (!/^\d+(?:\.\d{1,2})?$/.test(monthlyRaw)) {
    problems.push("monthlyBasic must have no more than two decimal places");
  } else if (monthlyBasic > 9_999_999_999.99) {
    problems.push("monthlyBasic exceeds supported payroll precision");
  }

  const region = (str("region") || "NCR").toUpperCase();
  if (!REGIONS.has(region)) {
    problems.push(`region "${region}" is not a supported wage region (${[...REGIONS].join(", ")})`);
  }

  const email = str("email").toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push(`email "${email}" is not valid`);
  if (email && email.length > 200) problems.push("email exceeds 200 characters");

  const mobile = str("mobile") || null;
  if (mobile && !/^09\d{9}$/.test(mobile)) problems.push(`mobile "${mobile}" must be 11 digits starting 09`);

  const bankAccount = str("bankAccount") || null;
  const bankCode = str("bankCode").toUpperCase() || null;
  if (bankAccount && !/^\d{6,20}$/.test(bankAccount)) {
    problems.push(`bankAccount "${bankAccount}" must be 6-20 digits`);
  }
  if (bankCode && bankCode.length > 16) problems.push("bankCode exceeds 16 characters");
  if (Boolean(bankAccount) !== Boolean(bankCode)) {
    problems.push("bankAccount and bankCode must be provided together");
  }

  const mweRaw = str("mwe").toLowerCase();
  const mweTrue = ["true", "yes", "y", "1"];
  const mweFalse = ["false", "no", "n", "0", ""];
  if (![...mweTrue, ...mweFalse].includes(mweRaw)) {
    problems.push("mwe must be yes/no, true/false, 1/0 or blank");
  }

  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    value: {
      employeeNo, firstName, lastName, title, employmentType, status, startDate,
      monthlyBasic, mwe: mweTrue.includes(mweRaw), region, email, mobile, bankAccount, bankCode,
    },
  };
}

/**
 * Keeps source CSV line numbers even when earlier lines fail validation.
 * Unknown extra columns remain accepted for legacy spreadsheet compatibility.
 */
export function parseEmployeeCsv(text: string) {
  const rows = parseCsv(text);
  const headers = rows[0] ?? [];
  const mapping = mapHeaders(headers);
  const unmapped = headers.filter((header) => !IMPORT_COLUMNS[headerKey(header)] && header.trim() !== "");
  const empty = {
    headers, mapped: [...mapping.values()], valid: [] as ParsedEmployee[],
    validRows: [] as Array<{ line: number; value: ParsedEmployee }>,
    errors: [] as Array<{ line: number; problems: string[] }>,
    unmapped,
  };
  if (rows.length < 2) {
    return { ...empty, errors: [{ line: 1, problems: ["CSV needs a header row and at least one data row"] }] };
  }

  const mapped = [...mapping.values()];
  const missing = REQUIRED_COLUMNS.filter((key) => !mapped.includes(key));
  if (missing.length) {
    return { ...empty, errors: [{ line: 1, problems: [`Missing required CSV columns: ${missing.join(", ")}`] }] };
  }

  const valid: ParsedEmployee[] = [];
  const validRows: Array<{ line: number; value: ParsedEmployee }> = [];
  const errors: Array<{ line: number; problems: string[] }> = [];
  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index];
    const record: ImportRow = {};
    for (const [cellIndex, key] of mapping) record[key] = cells[cellIndex] ?? "";
    const parsed = parseEmployeeRow(record);
    if (parsed.ok) {
      valid.push(parsed.value);
      validRows.push({ line: index + 1, value: parsed.value });
    } else {
      errors.push({ line: index + 1, problems: parsed.problems });
    }
  }
  return { headers, mapped, valid, validRows, errors, unmapped };
}
