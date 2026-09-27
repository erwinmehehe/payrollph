export type ImportRow = Record<string, string>;

export type ParsedEmployee = {
  employeeNo: string;
  firstName: string;
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
};

export const IMPORT_COLUMNS: Record<string, keyof ParsedEmployee> = {
  "employee no": "employeeNo",
  employeeno: "employeeNo",
  "employee_no": "employeeNo",
  "first name": "firstName",
  firstname: "firstName",
  "last name": "lastName",
  lastname: "lastName",
  title: "title",
  position: "title",
  "employment type": "employmentType",
  status: "status",
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

const REGIONS = ["NCR", "III", "IV-A", "VII", "XI"];

/** Minimal RFC-4180-ish CSV reader: quoted fields, doubled quotes, CRLF. */
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

/** Validates one row. Returns the parsed employee or a list of specific problems. */
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

  const monthlyRaw = str("monthlyBasic").replace(/[,₱\s]/g, "");
  const monthlyBasic = Number(monthlyRaw);
  if (!monthlyRaw) problems.push("monthlyBasic is required");
  else if (!Number.isFinite(monthlyBasic)) problems.push(`monthlyBasic "${str("monthlyBasic")}" is not a number`);
  else if (monthlyBasic <= 0) problems.push("monthlyBasic must be greater than zero");

  const region = str("region") || "NCR";
  if (!REGIONS.includes(region)) problems.push(`region "${region}" is not a supported wage region (${REGIONS.join(", ")})`);

  const email = str("email") || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push(`email "${email}" is not valid`);

  const mobile = str("mobile") || null;
  if (mobile && !/^09\d{9}$/.test(mobile)) problems.push(`mobile "${mobile}" must be 11 digits starting 09`);

  const bankAccount = str("bankAccount") || null;
  if (bankAccount && !/^\d{6,20}$/.test(bankAccount)) problems.push(`bankAccount "${bankAccount}" must be 6-20 digits`);

  const mweRaw = str("mwe").toLowerCase();
  const mwe = mweRaw === "true" || mweRaw === "yes" || mweRaw === "y" || mweRaw === "1";

  if (problems.length) return { ok: false, problems };

  return {
    ok: true,
    value: {
      employeeNo,
      firstName,
      lastName,
      title: str("title") || "Staff",
      employmentType: str("employmentType") || "Regular",
      status: str("status") || "Active",
      monthlyBasic,
      mwe,
      region,
      email,
      mobile,
      bankAccount,
      bankCode: str("bankCode") || null,
    },
  };
}

/**
 * Converts raw CSV text into validated rows plus per-line errors.
 * Header row is required; unknown columns are ignored so customers can
 * upload their existing spreadsheet without reshaping it.
 */
export function parseEmployeeCsv(text: string) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { headers: rows[0] ?? [], mapped: [], valid: [], errors: [{ line: 1, problems: ["CSV needs a header row and at least one data row"] }], unmapped: (rows[0] ?? []).filter((h) => !IMPORT_COLUMNS[headerKey(h)]) };

  const headers = rows[0];
  const mapping = mapHeaders(headers);
  const unmapped = headers.filter((header) => !IMPORT_COLUMNS[headerKey(header)] && header.trim() !== "");

  const valid: ParsedEmployee[] = [];
  const errors: { line: number; problems: string[] }[] = [];

  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index];
    const record: ImportRow = {};
    for (const [cellIndex, key] of mapping) record[key] = cells[cellIndex] ?? "";
    const parsed = parseEmployeeRow(record);
    if (parsed.ok) valid.push(parsed.value);
    else errors.push({ line: index + 1, problems: parsed.problems });
  }

  return { headers, mapped: Array.from(mapping.values()), valid, errors, unmapped };
}
