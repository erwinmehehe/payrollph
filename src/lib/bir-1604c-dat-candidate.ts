/**
 * BIR 1604-C ANNUAL candidate record layout for independent ADES testing.
 * Based on BIR RMC 25-2024 Annex A (1604C pages 6-9),
 * and RMC 15-2025 Annex B (annual file naming).
 *
 * NOT a certified or automatically populated government filing.
 * A complete reviewed mapping is required for EVERY field, including zeros.
 * The official BIR Alphalist Validation Module remains the authority.
 */

const COMMON = ["SCHEDULE_NUM", "FTYPE_CODE", "TIN_EMPYR", "BRANCH_CODE_EMPLYR",
  "RETRN_PERIOD", "SEQ_NUM", "TIN", "BRANCH_CODE", "LAST_NAME", "FIRST_NAME",
  "MIDDLE_NAME", "REGION_NUM"] as const;

const D1_BODY = [
  "PREV_NONTAX_GROSS_COMP_INCOME", "PREV_NONTAX_BASIC_SMW", "PREV_NONTAX_13TH_MONTH",
  "PREV_NONTAX_DE_MINIMIS", "PREV_NONTAX_SSS_ETC", "PREV_NONTAX_SALARIES",
  "PREV_TOTAL_NONTAX_COMP_INCOME", "PREV_TAXABLE_BASIC_SALARY",
  "PREV_TAXABLE_13TH_MONTH", "PREV_TAXABLE_SALARIES", "PREV_TOTAL_TAXABLE",
  "EMPLOYMENT_FROM", "EMPLOYMENT_TO",
  "PRES_NONTAX_GROSS_COMP_INCOME", "NONTAX_BASIC_SAL", "PRES_NONTAX_13TH_MONTH",
  "PRES_NONTAX_DE_MINIMIS", "PRES_NONTAX_SSS_ETC", "PRES_NONTAX_SALARIES",
  "PRES_TOTAL_NONTAX_COMP_INCOME", "TAX_BASIC_SAL", "PRES_TAXABLE_13TH_MONTH",
  "PRES_TAXABLES_SALARIES", "PRES_TOTAL_COMP", "GROSS_COMP_INCOME",
  "NET_TAXABLE_COMP_INCOME", "TAX_DUE", "PREV_TAX_WTHLD", "PRES_TAX_WTHLD",
  "AMT_WTHLD_DEC", "OVER_WTHLD", "ACTUAL_AMT_WTHLD",
  "NATIONALITY", "EMPLOYMENT_STATUS", "REASON_SEPARATION",
  "SUBS_FILING", "TAX_CREDIT_PERA",
] as const;

const D2_BODY = [
  "PREV_NONTAX_GROSS_COMP_INCOME", "PREV_NONTAX_BASIC_SMW",
  "PREV_NONTAX_HOLIDAY_PAY", "PREV_NONTAX_OVERTIME_PAY",
  "PREV_NONTAX_NIGHT_DIFF", "PREV_NONTAX_HAZARD_PAY",
  "PREV_NONTAX_13TH_MONTH", "PREV_NONTAX_DE_MINIMIS", "PREV_NONTAX_SSS_ETC",
  "PREV_NONTAX_SALARIES", "PREV_TOTAL_NONTAX_COMP_INCOME",
  "PREV_TAXABLE_13TH_MONTH", "PREV_TAXABLE_SALARIES", "PREV_TOTAL_TAXABLE",
  "EMPLOYMENT_FROM", "EMPLOYMENT_TO",
  "PRES_NONTAX_GROSS_COMP_INCOME", "PRES_NONTAX_BASIC_SMW_DAY",
  "PRES_NONTAX_BASIC_SMW_MONTH", "PRES_NONTAX_BASIC_SMW_YEAR", "FACTOR_USED",
  "PRES_NONTAX_HOLIDAY_PAY", "PRES_NONTAX_OVERTIME_PAY",
  "PRES_NONTAX_NIGHT_DIFF", "PRES_NONTAX_HAZARD_PAY",
  "PRES_NONTAX_13TH_MONTH", "PRES_NONTAX_DE_MINIMIS", "PRES_NONTAX_SSS_ETC",
  "PRES_NONTAX_SALARIES", "PRES_TOTAL_NONTAX_COMP_INCOME",
  "PRES_TAXABLE_13TH_MONTH", "PRES_TAXABLE_SALARIES", "PRES_TOTAL_COMP",
  "GROSS_COMP_INCOME", "NET_TAXABLE_COMP_INCOME", "TAX_DUE",
  "PREV_TAX_WTHLD", "PRES_TAX_WTHLD", "AMT_WTHLD_DEC", "OVER_WTHLD",
  "ACTUAL_AMT_WTHLD", "NATIONALITY", "EMPLOYMENT_STATUS", "REASON_SEPARATION",
  "SUBS_FILING", "TAX_CREDIT_PERA", "NONTAX_BASIC_SAL",
] as const;

export const BIR_1604C_D1_FIELDS = [...COMMON, ...D1_BODY] as const;
export const BIR_1604C_D2_FIELDS = [...COMMON, ...D2_BODY] as const;

const BASIC_PREFIX = new Set(["SCHEDULE_NUM", "FTYPE_CODE", "TIN_EMPYR", "BRANCH_CODE_EMPLYR",
  "RETRN_PERIOD", "SEQ_NUM", "TIN", "BRANCH_CODE",
  "LAST_NAME", "FIRST_NAME", "MIDDLE_NAME", "REGION_NUM",
  "NATIONALITY", "EMPLOYMENT_STATUS", "REASON_SEPARATION",
  "EMPLOYMENT_FROM", "EMPLOYMENT_TO", "SUBS_FILING"]);
const MONEY_FIELDS = (fields: readonly string[]) =>
  fields.filter(field => !BASIC_PREFIX.has(field) && field !== "FACTOR_USED");
// Control records consist of the first five common fields and totals for
// NUMERIC detail fields (not employee identity, dates or status).
export const BIR_1604C_C1_FIELDS = [
  "SCHEDULE_NUM", "FTYPE_CODE", "TIN_EMPYR", "BRANCH_CODE_EMPLYR", "RETRN_PERIOD",
  ...MONEY_FIELDS(BIR_1604C_D1_FIELDS),
] as const;
export const BIR_1604C_C2_FIELDS = [
  "SCHEDULE_NUM", "FTYPE_CODE", "TIN_EMPYR", "BRANCH_CODE_EMPLYR", "RETRN_PERIOD",
  ...MONEY_FIELDS(BIR_1604C_D2_FIELDS),
] as const;

export type Bir1604CRecord = {
  schedule: "D1" | "D2";
  /** All prescribed detail fields must be explicitly mapped and reviewed. */
  fields: Record<string, string | number | null | undefined>;
};
export type Bir1604CCandidateInput = {
  employerTin: string;
  employerBranch: string;
  taxYear: number;
  records: Bir1604CRecord[];
  /** Truthful ledger totals independently derived from the selected employer. */
  expectedActualWithheld: string | number;
  expectedEmployees: number;
};

const amount = (v: unknown, field: string) => {
  if (v === null || v === undefined || v === "") throw new Error(`Missing reviewed 1604-C field ${field}; never substitute zero.`);
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 99_999_999_999.99) {
    throw new Error(`Invalid non-negative BIR 1604-C amount in ${field}.`);
  }
  return Math.round(n * 100) / 100;
};
function escapeValue(value: string) {
  if (!/^[\x20-\x7E]*$/.test(value) || /[\r\n]/.test(value)) {
    throw new Error("Alphalist DAT candidate contains non-ASCII text or a line break; verify with the official BIR validation tool.");
  }
  return `"${value.replaceAll('"', '""')}"`;
}
function digits(value: string, n: number, name: string) {
  if (!new RegExp(`^\\d{${n}}$`).test(value)) throw new Error(`${name} must be exactly ${n} digits.`);
  return value;
}
const datePattern = /^(0[1-9]|1[0-2])\/(0[1-9]|[12][0-9]|3[01])\/\d{4}$/;
function validDate(value: string, field: string) {
  if (!datePattern.test(value)) throw new Error(`Invalid date for ${field} - expected MM/DD/YYYY.`);
  const [m,d,y] = value.split("/").map(Number);
  const v = new Date(Date.UTC(y,m-1,d));
  if (v.getUTCFullYear() !== y || v.getUTCMonth() !== m-1 || v.getUTCDate() !== d) {
    throw new Error(`Invalid calendar date in ${field}.`);
  }
  return value;
}
function formatField(field: string, raw: unknown, rowSchedule: "D1" | "D2") {
  if (MONEY_FIELDS(rowSchedule === "D1" ? BIR_1604C_D1_FIELDS : BIR_1604C_D2_FIELDS).includes(field)) {
    return amount(raw, field).toFixed(2);
  }
  if (raw === null || raw === undefined) throw new Error(`Missing 1604-C field ${field}.`);
  const value = String(raw);
  if (field === "RETRN_PERIOD" || field === "EMPLOYMENT_FROM" || field === "EMPLOYMENT_TO") {
    // Employment-to may be blank only after explicit reviewer confirmation.
    if (field === "EMPLOYMENT_TO" && value === "") return value;
    return validDate(value, field);
  }
  if (field === "SEQ_NUM") {
    if (!/^\d{1,6}$/.test(value) || Number(value) < 1) throw new Error("1604-C sequence must be 1-999999.");
    return value;
  }
  if (field === "FACTOR_USED") {
    if (!/^\d{1,3}$/.test(value) || Number(value) < 1) throw new Error("MWE factor used must be an explicit positive number.");
    return value;
  }
  if (field === "TIN" || field === "TIN_EMPYR") return digits(value,9,field);
  if (field === "BRANCH_CODE" || field === "BRANCH_CODE_EMPLYR" || field === "REGION_NUM") {
    return digits(value,4,field);
  }
  if (field === "LAST_NAME" || field === "FIRST_NAME" || field === "MIDDLE_NAME" || field === "NATIONALITY") {
    if (value.length > 30 || (field !== "MIDDLE_NAME" && !value.trim())) {
      throw new Error(`BIR 1604-C text field ${field} must be nonblank (except middle name), at most 30 characters.`);
    }
  }
  if (field === "EMPLOYMENT_STATUS" || field === "REASON_SEPARATION" || field === "SUBS_FILING") {
    if (!/^[0-9]{2}$/.test(value)) throw new Error(`BIR 1604-C code ${field} must be 2 digits from the official LOV.`);
  }
  return value;
}
function renderRecord(fields: readonly string[], record: Record<string, unknown>, kind: "D1" | "D2") {
  const unexpected = Object.keys(record).filter(key => !fields.includes(key));
  if (unexpected.length) throw new Error(`Unexpected BIR ${kind} keys: ${unexpected.join(", ")}.`);
  return fields.map(field => {
    const value = formatField(field, record[field], kind);
    return field === "SCHEDULE_NUM" || field === "SEQ_NUM" || field === "FACTOR_USED"
      || MONEY_FIELDS(kind === "D1" ? BIR_1604C_D1_FIELDS : BIR_1604C_D2_FIELDS).includes(field)
      ? value : escapeValue(value);
  }).join(",");
}
const cents = (n: number) => Math.round(n * 100);
function controlRow(
  schedule: "D1" | "D2", detail: Bir1604CRecord[],
  employerTin: string, employerBranch: string, returnPeriod: string,
) {
  const fields = schedule === "D1" ? BIR_1604C_C1_FIELDS : BIR_1604C_C2_FIELDS;
  const sums: Record<string, number> = {};
  for (const field of fields.slice(5)) {
    sums[field] = detail.reduce((sum, row) => sum + amount(row.fields[field], field), 0);
  }
  const fixed = [schedule === "D1" ? "C1" : "C2", "1604C", employerTin, employerBranch, returnPeriod];
  return [fixed[0], escapeValue(fixed[1]), escapeValue(fixed[2]), escapeValue(fixed[3]), returnPeriod,
    ...fields.slice(5).map(field => sums[field].toFixed(2))].join(",");
}

export function buildBir1604cDatCandidate(input: Bir1604CCandidateInput) {
  const tin = digits(input.employerTin, 9, "employerTin");
  const branch = digits(input.employerBranch, 4, "employerBranch");
  if (!Number.isInteger(input.taxYear) || input.taxYear < 2018 || input.taxYear > 2100) {
    throw new Error("A valid 1604-C tax year is required.");
  }
  if (!Number.isInteger(input.expectedEmployees) || input.expectedEmployees !== input.records.length || input.records.length === 0) {
    throw new Error("1604-C employee population must equal the independently reconciled employer population.");
  }
  const period = `12/31/${input.taxYear}`;
  const distinct = new Set<string>();
  const lines = [`H1604C,${escapeValue(tin)},${escapeValue(branch)},${period}`];
  let actualWithheld = 0;
  for (const [i,row] of input.records.entries()) {
    const fields = row.schedule === "D1" ? BIR_1604C_D1_FIELDS : BIR_1604C_D2_FIELDS;
    const record: Record<string, unknown> = { ...row.fields };
    for (const [name,value] of Object.entries({
      SCHEDULE_NUM: row.schedule, FTYPE_CODE: "1604C", TIN_EMPYR: tin,
      BRANCH_CODE_EMPLYR: branch, RETRN_PERIOD: period, SEQ_NUM: i+1,
    })) {
      if (record[name] !== undefined && String(record[name]) !== String(value)) {
        throw new Error(`BIR record ${i+1} ${name} does not match its verified employer and tax period.`);
      }
      record[name] = value;
    }
    const employeeKey = `${String(record.TIN)}-${String(record.BRANCH_CODE)}`;
    if (distinct.has(employeeKey)) throw new Error("Duplicate employee TIN and branch in 1604-C filing.");
    distinct.add(employeeKey);
    lines.push(renderRecord(fields, record, row.schedule));
    actualWithheld += amount(record.ACTUAL_AMT_WTHLD, "ACTUAL_AMT_WTHLD");
  }
  const expectedWithheld = amount(input.expectedActualWithheld, "expectedActualWithheld");
  if (Math.abs(cents(actualWithheld) - cents(expectedWithheld)) > 1) {
    throw new Error("DAT candidate actual withholding does not reconcile to released employer payroll withholding.");
  }
  for (const schedule of ["D1", "D2"] as const) {
    const selected = input.records.filter(row => row.schedule === schedule);
    if (selected.length) lines.push(controlRow(schedule, selected, tin, branch, period));
  }
  // RMC 15-2025 Annex B: <TIN><BC><MMDDYYYY><FORM>.DAT
  const officialNameConvention = `${tin}${branch}1231${input.taxYear}1604C.DAT`;
  return {
    officialNameConvention,
    candidateFilename: `DRAFT-UNVALIDATED-${officialNameConvention}`,
    encoding: "ASCII" as const,
    content: `${lines.join("\r\n")}\r\n`,
    recordCount: input.records.length,
    validatedByBir: false as const,
    note: "STRUCTURAL CANDIDATE ONLY. Validate current BIR layout, controls, naming and exact file bytes with official BIR Alphalist Module before filing.",
  };
}
