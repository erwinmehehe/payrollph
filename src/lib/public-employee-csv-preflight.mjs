/**
 * Public, browser-only preparation aid. Never send employee records to a server.
 * Deliberately NOT the authenticated employee-import validator or an approval.
 * Only diagnostic row numbers and field names leave this function.
 */
export const PUBLIC_CSV_MAX_BYTES = 2 * 1024 * 1024;
export const PUBLIC_CSV_MAX_ROWS = 10000;
export const PUBLIC_CSV_REQUIRED = Object.freeze([
  "employeeNo", "firstName", "lastName", "startDate", "monthlyBasic", "region",
]);

const HEADER_ALIASES = Object.freeze({
  "employee no": "employeeNo", employeeno: "employeeNo", employee_no: "employeeNo",
  "first name": "firstName", firstname: "firstName",
  "last name": "lastName", lastname: "lastName",
  title: "title", position: "title", "employment type": "employmentType",
  status: "status", "start date": "startDate", "hire date": "startDate",
  "employment start date": "startDate", startdate: "startDate",
  "monthly basic": "monthlyBasic", "monthly basic pay": "monthlyBasic",
  basic: "monthlyBasic", "basic pay": "monthlyBasic",
  mwe: "mwe", region: "region", email: "email", mobile: "mobile",
  "bank account": "bankAccount", "bank code": "bankCode",
  tin: "tin", "tax identification number": "tin",
  department: "department", "department code": "department",
});

/** Strict CSV reader supporting escaped quotes, BOM and newlines inside quoted cells. */
function readCsv(text) {
  const rows = [];
  let cells = [];
  let cell = "";
  let position = 0;
  let line = 1;
  let startingLine = 1;
  let quoted = false;
  let afterQuote = false;
  let inCellStart = true;
  const save = () => {
    cells.push(cell);
    if (cells.some(value => value.trim())) rows.push({ line: startingLine, cells });
    cells = [];
    cell = "";
    inCellStart = true;
    afterQuote = false;
  };
  while (position < text.length) {
    const char = text[position];
    const newline = char === "\r" || char === "\n";
    const length = char === "\r" && text[position + 1] === "\n" ? 2 : 1;
    if (quoted) {
      if (char === '"') {
        if (text[position + 1] === '"') { cell += '"'; position += 2; continue; }
        quoted = false;
        afterQuote = true;
        position += 1;
        continue;
      }
      if (newline) { line += 1; cell += text.slice(position, position + length); position += length; continue; }
      cell += char;
      position += 1;
      continue;
    }
    if (char === ',') {
      cells.push(cell); cell = ""; inCellStart = true; afterQuote = false; position += 1; continue;
    }
    if (newline) {
      line += 1; save(); startingLine = line; position += length; continue;
    }
    if (char === '"') {
      if (!inCellStart || afterQuote) throw new Error(`Invalid quotation mark near CSV line ${line}.`);
      quoted = true; inCellStart = false; position += 1; continue;
    }
    if (afterQuote && !/^[ \t]$/.test(char)) throw new Error(`Unexpected character after a quoted field near CSV line ${line}.`);
    if (!afterQuote) cell += char;
    inCellStart = false;
    position += 1;
  }
  if (quoted) throw new Error(`Unclosed quoted field starting near CSV line ${startingLine}.`);
  if (cells.length || cell.trim() || afterQuote) save();
  return rows;
}

function isoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const issue = (row, severity, field, message) => ({ row, severity, field, message });
const normalizedEmployee = text => text.trim().toLocaleUpperCase("en-US");

export function checkEmployeeCsvLocally(input) {
  if (typeof input !== "string" || !input.trim()) {
    return { totalRows: 0, issues: [issue(1, "error", "file", "Provide a CSV header and at least one employee row.")], missingColumns: [...PUBLIC_CSV_REQUIRED], unrecognizedColumns: 0 };
  }
  if (new TextEncoder().encode(input).length > PUBLIC_CSV_MAX_BYTES) {
    return { totalRows: 0, issues: [issue(1, "error", "file", "CSV exceeds the 2 MB preparation limit.")], missingColumns: [], unrecognizedColumns: 0 };
  }
  let rows;
  try { rows = readCsv(input.replace(/^\uFEFF/, "")); }
  catch (error) {
    return { totalRows: 0, issues: [issue(1, "error", "file", error instanceof Error ? error.message : "Malformed CSV.")], missingColumns: [], unrecognizedColumns: 0 };
  }
  if (!rows.length) {
    return { totalRows: 0, issues: [issue(1, "error", "file", "The CSV is empty.")], missingColumns: [...PUBLIC_CSV_REQUIRED], unrecognizedColumns: 0 };
  }
  const issues = [];
  const headers = rows[0].cells;
  if (headers.length > 100) issues.push(issue(rows[0].line, "error", "header", "CSV has more than 100 columns."));
  const canonical = new Map();
  let unrecognizedColumns = 0;
  headers.forEach((header, index) => {
    const key = HEADER_ALIASES[header.trim().toLocaleLowerCase("en-US")];
    if (!key) { unrecognizedColumns += 1; return; }
    if (canonical.has(key)) issues.push(issue(rows[0].line, "error", key, "Multiple headers map to this field. Keep only one."));
    else canonical.set(key, index);
  });
  const missingColumns = PUBLIC_CSV_REQUIRED.filter(column => !canonical.has(column));
  for (const field of missingColumns) issues.push(issue(rows[0].line, "error", field, "Required header missing."));
  if (rows.length < 2) issues.push(issue(rows[0].line, "error", "file", "Add at least one employee row."));
  const totalRows = rows.length - 1;
  if (totalRows > PUBLIC_CSV_MAX_ROWS) issues.push(issue(rows[0].line, "error", "file", "This file exceeds the 10,000-employee preparation limit."));
  const seen = new Set();
  for (const row of rows.slice(1, PUBLIC_CSV_MAX_ROWS + 1)) {
    const get = key => (row.cells[canonical.get(key)] ?? "").trim();
    if (row.cells.length !== headers.length) issues.push(issue(row.line, "error", "row", "Column count does not match the header."));
    for (const field of PUBLIC_CSV_REQUIRED) {
      if (canonical.has(field) && !get(field)) issues.push(issue(row.line, "error", field, "Required field is blank."));
    }
    if (canonical.has("employeeNo")) {
      const number = normalizedEmployee(get("employeeNo"));
      if (number.length > 32) issues.push(issue(row.line, "error", "employeeNo", "Employee number exceeds 32 characters."));
      if (number && seen.has(number)) issues.push(issue(row.line, "error", "employeeNo", "Employee number repeats within this file."));
      if (number) seen.add(number);
    }
    for (const field of ["firstName", "lastName"]) {
      if (canonical.has(field) && get(field).length > 80) issues.push(issue(row.line, "error", field, "Name exceeds 80 characters."));
    }
    if (canonical.has("startDate") && get("startDate") && !isoDate(get("startDate"))) {
      issues.push(issue(row.line, "warning", "startDate", "Use an unambiguous real date in YYYY-MM-DD format. The signed-in import flow makes the final decision."));
    }
    if (canonical.has("monthlyBasic") && get("monthlyBasic")) {
      const amount = get("monthlyBasic").replace(/[,₱\s]/g, "");
      if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > 9999999999.99) {
        issues.push(issue(row.line, "error", "monthlyBasic", "Use a positive amount with at most two decimal places."));
      }
    }
    if (canonical.has("tin") && get("tin") && !/^(?:\d{9}|\d{3}-\d{3}-\d{3})$/.test(get("tin"))) {
      issues.push(issue(row.line, "warning", "tin", "Check the 9-digit TIN format. Verify the actual ID in your authorized system."));
    }
    if (canonical.has("status") && get("status") && !["active", "on leave"].includes(get("status").toLocaleLowerCase("en-US"))) {
      issues.push(issue(row.line, "error", "status", "Use Active or On leave. Separation needs an authorized workflow."));
    }
    if (canonical.has("bankAccount") && canonical.has("bankCode") && Boolean(get("bankAccount")) !== Boolean(get("bankCode"))) {
      issues.push(issue(row.line, "warning", "bankAccount", "Bank account and bank code should be supplied together, through a secure workflow."));
    }
  }
  return { totalRows, issues, missingColumns, unrecognizedColumns };
}

/** Never export uploaded CSV values, even if they start with spreadsheet formulas. */
export function employeeCsvDiagnosticReport(result) {
  const csvCell = value => '"' + String(value).replaceAll('"', '""') + '"';
  return ["row,severity,field,message", ...result.issues.map(item =>
    [item.row, item.severity, item.field, item.message].map(csvCell).join(","))].join("\r\n") + "\r\n";
}

export const FICTIONAL_EMPLOYEE_CSV = [
  "Employee No,First Name,Last Name,Start Date,Monthly Basic,Region",
  "SAMPLE-001,Alex,Reyes,2026-10-01,18000,NCR",
  "SAMPLE-002,Jamie,Garcia,2026-10-02,19500,NCR",
].join("\r\n");
