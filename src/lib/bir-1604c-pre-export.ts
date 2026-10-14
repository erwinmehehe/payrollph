/**
 * Fail-closed pre-export review for the BIR 1604-C D1/D2 annual Alphalist.
 * Source: RMC 25-2024 Annex A, pages 6-9 (current candidate layout).
 * Historical RMC 07-2021 module v7.0 also consolidated old Schedules 7.1-7.5
 * into Schedule 1 (D1) and Schedule 2 (D2); its exact validator bytes must be
 * checked separately. This is NOT a simulation of the BIR desktop module.
 *
 * Nothing here infers unrecorded employer history, employee TIN, regions, dates,
 * annual compensation components, substituted filing status or legal zeroes.
 */
import {
  BIR_1604C_D1_FIELDS, BIR_1604C_D2_FIELDS,
  BIR_1604C_C1_FIELDS, BIR_1604C_C2_FIELDS,
  buildBir1604cDatCandidate, type Bir1604CRecord,
} from "./bir-1604c-dat-candidate";

export type Bir1604CReviewedRecord = Bir1604CRecord & {
  employeeNo: string;
  /** Private reference to independently checked payroll, 2316 or other source. */
  sourceReference: string;
  reviewedBy: string;
  /** Explicit reviewed confirmation, never inferred from zero previous-employer columns. */
  priorEmployerReview: "none-confirmed" | "form-2316-verified";
  priorEmployerEvidenceReference?: string;
  /** Distinct reviewed holiday / OT / night / hazard schedule for D2 (MWE). */
  mwePremiumEvidenceReference?: string;
};

export type Bir1604CPreExportIssue = {
  code: string;
  field?: string;
  employeeNo?: string;
  message: string;
};

const AUTO_FIELDS = new Set([
  "SCHEDULE_NUM", "FTYPE_CODE", "TIN_EMPYR", "BRANCH_CODE_EMPLYR",
  "RETRN_PERIOD", "SEQ_NUM",
]);
const DATE_FIELDS = new Set(["RETRN_PERIOD", "EMPLOYMENT_FROM", "EMPLOYMENT_TO"]);
const IDENTIFIERS: Record<string, number> = {
  TIN_EMPYR: 9, TIN: 9, BRANCH_CODE_EMPLYR: 4,
  BRANCH_CODE: 4, REGION_NUM: 4,
};
const TEXT_30 = new Set(["LAST_NAME", "FIRST_NAME", "MIDDLE_NAME", "NATIONALITY"]);
const TEXT_2: Record<string, readonly string[]> = {
  EMPLOYMENT_STATUS: ["R", "C", "CP", "S", "P", "AL"],
  REASON_SEPARATION: ["NA", "T", "TR", "R", "D"],
  SUBS_FILING: ["Y", "N"],
};
const NUMERIC_EXCEPT_MONEY = new Set(["SEQ_NUM", "FACTOR_USED"]);
const ADMIN = new Set([
  ...AUTO_FIELDS, ...DATE_FIELDS, ...Object.keys(IDENTIFIERS),
  ...TEXT_30, ...Object.keys(TEXT_2), ...NUMERIC_EXCEPT_MONEY,
]);

export type Bir1604CFieldSpec = { name: string; type: "text" | "date" | "number"; width: number; format: string };

function specification(name: string): Bir1604CFieldSpec {
  if (DATE_FIELDS.has(name)) return { name, type: "date", width: 10, format: "MM/DD/YYYY" };
  if (name === "SEQ_NUM") return { name, type: "number", width: 6, format: "000001-999999" };
  if (name === "FACTOR_USED") return { name, type: "number", width: 3, format: "1-999" };
  if (name === "SCHEDULE_NUM") return { name, type: "text", width: 2, format: "D1/D2 or C1/C2" };
  if (name === "FTYPE_CODE") return { name, type: "text", width: 5, format: "1604C" };
  if (name in IDENTIFIERS) return { name, type: "text", width: IDENTIFIERS[name], format: "digits; preserve leading zeros" };
  if (TEXT_30.has(name)) return { name, type: "text", width: 30, format: "printable ASCII, max 30" };
  if (name in TEXT_2) return { name, type: "text", width: 2, format: TEXT_2[name].join("/") };
  return { name, type: "number", width: 14, format: "11 integer digits + decimal + 2 digits" };
}

/** Complete, ordered widths/types for every prescribed candidate record. No ATC exists in D1/D2. */
export const BIR_1604C_LAYOUT = {
  H: [
    { name: "FTYPE_CODE", type: "text", width: 6, format: "H1604C" },
    specification("TIN"), specification("BRANCH_CODE"), specification("RETRN_PERIOD"),
  ],
  D1: BIR_1604C_D1_FIELDS.map(specification),
  D2: BIR_1604C_D2_FIELDS.map(specification),
  C1: BIR_1604C_C1_FIELDS.map(specification),
  C2: BIR_1604C_C2_FIELDS.map(specification),
} as const;

function parseAmount(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const value = String(raw);
  if (!/^(0|[1-9][0-9]{0,10})(\.[0-9]{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
function calendarDate(value: string): boolean {
  if (!/^(0[1-9]|1[0-2])\/(0[1-9]|[12][0-9]|3[01])\/[0-9]{4}$/.test(value)) return false;
  const [month, day, year] = value.split("/").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function printable(value: string) {
  return /^[\x20-\x7E]*$/.test(value) && !value.includes("\r") && !value.includes("\n");
}
function reviewedString(value: unknown) {
  return typeof value === "string" && !!value.trim() && value.length <= 160 && printable(value);
}

/**
 * Return ALL actionable blockers; do not stop at the first employee.
 * The caller must independently reconcile input with released employer payroll.
 */
export function validateBir1604cPreExport(input: {
  taxYear: number;
  employerTin: string;
  employerBranch: string;
  expectedEmployees: number;
  expectedActualWithheld: string | number;
  records: Bir1604CReviewedRecord[];
}) {
  const issues: Bir1604CPreExportIssue[] = [];
  const add = (code: string, message: string, employeeNo?: string, field?: string) =>
    issues.push({ code, message, ...(employeeNo ? { employeeNo } : {}), ...(field ? { field } : {}) });

  if (!Number.isInteger(input.taxYear) || input.taxYear < 2018 || input.taxYear > 2100)
    add("INVALID_YEAR", "Select a valid annual return year.");
  if (!/^[0-9]{9}$/.test(input.employerTin))
    add("EMPLOYER_TIN", "The legal employer needs a verified 9-digit BIR TIN.");
  if (!/^[0-9]{4}$/.test(input.employerBranch))
    add("EMPLOYER_BRANCH", "The legal employer needs its verified 4-digit branch code. It will not be padded.");
  if (!Array.isArray(input.records) || input.records.length === 0) {
    add("NO_EMPLOYEES", "There are no reviewed employee schedule records.");
    return { canGenerateCandidate: false as const, issues };
  }
  if (!Number.isSafeInteger(input.expectedEmployees) || input.expectedEmployees !== input.records.length)
    add("EMPLOYEE_POPULATION", "The reviewed employee count does not match the independent annual payroll population.");
  if (input.records.length > 999999) add("EMPLOYEE_CAP", "The six-digit BIR sequence number limit has been exceeded.");
  const expectedCents = parseAmount(input.expectedActualWithheld);
  if (expectedCents === null)
    add("EXPECTED_TAX", "Use the actual released-payroll withholding amount, with no more than two decimals.");

  let actualCents = 0;
  const identifiers = new Set<string>();
  const employeeNos = new Set<string>();
  for (const [index, row] of input.records.entries()) {
    const no = typeof row?.employeeNo === "string" && row.employeeNo.trim()
      ? row.employeeNo.trim() : "employee row " + (index + 1);
    if (!reviewedString(row?.employeeNo))
      add("EMPLOYEE_NUMBER", "Provide the payroll employee number identifying this row.", no, "employeeNo");
    if (employeeNos.has(no.toUpperCase()))
      add("DUPLICATE_EMPLOYEE", "Employee appears more than once in the reviewed annual population.", no);
    employeeNos.add(no.toUpperCase());
    if (!reviewedString(row?.sourceReference))
      add("SOURCE_REFERENCE", "Identify the reviewed Form 2316 or payroll records for this employee.", no, "sourceReference");
    if (!reviewedString(row?.reviewedBy))
      add("REVIEWER", "Identify who reviewed this employee's BIR schedule values.", no, "reviewedBy");
    if (row?.priorEmployerReview !== "none-confirmed" &&
        row?.priorEmployerReview !== "form-2316-verified") {
      add("PRIOR_EMPLOYER_REVIEW", "Confirm no previous employer or record an independently reviewed prior Form 2316.", no);
    }
    if (row?.priorEmployerReview === "form-2316-verified" &&
        !reviewedString(row.priorEmployerEvidenceReference)) {
      add("PRIOR_EMPLOYER_EVIDENCE", "Identify the separately verified previous-employer Form 2316 evidence.", no);
    }
    if (row?.schedule === "D2" && !reviewedString(row?.mwePremiumEvidenceReference)) {
      add("MWE_PREMIUM_EVIDENCE", "A reviewed MWE premium split is required for holiday, OT, night differential and hazard pay.", no);
    }
    if (row?.schedule !== "D1" && row?.schedule !== "D2") {
      add("SCHEDULE", "Choose Schedule 1 (D1) or Schedule 2 for an MWE (D2).", no, "schedule");
      continue;
    }
    const fieldList = row.schedule === "D1" ? BIR_1604C_D1_FIELDS : BIR_1604C_D2_FIELDS;
    if (!row.fields || typeof row.fields !== "object" || Array.isArray(row.fields)) {
      add("MISSING_FIELDS", "Provide the complete reviewed schedule field mapping.", no);
      continue;
    }
    const values = row.fields;
    for (const key of Object.keys(values)) {
      if (!fieldList.includes(key as never)) add("UNEXPECTED_FIELD", "Remove extra field " + key + " from this schedule.", no, key);
    }
    for (const field of fieldList) {
      if (AUTO_FIELDS.has(field)) continue;
      const value = values[field];
      if (value === undefined || value === null || (value === "" && field !== "MIDDLE_NAME")) {
        add("MISSING_FIELD", "Provide a reviewed value for " + field + "; never substitute zero or a guessed date.", no, field);
        continue;
      }
      const text = String(value);
      if (!printable(text)) {
        add("INVALID_CHARACTERS", "Use single-line printable ASCII for " + field + ".", no, field);
        continue;
      }
      if (field in IDENTIFIERS && !new RegExp("^[0-9]{" + IDENTIFIERS[field] + "}$").test(text))
        add("INVALID_IDENTIFIER", field + " must contain exactly " + IDENTIFIERS[field] + " digits.", no, field);
      else if (TEXT_30.has(field) && (text.length > 30 || (field !== "MIDDLE_NAME" && !text.trim())))
        add("INVALID_NAME", field + " must be at most 30 characters and nonblank where required.", no, field);
      else if (field in TEXT_2 && !TEXT_2[field].includes(text))
        add("INVALID_CODE", field + " must use a listed BIR code: " + TEXT_2[field].join(", ") + ".", no, field);
      else if (DATE_FIELDS.has(field) && !calendarDate(text))
        add("INVALID_DATE", field + " must be a real date in MM/DD/YYYY format.", no, field);
      else if (field === "FACTOR_USED" && (!/^[0-9]{1,3}$/.test(text) || Number(text) < 1))
        add("INVALID_FACTOR", "Provide the verified MWE days-per-year factor (1-999).", no, field);
      else if (!ADMIN.has(field) && parseAmount(value) === null)
        add("INVALID_AMOUNT", field + " must be a reviewed nonnegative amount with up to 11 whole digits and two decimals.", no, field);
    }
    if (values.SCHEDULE_NUM !== undefined && values.SCHEDULE_NUM !== row.schedule)
      add("MISMATCHED_SCHEDULE", "Employee record contains a different schedule number.", no, "SCHEDULE_NUM");
    if (values.FTYPE_CODE !== undefined && values.FTYPE_CODE !== "1604C")
      add("MISMATCHED_FORM", "Employee record has a different BIR return form.", no, "FTYPE_CODE");
    if (values.TIN_EMPYR !== undefined && values.TIN_EMPYR !== input.employerTin)
      add("MISMATCHED_EMPLOYER", "Employee schedule refers to a different legal employer.", no, "TIN_EMPYR");
    if (values.BRANCH_CODE_EMPLYR !== undefined && values.BRANCH_CODE_EMPLYR !== input.employerBranch)
      add("MISMATCHED_EMPLOYER_BRANCH", "Employee schedule refers to a different registered employer branch.", no, "BRANCH_CODE_EMPLYR");
    if (values.RETRN_PERIOD !== undefined && values.RETRN_PERIOD !== "12/31/" + input.taxYear)
      add("MISMATCHED_PERIOD", "Employee record uses the wrong annual return period.", no, "RETRN_PERIOD");
    if (values.SEQ_NUM !== undefined && String(Number(values.SEQ_NUM)) !== String(index + 1))
      add("MISMATCHED_SEQUENCE", "The BIR sequence number does not match this employee row's position.", no, "SEQ_NUM");

    if (typeof values.EMPLOYMENT_FROM === "string" && typeof values.EMPLOYMENT_TO === "string"
        && calendarDate(values.EMPLOYMENT_FROM) && calendarDate(values.EMPLOYMENT_TO)) {
      const [fm, fd, fy] = values.EMPLOYMENT_FROM.split("/").map(Number);
      const [tm, td, ty] = values.EMPLOYMENT_TO.split("/").map(Number);
      const from = new Date(Date.UTC(fy, fm - 1, fd));
      const to = new Date(Date.UTC(ty, tm - 1, td));
      if (from > to || from.getUTCFullYear() > input.taxYear || to.getUTCFullYear() < input.taxYear)
        add("EMPLOYMENT_INTERVAL", "Employment dates must overlap this tax year and be in chronological order.", no, "EMPLOYMENT_FROM");
    }
    const employeeTin = values.TIN, branch = values.BRANCH_CODE;
    if (typeof employeeTin === "string" && typeof branch === "string"
      && /^[0-9]{9}$/.test(employeeTin) && /^[0-9]{4}$/.test(branch)) {
      const id = employeeTin + ":" + branch;
      if (identifiers.has(id)) add("DUPLICATE_TIN", "The same employee TIN and branch occur on more than one record.", no, "TIN");
      identifiers.add(id);
    }
    if (row.priorEmployerReview === "none-confirmed") {
      for (const field of fieldList.filter(name => name.startsWith("PREV_"))) {
        const value = parseAmount(values[field]);
        if (value !== null && value !== 0)
          add("UNVERIFIED_PREVIOUS_EMPLOYER", "A nonzero prior-employer amount requires a reviewed Form 2316 and its reference.", no, field);
      }
    }
    const exempt13th = parseAmount(values.PRES_NONTAX_13TH_MONTH);
    const previousExempt13th = parseAmount(values.PREV_NONTAX_13TH_MONTH);
    if (exempt13th !== null && previousExempt13th !== null
        && exempt13th + previousExempt13th > 9_000_000)
      add("THIRTEENTH_EXEMPT_LIMIT", "The combined exempt 13th-month/other-benefits entry exceeds the statutory PHP 90,000 pool. Review its taxable excess.", no, "PRES_NONTAX_13TH_MONTH");
    const withheld = parseAmount(values.ACTUAL_AMT_WTHLD);
    if (withheld !== null) actualCents += withheld;
  }

  if (expectedCents !== null && actualCents !== expectedCents)
    add("WITHHOLDING_MISMATCH", "Sum of employee actual withholding must match released employer payroll to the exact centavo.");
  for (const schedule of ["D1", "D2"] as const) {
    const controls = schedule === "D1" ? BIR_1604C_C1_FIELDS : BIR_1604C_C2_FIELDS;
    for (const field of controls.slice(5)) {
      let total = 0;
      for (const row of input.records.filter(record => record.schedule === schedule)) {
        const value = parseAmount(row.fields?.[field]);
        if (value !== null) total += value;
      }
      if (total > 9_999_999_999_999)
        add("CONTROL_OVERFLOW", schedule + " control total for " + field + " exceeds the 14-character BIR numeric column.", undefined, field);
    }
  }
  return { canGenerateCandidate: issues.length === 0, issues };
}

/**
 * The app cannot assert a module pass without operator evidence bound to the
 * exact bytes. Merely passing this local validator always yields "not run".
 */
export type BirModuleValidationStatus = "yes" | "no" | "not run";
export function birModuleV70Status(evidence?: {
  moduleVersion: string;
  generatedFileSha256: string;
  validatedFileSha256: string;
  outcome: "pass" | "fail";
  evidenceReference: string;
}): BirModuleValidationStatus {
  if (!evidence || evidence.moduleVersion !== "7.0" ||
      !/^[0-9a-f]{64}$/i.test(evidence.generatedFileSha256) ||
      evidence.generatedFileSha256.toLowerCase() !== evidence.validatedFileSha256.toLowerCase() ||
      !reviewedString(evidence.evidenceReference)) return "not run";
  return evidence.outcome === "pass" ? "yes" : "no";
}

/**
 * Versioned, feature-gated candidate builder for independently reviewed source
 * payloads. A caller cannot make a claim of official validator acceptance.
 * This function has no DB writes, tenant side effects or public endpoint.
 */
export function buildReviewedBir1604cCandidate(
  input: Parameters<typeof validateBir1604cPreExport>[0],
  enabled: boolean = process.env.BIR_1604C_DAT_CANDIDATE_ENABLED === "true",
) {
  if (!enabled) return {
    ok: false as const, validatedAgainstModuleV70: "not run" as const,
    issues: [{ code: "FEATURE_DISABLED", message: "Reviewed 1604-C DAT candidate export is disabled." }],
  };
  const validation = validateBir1604cPreExport(input);
  if (!validation.canGenerateCandidate) return {
    ok: false as const, validatedAgainstModuleV70: "not run" as const,
    issues: validation.issues,
  };
  const result = buildBir1604cDatCandidate({
    employerTin: input.employerTin, employerBranch: input.employerBranch,
    taxYear: input.taxYear, expectedEmployees: input.expectedEmployees,
    expectedActualWithheld: input.expectedActualWithheld,
    records: input.records.map(record => ({
      schedule: record.schedule, fields: record.fields,
    })),
  });
  return {
    ok: true as const, validatedAgainstModuleV70: "not run" as const,
    issues: [], candidate: result,
  };
}
