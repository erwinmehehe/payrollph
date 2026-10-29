/**
 * PRIVATE, OFFLINE, read-only employee-by-employee first-payroll reconciliation.
 * No database connections, HTTP, payroll writes, PII in logs, or approvals.
 *
 * Run only in an approved private workspace using two CSV exports:
 * node scripts/reconcile-private-employer-payroll.mjs reference.csv candidate.csv
 * Headers (both): legalEmployerId,periodStart,periodEnd,payDate,employeeNo,gross,sss,philHealth,pagIbig,withholding,net
 * Exactly those headers, in any order; never extra columns with employee PII.
 * Each file: at most 8 MiB and 50,000 employee rows. Individual money fields:
 * at most nine whole digits and two decimals. No malformed CSV quoting.
 * This simplified comparison is not the canonical multi-source #579 verifier.
 *
 * This is a mathematical acceptance gate, NOT a legal/agency filing, payroll
 * approval, payout authorization, or independent reviewer attestation.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const money = ["gross", "sss", "philHealth", "pagIbig", "withholding", "net"];
const required = ["legalEmployerId", "periodStart", "periodEnd", "payDate", "employeeNo", ...money];
const MAX_CSV_BYTES = 8 * 1024 * 1024;
const MAX_EMPLOYEES = 50_000;
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(new Date(value + "T00:00:00Z").getTime()) &&
  new Date(value + "T00:00:00Z").toISOString().slice(0,10) === value;

function parseRows(csv) {
  if (typeof csv !== "string" || csv.includes("\0")) throw Error("INVALID_CSV");
  if (Buffer.byteLength(csv, "utf8") > MAX_CSV_BYTES) throw Error("CSV_TOO_LARGE");
  const rows = [];let cells = []; let cell = ""; let inQuote = false; let afterQuote = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (inQuote) {
      if (c === '"' && csv[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { inQuote = false; afterQuote = true; }
      else cell += c;
    } else {
      // Once a quoted value ends, allow a separator only, never trailing text.
      if (afterQuote && c !== "," && c !== "\n" &&
          !(c === "\r" && csv[i + 1] === "\n")) throw Error("INVALID_CSV_QUOTE");
      if (c === '"') {
        if (cell !== "" || afterQuote) throw Error("INVALID_CSV_QUOTE");
        inQuote = true;
      } else if (c === ",") { cells.push(cell); cell = ""; afterQuote = false; }
      else if (c === "\n") {
        cells.push(cell.replace(/\r$/, ""));
        if (cells.some(v => v !== "")) rows.push(cells);
        if (rows.length > MAX_EMPLOYEES + 1) throw Error("TOO_MANY_CSV_ROWS");
        cells = []; cell = ""; afterQuote = false;
      } else if (afterQuote && c === "\r") {
        // Allow CRLF immediately after a quoted field, without changing data.
      } else { cell += c; }
    }
  }
  if (inQuote) throw Error("UNCLOSED_CSV_QUOTE");
  if (cell || cells.length) { cells.push(cell); rows.push(cells); }
  if (rows.length > MAX_EMPLOYEES + 1) throw Error("TOO_MANY_CSV_ROWS");
  return rows;
}
function toCents(value) {
  const s = String(value ?? "").trim();
  if (!/^-?(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(s)) throw Error("INVALID_MONEY");
  const sign = s.startsWith("-") ? -1n : 1n;
  const clean = sign < 0n ? s.slice(1) : s;
  const [whole, decimal = ""] = clean.split(".");
  return sign * (BigInt(whole) * 100n + BigInt(decimal.padEnd(2, "0")));
}
function parsePayroll(csv) {
  const [rawHeader, ...lines] = parseRows(csv.replace(/^\uFEFF/, ""));
  if (!rawHeader) throw Error("EMPTY_CSV");
  const header = rawHeader.map(v => v.trim());
  // Extra columns can introduce raw employee names, bank details and other PII.
  // Preserve header reordering but accept exactly the reviewed payroll fields.
  if (header.length !== required.length || header.length !== new Set(header).size ||
      required.some(k => !header.includes(k))) throw Error("NONCANONICAL_CSV_HEADER");
  const byNo = new Map();let period = null; let employer = null;
  for (const line of lines) {
    if (line.length !== header.length) throw Error("INVALID_COLUMN_COUNT");
    const row = Object.fromEntries(header.map((key, index) => [key,line[index]?.trim()??""]));
    const legalEmployerId = row.legalEmployerId;
    if (!legalEmployerId || legalEmployerId.length > 120) throw Error("INVALID_LEGAL_EMPLOYER");
    if (employer && employer !== legalEmployerId) throw Error("MIXED_LEGAL_EMPLOYERS");
    employer = legalEmployerId;
    const employeeNo = row.employeeNo.toLowerCase();
    if (!employeeNo || employeeNo.length > 120 || /[\x00-\x1f\x7f]/.test(employeeNo)) {
      throw Error("INVALID_EMPLOYEE_NO");
    }
    if (byNo.has(employeeNo)) throw Error("MISSING_OR_DUPLICATE_EMPLOYEE");
    const p = [row.periodStart,row.periodEnd,row.payDate];
    if (!p.every(validDate) || p[0] > p[1] || p[2] < p[0]) throw Error("INVALID_PAYROLL_PERIOD");
    if (period && period.join("|") !== p.join("|")) throw Error("MIXED_PAYROLL_PERIODS");
    period = p;
    byNo.set(employeeNo,Object.fromEntries(money.map(k => [k,toCents(row[k])])));
  }
  if (!period || byNo.size === 0) throw Error("EMPTY_PAYROLL");
  return {period,byNo,employer};
}
export function comparePayrollCsv(referenceCsv,candidateCsv) {
  const reference = parsePayroll(referenceCsv),candidate = parsePayroll(candidateCsv);
  if (reference.employer !== candidate.employer) throw Error("LEGAL_EMPLOYER_MISMATCH");
  if (reference.period.join("|") !== candidate.period.join("|")) throw Error("PAYROLL_PERIOD_MISMATCH");
  let missingCandidate = 0,unexpectedCandidate = 0,compared = 0,varianceOverCent = 0,maxVarianceCents = 0n;
  const fieldFailures = Object.fromEntries(money.map(k => [k,0]));
  for (const [employeeNo,amounts] of reference.byNo) {
    const found = candidate.byNo.get(employeeNo);
    if (!found) { missingCandidate++;continue; }
    compared++;
    for (const key of money) {
      const delta = amounts[key] - found[key];
      const abs = delta < 0n ? -delta : delta;
      if (abs > maxVarianceCents) maxVarianceCents = abs;
      if (abs > 1n) { varianceOverCent++;fieldFailures[key]++; }
    }
  }
  for (const key of candidate.byNo.keys()) if (!reference.byNo.has(key)) unexpectedCandidate++;
  return {
    pass: compared > 0 && missingCandidate === 0 && unexpectedCandidate === 0 && varianceOverCent === 0,
    period: { start: reference.period[0], end: reference.period[1], payDate: reference.period[2] },
    referenceEmployees:reference.byNo.size,candidateEmployees:candidate.byNo.size,
    employeesCompared:compared,missingCandidate,unexpectedCandidate,varianceOverCent,
    maximumAbsoluteVariancePesos:(maxVarianceCents / 100n).toString() + "." + (maxVarianceCents % 100n).toString().padStart(2, "0"),
    differencesByField:fieldFailures,
    threshold:"PHP 0.01 absolute per employee per field",
    realEmployerDataSupplied: "not-attested-by-script",
    independentPayrollSignoff:false,
    approvedForPayment:false,
  };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.length !== 4) {
    console.error("Usage: node scripts/reconcile-private-employer-payroll.mjs reference.csv candidate.csv");
    process.exitCode = 2;
  } else {
    try {
      const [a,b] = await Promise.all(process.argv.slice(2).map(p=>readFile(p,"utf8")));
      const summary=comparePayrollCsv(a,b);
      console.log(JSON.stringify(summary,null,2));
      if (!summary.pass) process.exitCode=1;
    } catch (e) {
      console.error(e instanceof Error ? e.message : "RECONCILIATION_FAILED");
      process.exitCode=2;
    }
  }
}
