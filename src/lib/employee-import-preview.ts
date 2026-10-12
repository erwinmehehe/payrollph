import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { parseCsv, mapHeaders, parseEmployeeRow, REQUIRED_COLUMNS, type ParsedEmployee } from "./csv-import";
import { parseMigrationDate } from "./migration-date";
import { toCsv } from "./csv";

export type ImportPreviewRow = {
  line: number; employeeNo: string; name: string; status: "valid" | "warning" | "error";
  reasons: string[]; skipped: boolean;
};
export type ImportDepartment = { id: number; code: string; name: string };
export type ImportCandidate = ParsedEmployee & { tin: string | null; orgUnitId: number | null };
export type EmployeeImportPreview = {
  rows: ImportPreviewRow[]; candidates: ImportCandidate[]; totalRows: number;
  errorCount: number; warningCount: number; blockingErrorCount: number;
  skippedCount: number; fileErrors: string[];
};
const key = (text: string) => text.trim().toUpperCase();

/** Uses the existing employee validator and shared timezone-safe date parser. */
export function previewEmployeeImport(csv: string, context: {
  existingNumbers: readonly string[]; departments: readonly ImportDepartment[]; skipLines?: readonly number[];
}): EmployeeImportPreview {
  const source = parseCsv(csv);
  const headers = source[0] ?? [];
  const mapping = mapHeaders(headers);
  const fileErrors: string[] = [];
  const missing = REQUIRED_COLUMNS.filter(c => ![...mapping.values()].includes(c));
  if (missing.length) fileErrors.push(`Missing required columns: ${missing.join(", ")}.`);
  if (source.length < 2) fileErrors.push("Upload a header and at least one employee row.");
  if (source.length > 10001) fileErrors.push("Imports are limited to 10,000 employee rows.");
  const skips = new Set(context.skipLines ?? []);
  if ([...skips].some(n => !Number.isInteger(n) || n < 2 || n > source.length)) fileErrors.push("Invalid skipped row selection.");
  const tinIndex = headers.findIndex(h => /^(tin|tax identification number)$/i.test(h.trim()));
  const departmentIndex = headers.findIndex(h => /^(department|department code)$/i.test(h.trim()));
  const known = new Set(context.existingNumbers.map(key));
  const seen = new Set<string>();
  const rows: ImportPreviewRow[] = [];
  const candidates: ImportCandidate[] = [];
  for (let i = 1; i < source.length && i <= 10000; i++) {
    const cells = source[i];
    const record: Record<string, string> = {};
    for (const [index, column] of mapping) record[column] = cells[index] ?? "";
    const errors: string[] = [];
    const warnings: string[] = [];
    if (cells.length !== headers.length) errors.push("Column count does not match the CSV header.");
    const date = parseMigrationDate(record.startDate);
    if (!date) errors.push("Unparseable employment date; use an unambiguous calendar date such as YYYY-MM-DD.");
    // The shared employee validator receives only a canonical date.
    const parsed = parseEmployeeRow({ ...record, startDate: date ?? "" });
    if (!parsed.ok) errors.push(...parsed.problems.filter(p => !p.startsWith("startDate")));
    const number = (record.employeeNo ?? "").trim();
    const normalized = key(number);
    if (known.has(normalized)) errors.push("Duplicate employee number: already exists in this tenant. Import never updates existing employees.");
    else if (seen.has(normalized)) errors.push("Duplicate employee number inside this CSV.");
    const rawTin = tinIndex < 0 ? "" : (cells[tinIndex] ?? "").trim();
    const tin = rawTin.replace(/-/g, "");
    if (rawTin && !/^(?:\d{9}|\d{3}-\d{3}-\d{3})$/.test(rawTin)) errors.push("Bad TIN format: enter 9 digits or XXX-XXX-XXX.");
    if (!rawTin) warnings.push("Missing TIN; complete it before statutory filing.");
    const department = departmentIndex < 0 ? "" : (cells[departmentIndex] ?? "").trim();
    const matches = department ? context.departments.filter(d => key(d.code) === key(department) || key(d.name) === key(department)) : [];
    if (department && matches.length !== 1) errors.push(matches.length ? "Ambiguous department; use its unique code." : "Unknown department in this tenant.");
    if (parsed.ok && (!parsed.value.bankAccount || !parsed.value.bankCode)) warnings.push("Missing bank payout details; complete them before payroll.");
    const skipped = skips.has(i + 1);
    rows.push({ line: i + 1, employeeNo: number, name: `${record.firstName ?? ""} ${record.lastName ?? ""}`.trim(), status: errors.length ? "error" : warnings.length ? "warning" : "valid", reasons: [...errors, ...warnings], skipped });
    if (!skipped && !errors.length && parsed.ok) {
      seen.add(normalized);
      candidates.push({ ...parsed.value, tin: rawTin ? tin : null, orgUnitId: matches[0]?.id ?? null });
    }
  }
  return { rows, candidates, totalRows: rows.length, errorCount: rows.filter(r => r.status === "error").length, warningCount: rows.filter(r => r.status === "warning").length, blockingErrorCount: rows.filter(r => !r.skipped && r.status === "error").length, skippedCount: rows.filter(r => r.skipped).length, fileErrors };
}

export function employeeImportErrorCsv(preview: Pick<EmployeeImportPreview, "rows" | "fileErrors">) {
  return toCsv({ columns: ["Row", "Employee No", "Status", "Skipped", "Reason"], rows: [
    ...preview.fileErrors.map(reason => ["1", "", "error", "no", reason]),
    ...preview.rows.filter(r => r.status !== "valid").map(r => [String(r.line), r.employeeNo, r.status, r.skipped ? "yes" : "no", r.reasons.join("; ")]),
  ] });
}

/** Stateless receipt bound to this tenant, exact CSV, skips and authenticated session. */
export function importPreviewReceipt(csv: string, organizationId: number, skipLines: readonly number[], sessionToken: string) {
  return createHmac("sha256", sessionToken).update(JSON.stringify([organizationId, createHash("sha256").update(csv).digest("hex"), [...new Set(skipLines)].sort((a,b) => a-b)])).digest("hex");
}
export function validImportPreviewReceipt(receipt: unknown, expected: string) {
  return typeof receipt === "string" && /^[a-f0-9]{64}$/.test(receipt) && timingSafeEqual(Buffer.from(receipt, "hex"), Buffer.from(expected, "hex"));
}
