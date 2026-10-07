import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Offline arithmetic verifier for employer-provided NORMALIZED payroll exports.
 * This is not a payroll calculator, a signature verifier or a certification issuer.
 * It never transmits private files and does not print employee identifiers or wages.
 */
export const PAYROLL_COLUMNS = [
  "employee_key", "legal_entity_code", "period",
  "gross_pay", "taxable_pay", "sss_ee", "philhealth_ee", "pagibig_ee",
  "withholding_tax", "government_loans", "company_loans",
  "other_deductions", "net_pay", "sss_er", "ec_er",
  "philhealth_er", "pagibig_er",
] as const;

export const JOURNAL_COLUMNS = [
  "account_code", "legal_entity_code", "period", "debit", "credit",
] as const;

export const PAYROLL_MONEY_COLUMNS = PAYROLL_COLUMNS.slice(3) as readonly string[];
const DEDUCTION_COLUMNS = [
  "sss_ee", "philhealth_ee", "pagibig_ee", "withholding_tax",
  "government_loans", "company_loans", "other_deductions",
];
const SOURCE_KEYS = [
  "incumbentPayroll", "linawPayroll", "incumbentJournal", "linawJournal",
] as const;
type SourceKey = typeof SOURCE_KEYS[number];

export type PrivateSource = { filePath: string; sha256: string };
export type ParallelCycle = {
  period: string;
  incumbentPayroll: PrivateSource;
  linawPayroll: PrivateSource;
  incumbentJournal: PrivateSource;
  linawJournal: PrivateSource;
};
export type ParallelReconciliationManifest = {
  schemaVersion: 1;
  legalEntityCode: string;
  cycles: ParallelCycle[];
};
type MoneyRow = { key: string; amounts: Record<string, number> };
type ParsedFile = Map<string, MoneyRow>;

export type ParallelCycleResult = {
  period: string;
  incumbentEmployeeCount: number;
  linawEmployeeCount: number;
  matchedEmployees: number;
  incumbentJournalAccounts: number;
  linawJournalAccounts: number;
  employeeFieldVarianceCounts: Record<string, number>;
  journalVarianceCounts: Record<"debit" | "credit", number>;
};

export type ParallelReconciliationResult = {
  status: "reconciliation-blocked" | "arithmetic-reconciled-pending-independent-review";
  legalEntityCode: string | null;
  cycleCount: number;
  verifiedFileHashCount: number;
  results: ParallelCycleResult[];
  issues: string[];
  disclaimer: string;
};

const MONEY = /^-?(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?$/;
const HASH = /^[0-9a-f]{64}$/;
const ENTITY = /^[A-Za-z0-9][A-Za-z0-9_-]{5,47}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,63}$/;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 50_000;
const TOLERANCE_CENTS = 1;
const DISCLAIMER = "Arithmetic and input-integrity checks only. Matching files do not prove either system is correct, that the employer approved payroll, that an independent CPA reviewed it, or that a bank/agency accepted it. Requires independent human review and real external acceptance.";

function validPeriod(value: unknown): value is string {
  return typeof value === "string" && PERIOD.test(value)
    && value <= new Date().toISOString().slice(0, 7);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function cents(value: string): number | null {
  if (!MONEY.test(value)) return null;
  const negative = value.startsWith("-");
  const [whole, frac = ""] = (negative ? value.slice(1) : value).split(".");
  const amount = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(amount) ? (negative ? -amount : amount) : null;
}
function safeFile(source: unknown, root: string): Buffer {
  if (!isObject(source)
    || typeof source.filePath !== "string"
    || typeof source.sha256 !== "string"
    || !HASH.test(source.sha256)
    || !source.filePath
    || isAbsolute(source.filePath)
    || source.filePath.split(/[\\/]/).includes("..")) {
    throw new Error("Missing, malformed or unsafe file/hash reference.");
  }
  const target = realpathSync(resolve(root, source.filePath));
  const rel = relative(root, target);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new Error("Evidence path escapes the private evidence directory.");
  }
  const stat = statSync(target);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES) {
    throw new Error("Input must be a nonempty regular file of at most 8 MiB.");
  }
  const bytes = readFileSync(target);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== source.sha256) throw new Error("SHA-256 mismatch.");
  return bytes;
}
function canonicalRows(bytes: Buffer, columns: readonly string[]): string[][] {
  const value = bytes.toString("utf8");
  // Canonical export: numeric amounts and opaque keys, no quoted free text.
  // This rejects extra PII columns and ambiguous CSV quoting instead of guessing.
  if (value.includes("\0") || value.includes('"') || value.includes("\uFEFF")) {
    throw new Error("Quoted/unsafe/noncanonical CSV content is not allowed.");
  }
  const records = value.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  if (records.length < 2 || records.length > MAX_ROWS + 1) {
    throw new Error("CSV must have a header and 1–50,000 data records.");
  }
  const header = records[0].split(",");
  if (header.length !== columns.length || header.some((col, i) => col !== columns[i])) {
    throw new Error("Unexpected CSV columns. Remove PII and use the exact canonical header.");
  }
  return records.slice(1).map((record, index) => {
    const fields = record.split(",");
    if (fields.length !== columns.length || fields.some((v) => !v)) {
      throw new Error("Noncanonical or missing column in record " + (index + 2) + ".");
    }
    return fields;
  });
}
function payrollRows(bytes: Buffer, legalEntityCode: string, period: string): ParsedFile {
  const rows = new Map<string, MoneyRow>();
  for (const [index, fields] of canonicalRows(bytes, PAYROLL_COLUMNS).entries()) {
    const [key, employer, sourcePeriod, ...values] = fields;
    if (!HASH.test(key)) throw new Error("Payroll record " + (index + 2) + " requires an HMAC-pseudonymized 64-hex employee key.");
    if (employer !== legalEntityCode || sourcePeriod !== period) {
      throw new Error("Wrong employer or payroll period in record " + (index + 2) + ".");
    }
    if (rows.has(key)) throw new Error("Duplicate employee key in record " + (index + 2) + ".");
    const amounts: Record<string, number> = {};
    PAYROLL_MONEY_COLUMNS.forEach((column, n) => {
      const amount = cents(values[n]);
      if (amount === null) throw new Error("Invalid peso amount for " + column + " in record " + (index + 2) + ".");
      if (amount < 0 && !["withholding_tax", "other_deductions"].includes(column)) {
        throw new Error("Unexpected negative amount for " + column + " in record " + (index + 2) + ".");
      }
      amounts[column] = amount;
    });
    const expectedNet = amounts.gross_pay
      - DEDUCTION_COLUMNS.reduce((total, column) => total + amounts[column], 0);
    if (Math.abs(expectedNet - amounts.net_pay) > TOLERANCE_CENTS) {
      throw new Error("Gross-to-net cash identity failed in payroll record " + (index + 2) + ".");
    }
    if (amounts.taxable_pay > amounts.gross_pay + Math.max(0, -amounts.withholding_tax)) {
      throw new Error("Taxable compensation exceeds gross; normalize and independently review record " + (index + 2) + ".");
    }
    rows.set(key, { key, amounts });
  }
  return rows;
}
function journalRows(bytes: Buffer, legalEntityCode: string, period: string): ParsedFile {
  const rows = new Map<string, MoneyRow>();
  let debits = 0, credits = 0;
  for (const [index, fields] of canonicalRows(bytes, JOURNAL_COLUMNS).entries()) {
    const [code, employer, sourcePeriod, debitText, creditText] = fields;
    if (!ACCOUNT.test(code)) throw new Error("Noncanonical journal account in record " + (index + 2) + ".");
    if (employer !== legalEntityCode || sourcePeriod !== period) {
      throw new Error("Wrong employer or period in journal record " + (index + 2) + ".");
    }
    if (rows.has(code)) throw new Error("Duplicate normalized journal account in record " + (index + 2) + ".");
    const debit = cents(debitText), credit = cents(creditText);
    if (debit === null || credit === null || debit < 0 || credit < 0) {
      throw new Error("Invalid nonnegative journal debit/credit in record " + (index + 2) + ".");
    }
    if (debit && credit) throw new Error("Journal record " + (index + 2) + " posts debit and credit to the same account.");
    debits += debit;
    credits += credit;
    rows.set(code, { key: code, amounts: { debit, credit } });
  }
  if (Math.abs(debits - credits) > TOLERANCE_CENTS) {
    throw new Error("Journal debits do not balance credits.");
  }
  return rows;
}
function differenceCount(a: ParsedFile, b: ParsedFile, columns: readonly string[]) {
  const counts: Record<string, number> = {};
  for (const col of columns) counts[col] = 0;
  let matched = 0, missing = 0, extra = 0;
  for (const [key, source] of a) {
    const target = b.get(key);
    if (!target) { missing++; continue; }
    matched++;
    for (const col of columns) {
      if (Math.abs(source.amounts[col] - target.amounts[col]) > TOLERANCE_CENTS) counts[col]++;
    }
  }
  for (const key of b.keys()) if (!a.has(key)) extra++;
  const aggregateVarianceColumns: string[] = [];
  for (const col of columns) {
    const left = [...a.values()].reduce((sum, row) => sum + row.amounts[col], 0);
    const right = [...b.values()].reduce((sum, row) => sum + row.amounts[col], 0);
    if (Math.abs(left - right) > TOLERANCE_CENTS) aggregateVarianceColumns.push(col);
  }
  return { counts, matched, missing, extra, aggregateVarianceColumns };
}

/**
 * Read only from a local private directory. Never output employee keys,
 * employee amounts, banking identifiers, or plaintext payroll rows.
 */
export function evaluateParallelPayrollReconciliation(
  value: unknown, privateRoot: string,
): ParallelReconciliationResult {
  const issues: string[] = [];
  let verifiedFileHashCount = 0;
  const manifest = isObject(value) ? value : {};
  const legalEntityCode = typeof manifest.legalEntityCode === "string"
    ? manifest.legalEntityCode.trim() : "";
  if (manifest.schemaVersion !== 1) issues.push("schemaVersion must be 1.");
  if (!ENTITY.test(legalEntityCode)) issues.push("A valid legal employer code is required.");

  let safeRoot: string;
  try { safeRoot = realpathSync(resolve(privateRoot)); }
  catch { safeRoot = ""; issues.push("Private evidence root is missing or inaccessible."); }

  const cycles = Array.isArray(manifest.cycles) ? manifest.cycles : [];
  if (cycles.length < 2 || cycles.length > 12) {
    issues.push("Two to twelve distinct real employer payroll months are required.");
  }
  const results: ParallelCycleResult[] = [];
  const seen = new Set<string>();
  for (const [index, rawCycle] of cycles.slice(0, 12).entries()) {
    if (!isObject(rawCycle) || !validPeriod(rawCycle.period) || seen.has(rawCycle.period)) {
      issues.push("Cycle " + (index + 1) + " has a malformed, future or duplicate period.");
      continue;
    }
    const period = rawCycle.period;
    seen.add(period);
    if (!safeRoot || !ENTITY.test(legalEntityCode)) continue;

    const loaded = {} as Partial<Record<SourceKey, ParsedFile>>;
    for (const key of SOURCE_KEYS) {
      try {
        const bytes = safeFile(rawCycle[key], safeRoot);
        verifiedFileHashCount++;
        loaded[key] = key.endsWith("Payroll")
          ? payrollRows(bytes, legalEntityCode, period)
          : journalRows(bytes, legalEntityCode, period);
      } catch (error) {
        issues.push(period + " " + key + ": " + (error instanceof Error ? error.message : "Invalid private evidence."));
      }
    }
    if (!SOURCE_KEYS.every((key) => loaded[key])) continue;
    const incumbent = loaded.incumbentPayroll!;
    const linaw = loaded.linawPayroll!;
    const comparison = differenceCount(incumbent, linaw, PAYROLL_MONEY_COLUMNS);
    const journal = differenceCount(loaded.incumbentJournal!, loaded.linawJournal!, ["debit", "credit"]);
    const payrollFields = Object.entries(comparison.counts).filter(([, count]) => count > 0);
    const journalFields = Object.entries(journal.counts).filter(([, count]) => count > 0);
    if (comparison.missing || comparison.extra) {
      issues.push(period + " payroll population mismatch: missing in Linaw=" + comparison.missing + ", unmatched in Linaw=" + comparison.extra + ".");
    }
    for (const [field, count] of payrollFields) issues.push(period + " payroll " + field + ": " + count + " employee discrepancy/discrepancies exceeding ₱0.01.");
    if (comparison.aggregateVarianceColumns.length) {
      issues.push(period + " aggregate payroll variance fields: " + comparison.aggregateVarianceColumns.join(", ") + ".");
    }
    if (journal.missing || journal.extra) {
      issues.push(period + " GL account mismatch: missing in Linaw=" + journal.missing + ", unmatched in Linaw=" + journal.extra + ".");
    }
    for (const [field, count] of journalFields) issues.push(period + " GL " + field + ": " + count + " account discrepancy/discrepancies exceeding ₱0.01.");
    if (journal.aggregateVarianceColumns.length) {
      issues.push(period + " aggregate GL variance fields: " + journal.aggregateVarianceColumns.join(", ") + ".");
    }
    results.push({
      period, incumbentEmployeeCount: incumbent.size, linawEmployeeCount: linaw.size,
      matchedEmployees: comparison.matched,
      incumbentJournalAccounts: loaded.incumbentJournal!.size,
      linawJournalAccounts: loaded.linawJournal!.size,
      employeeFieldVarianceCounts: comparison.counts,
      journalVarianceCounts: { debit: journal.counts.debit, credit: journal.counts.credit },
    });
  }
  return {
    status: issues.length === 0
      ? "arithmetic-reconciled-pending-independent-review" : "reconciliation-blocked",
    legalEntityCode: legalEntityCode || null,
    cycleCount: cycles.length,
    verifiedFileHashCount, results, issues,
    disclaimer: DISCLAIMER,
  };
}
