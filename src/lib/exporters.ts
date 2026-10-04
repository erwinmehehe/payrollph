import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bankTemplates, employees, organizations, payrollEntries, payrollRuns } from "@/db/schema";
import { decryptBankAccount } from "@/lib/bank-account-crypto";
import { decryptGovernmentId } from "@/lib/government-id-crypto";
import { computePagIbig, computePhilHealth, computeSss } from "@/lib/payroll-rules";
import { escapeCsvCell } from "@/lib/csv";

const csv = escapeCsvCell;
const round2 = (value: number) => Math.round(value * 100) / 100;

type PaymentSnapshot = {
  employeeName: string;
  employeeNo: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  email: string | null;
  bankAccount: string | null;
  bankCode: string | null;
  mobile: string | null;
  identityFieldsCaptured: boolean;
};

const MAPPED_BANK_FIELDS = [
  "account_number",
  "employee_name",
  "employee_no",
  "first_name",
  "middle_name",
  "last_name",
  "email",
  "mobile",
  "bank_code",
  "amount",
  "net_pay",
  "payment_date",
  "reference",
] as const;

type MappedBankField = (typeof MAPPED_BANK_FIELDS)[number];

type DelimitedBankMapping = {
  columns: MappedBankField[];
  headers: Partial<Record<MappedBankField, string>>;
  delimiter: "," | "\t" | "|" | ";";
  includeHeader: boolean;
  lineEnding: "\n" | "\r\n";
};

export type MappedBankRow = Record<MappedBankField, string | number>;

function readDelimitedBankMapping(value: unknown): DelimitedBankMapping | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.columns) || raw.columns.length === 0) return null;

  const columns = raw.columns.map(String);
  const invalid = columns.find((field) => !MAPPED_BANK_FIELDS.includes(field as MappedBankField));
  if (invalid) {
    throw new Error(
      `Bank template mapping contains unsupported column "${invalid}". Allowed fields: ${MAPPED_BANK_FIELDS.join(", ")}.`,
    );
  }

  const delimiterRaw = typeof raw.delimiter === "string" ? raw.delimiter : ",";
  const delimiter = delimiterRaw === "\\t" ? "\t" : delimiterRaw;
  if (![",", "\t", "|", ";"].includes(delimiter)) {
    throw new Error("Bank template delimiter must be comma, tab, pipe, or semicolon.");
  }

  const headersRaw =
    raw.headers && typeof raw.headers === "object"
      ? raw.headers as Record<string, unknown>
      : {};
  const headers: Partial<Record<MappedBankField, string>> = {};
  for (const field of columns as MappedBankField[]) {
    const header = headersRaw[field];
    if (typeof header === "string" && header.trim()) headers[field] = header.trim();
  }

  return {
    columns: columns as MappedBankField[],
    headers,
    delimiter: delimiter as DelimitedBankMapping["delimiter"],
    includeHeader: raw.includeHeader !== false,
    lineEnding: raw.lineEnding === "CRLF" ? "\r\n" : "\n",
  };
}

export function renderMappedBankRows(rows: MappedBankRow[], mapping: DelimitedBankMapping) {
  const escape = (value: string | number) => {
    const text = String(value ?? "");
    if (mapping.delimiter === ",") return csv(text);
    if (
      text.includes(mapping.delimiter)
      || text.includes("\n")
      || text.includes("\r")
      || text.includes('"')
    ) {
      return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
  };

  const lines: string[] = [];
  if (mapping.includeHeader) {
    lines.push(
      mapping.columns
        .map((field) => escape(mapping.headers[field] ?? field))
        .join(mapping.delimiter),
    );
  }
  lines.push(
    ...rows.map((row) =>
      mapping.columns.map((field) => escape(row[field])).join(mapping.delimiter)
    ),
  );
  return lines.join(mapping.lineEnding);
}

function readPaymentSnapshot(value: unknown): PaymentSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const payment = (value as Record<string, unknown>).payment;
  if (!payment || typeof payment !== "object") return null;
  const row = payment as Record<string, unknown>;
  const employeeName = typeof row.employeeName === "string" ? row.employeeName.trim() : "";
  const employeeNo = typeof row.employeeNo === "string" ? row.employeeNo.trim() : "";
  if (!employeeName || !employeeNo) return null;
  const nullable = (field: unknown) => typeof field === "string" && field.trim() ? field.trim() : null;
  const identityFieldsCaptured = ["firstName", "middleName", "lastName", "email"]
    .every((field) => Object.prototype.hasOwnProperty.call(row, field));
  return {
    employeeName,
    employeeNo,
    firstName: nullable(row.firstName),
    middleName: nullable(row.middleName),
    lastName: nullable(row.lastName),
    email: nullable(row.email),
    bankAccount: nullable(row.bankAccount),
    bankCode: nullable(row.bankCode),
    mobile: nullable(row.mobile),
    identityFieldsCaptured,
  };
}

export async function generateBankFile(
  runId: number,
  templateName: string,
  dryRun = true,
  options: { allowSyntheticDemoDestinations?: boolean } = {},
) {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) throw new Error("Payroll run not found");
  const [template] = await db.select().from(bankTemplates).where(eq(bankTemplates.name, templateName));
  if (!template) throw new Error("Bank template not found");
  if (!template.active) throw new Error("Bank template is inactive.");

  const entries = await db.select({
    entry: payrollEntries,
    employee: employees,
  })
    .from(payrollEntries)
    .innerJoin(employees, eq(payrollEntries.employeeId, employees.id))
    .where(eq(payrollEntries.payrollRunId, runId))
    .orderBy(asc(employees.id));

  const rows = entries.map(({ entry, employee }) => {
    const snapshot = readPaymentSnapshot(entry.trace);
    const payment = snapshot ?? {
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeNo: employee.employeeNo,
      firstName: employee.firstName,
      middleName: employee.middleName,
      lastName: employee.lastName,
      email: employee.email,
      bankAccount: employee.bankAccount,
      bankCode: employee.bankCode,
      mobile: employee.mobile,
      identityFieldsCaptured: false,
    };
    const storedAccount = decryptBankAccount(payment.bankAccount);
    const syntheticDemoAccount = options.allowSyntheticDemoDestinations
      ? `99${String(employee.id).padStart(8, "0").slice(-8)}`
      : null;

    return {
      employee_name: payment.employeeName,
      employee_no: payment.employeeNo,
      first_name: payment.firstName ?? employee.firstName,
      middle_name: payment.middleName ?? employee.middleName ?? "",
      last_name: payment.lastName ?? employee.lastName,
      email: payment.email ?? employee.email ?? "",
      account_number: storedAccount ?? syntheticDemoAccount ?? "0000000000",
      bank_code: payment.bankCode ?? (options.allowSyntheticDemoDestinations ? "DEMO" : ""),
      mobile: payment.mobile ?? "09000000000",
      net_pay: entry.netPay,
      amount: entry.netPay,
      payment_date: String(run.payDate),
      reference: `PAY-${run.id}-${payment.employeeNo}`,
      paymentSnapshotPresent: Boolean(snapshot),
      immutableIdentitySnapshotPresent: Boolean(snapshot?.identityFieldsCaptured),
    };
  });

  const tName = template.name.toLowerCase();
  const usesMobileDestination = tName.includes("gcash") || tName.includes("maya") || tName.includes("paymaya");
  const validation = {
    dryRun,
    template: template.name,
    version: template.version,
    rowCount: rows.length,
    totalNet: rows.reduce((sum, row) => sum + Number(row.net_pay), 0).toFixed(2),
    missingAccounts: rows.filter((row) => row.account_number === "0000000000").length,
    missingMobiles: rows.filter((row) => row.mobile === "09000000000").length,
    missingPaymentSnapshots: rows.filter((row) => !row.paymentSnapshotPresent).length,
    syntheticDemoDestinations: options.allowSyntheticDemoDestinations === true,
  };

  if (!dryRun) {
    if (run.status !== "Released") {
      throw new Error(`Final bank files require a Released payroll run (currently ${run.status}).`);
    }
    if (validation.missingPaymentSnapshots > 0) {
      throw new Error(
        `Final bank file cannot be generated: ${validation.missingPaymentSnapshots} payroll entr${validation.missingPaymentSnapshots === 1 ? "y lacks" : "ies lack"} an immutable payment snapshot. Recalculate before release.`,
      );
    }
    if (rows.length !== run.employeeCount) {
      throw new Error(
        `Final bank file cannot be generated: register has ${rows.length} rows but the released run records ${run.employeeCount} employees.`,
      );
    }
    if (Math.abs(Number(validation.totalNet) - Number(run.netPay)) > 0.01) {
      throw new Error("Final bank file total does not match the released payroll net pay.");
    }
    if (usesMobileDestination && validation.missingMobiles > 0) {
      throw new Error(
        `Final mobile-wallet file cannot be generated: ${validation.missingMobiles} employee(s) are missing a captured mobile number.`,
      );
    }
    if (!usesMobileDestination && validation.missingAccounts > 0) {
      throw new Error(
        `Final bank file cannot be generated: ${validation.missingAccounts} employee(s) are missing a captured bank account.`,
      );
    }
  }

  let body = "";
  const configuredMapping = readDelimitedBankMapping(template.mappings);
  const isMetrobank = tName.includes("metrobank") || tName.includes("mbtc");
  const isRcbc = tName.includes("rcbc");

  // Corporate payroll upload layouts are bank/enrollment specific. A plausible
  // CSV or DAT is not evidence that the bank will accept it. Final exports must
  // therefore be rendered only from a bank-provided layout that was configured
  // explicitly and can later be tied to an accepted portal-UAT record.
  if (!dryRun && isMetrobank) {
    throw new Error(
      "Metrobank MBOS requires its fixed, non-customizable .xls payroll template downloaded inside MBOS. Linaw will not generate a CSV substitute. Use the current bank template and complete bank-portal UAT before enabling an automated XLS integration.",
    );
  }
  if (!dryRun && !configuredMapping) {
    const prefix = isRcbc ? "RCBC ROC payroll export" : `${template.name} final export`;
    throw new Error(
      `${prefix} requires an explicit bank-provided/UAT-approved template mapping. Configure bank_templates.mappings from the bank onboarding specification; Linaw will not guess a proprietary upload layout.`,
    );
  }

  const mappedRows: MappedBankRow[] = rows.map((row) => ({
    account_number: row.account_number,
    employee_name: row.employee_name,
    employee_no: row.employee_no,
    first_name: row.first_name,
    middle_name: row.middle_name,
    last_name: row.last_name,
    email: row.email,
    mobile: row.mobile,
    bank_code: row.bank_code,
    amount: Number(row.amount).toFixed(2),
    net_pay: Number(row.net_pay).toFixed(2),
    payment_date: row.payment_date,
    reference: row.reference,
  }));

  if (configuredMapping) {
    const identityFields = new Set<MappedBankField>([
      "first_name",
      "middle_name",
      "last_name",
      "email",
    ]);
    const needsIdentitySnapshot = configuredMapping.columns.some((field) => identityFields.has(field));
    if (!dryRun && needsIdentitySnapshot) {
      const missingIdentitySnapshots = rows.filter((row) => !row.immutableIdentitySnapshotPresent).length;
      if (missingIdentitySnapshots > 0) {
        throw new Error(
          `Final bank file cannot be generated: ${missingIdentitySnapshots} payroll entr${missingIdentitySnapshots === 1 ? "y was" : "ies were"} calculated before immutable identity fields required by the configured bank layout were captured. Recalculate before release.`,
        );
      }
    }
    body = renderMappedBankRows(mappedRows, configuredMapping);
  } else if (isMetrobank) {
    // Official MBOS documentation requires the bank-downloaded Excel 97-2003
    // template with these columns. This CSV is intentionally only a worksheet
    // for reconciling what should be copied into that .xls template.
    const header = ["Last_Name", "First_Name", "Middle_Name", "Employee_Account_Number", "Amount"];
    body = [
      "# METROBANK MBOS WORKSHEET ONLY - DO NOT UPLOAD",
      "# Download the current .xls sample inside MBOS; the bank template cannot be customized.",
      header.join(","),
      ...rows.filter((row) => Number(row.amount) !== 0).map((row) => [
        row.last_name,
        row.first_name,
        row.middle_name,
        row.account_number,
        Number(row.amount).toFixed(2),
      ].map(csv).join(",")),
    ].join("\n");
  } else {
    const header = ["account_number", "employee_name", "net_pay", "employee_no", "payment_date", "reference"];
    body = [
      "# BANK LAYOUT NOT CONFIGURED - VALIDATION WORKSHEET ONLY",
      "# Do not upload this file. Obtain the bank-provided payroll layout/converter and complete portal UAT.",
      header.join(","),
      ...mappedRows.map((row) => [
        row.account_number,
        row.employee_name,
        row.net_pay,
        row.employee_no,
        row.payment_date,
        row.reference,
      ].map(csv).join(",")),
    ].join("\n");
  }
  return {
    filename: `${options.allowSyntheticDemoDestinations ? "demo-" : ""}${template.name.replaceAll(" ", "-").toLowerCase()}-${run.id}.${template.format.toLowerCase()}`,
    contentType: template.format === "CSV" ? "text/csv" : "text/plain",
    body: dryRun
      ? `# DRY-RUN VALIDATION\n# template=${template.name} version=${template.version}\n# rows=${validation.rowCount} totalNet=${validation.totalNet}\n# missingAccounts=${validation.missingAccounts} missingMobiles=${validation.missingMobiles} missingPaymentSnapshots=${validation.missingPaymentSnapshots}\n# syntheticDemoDestinations=${validation.syntheticDemoDestinations}\n# This is a preview. Final files require a released run and immutable payment snapshots.\n${body}`
      : body,
    validation: {
      ...validation,
      uploadReady: !dryRun && Boolean(configuredMapping) && !isMetrobank,
      layoutSource: configuredMapping ? "configured-bank-layout" : "unconfigured",
    },
  };
}

export async function generateJournalCsv(runId: number) {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) throw new Error("Payroll run not found");

  const entries = await db.select({
    entry: payrollEntries,
    employee: employees,
  })
    .from(payrollEntries)
    .innerJoin(employees, eq(payrollEntries.employeeId, employees.id))
    .where(eq(payrollEntries.payrollRunId, runId))
    .orderBy(asc(employees.id));

  const totals = {
    gross: 0,
    net: 0,
    attendanceReductions: 0,
    reimbursements: 0,
    deMinimis: 0,
    sssEe: 0,
    philHealthEe: 0,
    pagIbigEe: 0,
    pagIbigVoluntary: 0,
    birWht: 0,
    governmentLoans: 0,
    companyLoans: 0,
    advances: 0,
    benefitDeductions: 0,
    sssEr: 0,
    ecEr: 0,
    philHealthEr: 0,
    pagIbigEr: 0,
  };

  const traceNumber = (trace: unknown, prefix: string) => {
    if (!trace || typeof trace !== "object") return null;
    const inputs = (trace as Record<string, unknown>).inputs;
    if (!Array.isArray(inputs)) return null;
    const line = inputs.find((item) => typeof item === "string" && item.startsWith(prefix));
    if (typeof line !== "string") return null;
    const value = Number(line.slice(prefix.length));
    return Number.isFinite(value) ? value : null;
  };

  for (const { entry, employee } of entries) {
    totals.gross += Number(entry.grossPay);
    totals.net += Number(entry.netPay);
    const lines = Array.isArray(entry.lineItems)
      ? entry.lineItems as Array<{ code?: string; amount?: string | number; label?: string }>
      : [];

    for (const line of lines) {
      const code = String(line.code ?? "").toUpperCase();
      const amount = Number(line.amount ?? 0);
      if (!Number.isFinite(amount)) continue;
      const abs = Math.abs(amount);

      if (code === "LATE" || code === "UT") totals.attendanceReductions += abs;
      else if (code.startsWith("EXP-")) totals.reimbursements += Math.max(0, amount);
      else if (code.startsWith("DM-")) totals.deMinimis += Math.max(0, amount);
      else if (code === "SSS") totals.sssEe += abs;
      else if (code === "PHIC") totals.philHealthEe += abs;
      else if (code === "HDMF") totals.pagIbigEe += abs;
      else if (code === "HDMF_VOL") totals.pagIbigVoluntary += abs;
      else if (code === "WHT") totals.birWht += abs;
      else if (code.startsWith("LOAN-")) {
        if (/SSS|PAG-IBIG|HDMF/i.test(String(line.label ?? ""))) totals.governmentLoans += abs;
        else totals.companyLoans += abs;
      } else if (code.startsWith("EWA-")) totals.advances += abs;
      else if (code.startsWith("BENEFIT-") || code.startsWith("BEN-")) totals.benefitDeductions += abs;
    }

    const sssMonthlyRemuneration =
      traceNumber(entry.trace, "statutoryMonthlySssCompensation=")
      ?? traceNumber(entry.trace, "statutoryMonthlyCompensation=")
      ?? Number(employee.basicRate);
    const pagIbigMonthlyCompensation =
      traceNumber(entry.trace, "statutoryMonthlyPagIbigCompensation=")
      ?? traceNumber(entry.trace, "statutoryMonthlyCompensation=")
      ?? Number(employee.basicRate);
    const philHealthBase =
      traceNumber(entry.trace, "philHealthContributionBase=")
      ?? Number(employee.basicRate);

    const sssRule = computeSss(sssMonthlyRemuneration);
    const phRule = computePhilHealth(philHealthBase);
    const hdmfRule = computePagIbig(pagIbigMonthlyCompensation);

    const sssLine = lines.find((line) => String(line.code).toUpperCase() === "SSS");
    totals.sssEr +=
      traceNumber(entry.trace, "sssEmployerCutoff=")
      ?? (sssLine ? 2 * Math.abs(Number(sssLine.amount ?? 0)) : 0);
    totals.ecEr +=
      traceNumber(entry.trace, "sssEmployerEcCutoff=")
      ?? round2(sssRule.employerEC / 2);
    totals.philHealthEr +=
      traceNumber(entry.trace, "philHealthEmployerCutoff=")
      ?? round2(phRule.employer / 2);
    totals.pagIbigEr +=
      traceNumber(entry.trace, "pagIbigEmployerCutoff=")
      ?? round2(hdmfRule.employer / 2);
  }

  const salaryExpense = round2(totals.gross - totals.reimbursements - totals.deMinimis - totals.attendanceReductions);
  const employerStatutoryExpense = round2(totals.sssEr + totals.ecEr + totals.philHealthEr + totals.pagIbigEr);

  const header = ["Date", "Journal", "Account", "Debit", "Credit", "Description"];
  const rows: Array<Array<string>> = [];
  const debit = (account: string, amount: number, description: string) => {
    if (amount > 0.004) rows.push([String(run.payDate), "PAYROLL", account, amount.toFixed(2), "", description]);
  };
  const credit = (account: string, amount: number, description: string) => {
    if (amount > 0.004) rows.push([String(run.payDate), "PAYROLL", account, "", amount.toFixed(2), description]);
  };

  debit("Salaries and Wages Expense", salaryExpense, run.periodLabel);
  debit("Employee Reimbursements Expense", totals.reimbursements, run.periodLabel);
  debit("Employee Benefits / De Minimis Expense", totals.deMinimis, run.periodLabel);
  debit("Employer SSS Expense", totals.sssEr, "Employer statutory share");
  debit("Employer EC Expense", totals.ecEr, "Employer compensation contribution");
  debit("Employer PhilHealth Expense", totals.philHealthEr, "Employer statutory share");
  debit("Employer Pag-IBIG Expense", totals.pagIbigEr, "Employer statutory share");

  credit("SSS Employee Contributions Payable", totals.sssEe, "Employee statutory share");
  credit("SSS Employer Contributions Payable", totals.sssEr, "Employer statutory share");
  credit("Employees Compensation Payable", totals.ecEr, "Employer EC contribution");
  credit("PhilHealth Employee Contributions Payable", totals.philHealthEe, "Employee statutory share");
  credit("PhilHealth Employer Contributions Payable", totals.philHealthEr, "Employer statutory share");
  credit("Pag-IBIG Employee Contributions Payable", totals.pagIbigEe, "Employee statutory share");
  credit("Pag-IBIG Voluntary Contributions Payable", totals.pagIbigVoluntary, "Employee-elected voluntary contribution");
  credit("Pag-IBIG Employer Contributions Payable", totals.pagIbigEr, "Employer statutory share");
  credit("BIR Withholding Tax Payable", totals.birWht, "Compensation withholding");
  credit("Government Loan Deductions Payable", totals.governmentLoans, "SSS / Pag-IBIG loan deductions");
  credit("Company Loan Receivable", totals.companyLoans, "Employee company-loan recovery");
  credit("Employee Advances Receivable", totals.advances, "Earned-wage advance recovery");
  credit("Employee Benefit Deductions Payable", totals.benefitDeductions, "Employee benefit deductions");
  credit("Cash/Bank", totals.net, "Net payroll disbursement");

  const debitTotal = rows.reduce((sum, row) => sum + Number(row[3] || 0), 0);
  const creditTotal = rows.reduce((sum, row) => sum + Number(row[4] || 0), 0);
  if (Math.abs(debitTotal - creditTotal) > 0.02) {
    throw new Error(
      `Payroll journal does not balance: debit ₱${debitTotal.toFixed(2)} vs credit ₱${creditTotal.toFixed(2)}. Review unclassified payroll lines before export.`,
    );
  }

  return {
    filename: `xero-qbo-journal-${run.id}.csv`,
    contentType: "text/csv",
    body: [header, ...rows].map((line) => line.map(csv).join(",")).join("\n"),
    summary: {
      sss: round2(totals.sssEe + totals.sssEr + totals.ecEr),
      philHealth: round2(totals.philHealthEe + totals.philHealthEr),
      pagIbig: round2(totals.pagIbigEe + totals.pagIbigVoluntary + totals.pagIbigEr),
      birWithholding: round2(totals.birWht),
      governmentLoans: round2(totals.governmentLoans),
      totalStatutoryLiabilities: round2(
        totals.sssEe
        + totals.sssEr
        + totals.ecEr
        + totals.philHealthEe
        + totals.philHealthEr
        + totals.pagIbigEe
        + totals.pagIbigVoluntary
        + totals.pagIbigEr
        + totals.birWht
      ),
      netPayroll: round2(totals.net),
      employerStatutoryExpense,
    },
  };
}

export async function generateGovernmentDraft(runId: number, kind: string) {
  const supportedKinds = new Set([
    "sss-r3",
    "philhealth-rf1",
    "pagibig-mcrf",
    "bir-1601c",
    "bir-1604c-source",
  ]);
  if (!supportedKinds.has(kind)) {
    throw new Error(`Unsupported government export "${kind}". Exact filing formats are never guessed.`);
  }
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) throw new Error("Payroll run not found");
  const [organization] = await db.select().from(organizations)
    .where(eq(organizations.id, run.organizationId))
    .limit(1);
  const entries = await db.select({
    entry: payrollEntries,
    employee: employees,
  })
    .from(payrollEntries)
    .innerJoin(employees, eq(payrollEntries.employeeId, employees.id))
    .where(eq(payrollEntries.payrollRunId, runId))
    .orderBy(asc(employees.id));

  const traceNumber = (trace: unknown, prefix: string) => {
    if (!trace || typeof trace !== "object") return null;
    const inputs = (trace as Record<string, unknown>).inputs;
    if (!Array.isArray(inputs)) return null;
    const line = inputs.find((item) => typeof item === "string" && item.startsWith(prefix));
    if (typeof line !== "string") return null;
    const value = Number(line.slice(prefix.length));
    return Number.isFinite(value) ? value : null;
  };
  const govId = (value: string | null | undefined) => decryptGovernmentId(value) ?? "";
  const periodEnd = String(run.periodEnd);
  const periodEndDate = new Date(`${periodEnd}T00:00:00Z`);
  const nextDay = new Date(periodEndDate);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const isFinalCutoffOfMonth = nextDay.getUTCMonth() !== periodEndDate.getUTCMonth();
  if (
    ["sss-r3", "philhealth-rf1", "pagibig-mcrf"].includes(kind)
    && !isFinalCutoffOfMonth
  ) {
    throw new Error(
      `Government monthly worksheet "${kind}" must be generated from the final cutoff of the month so monthly statutory bases have completed their true-up.`,
    );
  }

  const headerNote = [
    "# DRAFT ONLY, not a certified government submission file",
    `# kind=${kind}`,
    `# payrollRun=${run.id}`,
    `# period=${run.periodLabel}`,
    "# Validate against the live government portal before filing.",
  ].join("\n");

  if (kind === "sss-r3") {
    // SSS R-3/e-CL is monthly. Recompute the full monthly contribution from
    // the final-cutoff remuneration trace instead of inferring a monthly value
    // by doubling one cutoff deduction. That remains correct for split,
    // first-cutoff, second-cutoff and month-end true-up policies.
    const missingSss = entries.filter(({ employee }) => !govId(employee.sssNo));
    if (missingSss.length > 0) {
      throw new Error(
        `SSS R-3 cannot be generated: ${missingSss.length} employee(s) are missing an SSS number: ${missingSss.map(({ employee }) => employee.employeeNo).join(", ")}.`,
      );
    }

    const body = [
      "SSSNo,LastName,FirstName,MiddleName,MSC,RegularMSC,MPFMSC,SS_EE_Regular,SS_EE_MPF,SS_ER_Regular,SS_ER_MPF,EC_Employer,Total_Contribution",
      ...entries.map(({ employee, entry }) => {
        const monthlyRemuneration =
          traceNumber(entry.trace, "statutoryMonthlySssCompensation=")
          ?? traceNumber(entry.trace, "statutoryMonthlyCompensation=")
          ?? Number(employee.basicRate ?? entry.grossPay ?? 0);
        const sss = computeSss(monthlyRemuneration);
        return [
          govId(employee.sssNo),
          employee.lastName,
          employee.firstName,
          employee.middleName ?? "",
          sss.monthlySalaryCredit.toFixed(2),
          sss.regularMsc.toFixed(2),
          sss.mpfMsc.toFixed(2),
          sss.employeeRegular.toFixed(2),
          sss.employeeMpf.toFixed(2),
          sss.employerRegular.toFixed(2),
          sss.employerMpf.toFixed(2),
          sss.employerEC.toFixed(2),
          sss.total.toFixed(2),
        ].map(csv).join(",");
      }),
    ].join("\n");
    return {
      filename: `sss-ecl-r3-worksheet-${run.id}.csv`,
      contentType: "text/csv",
      body: `${headerNote}\n# SSS employer workflow uses My.SSS e-CL/PRN or the official SSS R3 File Generator.\n# This is a reconciliation worksheet only; do not upload it as a claimed R3 File Generator output.\n# Figures below are full monthly amounts recomputed from the final-cutoff remuneration trace.\n${body}`,
    };
  }

  if (kind === "philhealth-rf1") {
    const missingPins = entries.filter(({ employee }) => !govId(employee.philHealthNo));
    if (missingPins.length > 0) {
      throw new Error(
        `PhilHealth RF-1 cannot be generated: ${missingPins.length} employee(s) are missing a PhilHealth PIN: ${missingPins.map(({ employee }) => employee.employeeNo).join(", ")}.`,
      );
    }

    const body = [
      "PIN,LastName,FirstName,MiddleName,MonthlySalaryBase,EmployeeShare,EmployerShare,TotalPremium",
      ...entries.map(({ employee, entry }) => {
        const monthlyBasic =
          traceNumber(entry.trace, "philHealthContributionBase=")
          ?? Number(employee.basicRate ?? entry.grossPay ?? 0);
        const ph = computePhilHealth(monthlyBasic);
        return [
          govId(employee.philHealthNo),
          employee.lastName,
          employee.firstName,
          employee.middleName ?? "",
          ph.base.toFixed(2),
          ph.employee.toFixed(2),
          ph.employer.toFixed(2),
          ph.total.toFixed(2),
        ].map(csv).join(",");
      }),
    ].join("\n");
    return {
      filename: `philhealth-eprs-rf1-worksheet-${run.id}.csv`,
      contentType: "text/csv",
      body: `${headerNote}\n# PhilHealth requires employers to use EPRS for premium reporting and payment. This worksheet is a portal-entry aid, not an EPRS acknowledgement.\n# Full monthly premium amounts are recomputed from monthly basic salary.\n${body}`,
    };
  }

  if (kind === "pagibig-mcrf") {
    const employerId = String(organization?.pagIbigEmployerNo ?? "").replace(/\D/g, "");
    if (!employerId) {
      throw new Error("Pag-IBIG MCRF source cannot be generated: the organization Pag-IBIG Employer ID is required.");
    }
    const missingMids = entries.filter(({ employee }) => !govId(employee.pagIbigNo));
    if (missingMids.length > 0) {
      throw new Error(
        `Pag-IBIG MCRF source cannot be generated: ${missingMids.length} employee(s) are missing a Pag-IBIG MID/RTN: ${missingMids.map(({ employee }) => employee.employeeNo).join(", ")}.`,
      );
    }

    const perCov = String(run.periodEnd).slice(0, 7).replace("-", "");
    const memberHeader = "PagIBIGIDRTN,AccountNumber,MembershipProgram,LastName,FirstName,NameExtension,MiddleName,Percov,EEShare,ERShare,Remarks";
    const memberRows = entries.map(({ employee, entry }) => {
      const monthlyRemuneration =
        traceNumber(entry.trace, "statutoryMonthlyPagIbigCompensation=")
        ?? traceNumber(entry.trace, "statutoryMonthlyCompensation=")
        ?? Number(employee.basicRate ?? entry.grossPay ?? 0);
      const hd = computePagIbig(monthlyRemuneration);
      const newHireRemark = String(employee.startDate).slice(0, 7).replace("-", "") === perCov ? "N" : "";
      return [
        govId(employee.pagIbigNo).replace(/\D/g, ""),
        "",
        "F1",
        employee.lastName,
        employee.firstName,
        "",
        employee.middleName ?? "",
        perCov,
        hd.employee.toFixed(2),
        hd.employer.toFixed(2),
        newHireRemark,
      ].map(csv).join(",");
    });
    const body = [memberHeader, ...memberRows].join("\n");
    const officialWorkbookName = `${employerId}${perCov}.xls`;
    return {
      filename: `pagibig-mcrf-source-${run.id}.csv`,
      contentType: "text/csv",
      body: `${headerNote}\n# EmployerID=${employerId}\n# EmployerName=${organization?.legalName ?? organization?.name ?? ""}\n# Official Pag-IBIG instructions prescribe an Excel MCRF workbook, period YYYYMM, and filename ${officialWorkbookName}.\n# This CSV mirrors the member-level source columns for reconciliation/copying only; it is NOT the prescribed .xls workbook and must not be uploaded as one.\n${body}`,
    };
  }
  if (kind === "bir-1601c") {
    const totalWht = entries.reduce((sum, { entry }) => {
      const wht = Math.abs(Number((entry.lineItems as Array<{ code: string; amount: string }> | undefined)?.find?.((item) => item.code === "WHT")?.amount ?? 0));
      return sum + wht;
    }, 0);
    const body = [
      "Form,Period,WithholdingTax,Employees,Status",
      ["1601-C", run.periodLabel, totalWht.toFixed(2), String(entries.length), "DRAFT"].map(csv).join(","),
    ].join("\n");
    return { filename: `bir-1601c-draft-${run.id}.csv`, contentType: "text/csv", body: `${headerNote}\n${body}` };
  }

  if (kind !== "bir-1604c-source") {
    throw new Error(`Government export "${kind}" is not implemented.`);
  }

  // BIR annual summary input. This remains a source extract, not a claimed
  // filing-ready DAT. A single cutoff cannot prove the complete annual filing
  // contract, so the exporter fails closed instead of guessing portal bytes.
  const employerTin = (organization?.birTin ?? "").replace(/\D/g, "");
  const employerBranchCode = (organization?.birBranchCode ?? "").replace(/\D/g, "").padStart(4, "0");

  if (employerTin.length !== 9 || employerBranchCode.length !== 4) {
    throw new Error("BIR annual draft cannot be generated: employer BIR TIN and 4-digit branch code are required.");
  }

  const missingTin = entries.filter(({ employee }) => govId(employee.tin).replace(/\D/g, "").length !== 9);
  const missingBranch = entries.filter(({ employee }) => govId(employee.tinBranchCode).replace(/\D/g, "").length !== 4);
  if (missingTin.length > 0) {
    throw new Error(
      `BIR annual draft cannot be generated: ${missingTin.length} employee(s) are missing a valid 9-digit TIN: ${missingTin.map(({ employee }) => employee.employeeNo).join(", ")}.`,
    );
  }
  if (missingBranch.length > 0) {
    throw new Error(
      `BIR annual draft cannot be generated: ${missingBranch.length} employee(s) are missing a 4-digit BIR branch code: ${missingBranch.map(({ employee }) => employee.employeeNo).join(", ")}.`,
    );
  }

  const body = [
    "EmployerTIN,EmployerBranchCode,EmployeeTIN,EmployeeBranchCode,LastName,FirstName,MiddleName,Nationality,GrossCompensation,TaxWithheld,MWE,Status",
    ...entries.map(({ employee, entry }) => [
      employerTin,
      employerBranchCode,
      govId(employee.tin).replace(/\D/g, ""),
      govId(employee.tinBranchCode).replace(/\D/g, ""),
      employee.lastName,
      employee.firstName,
      employee.middleName ?? "",
      employee.nationality ?? "Filipino",
      entry.grossPay,
      Math.abs(Number((entry.lineItems as Array<{ code: string; amount: string }> | undefined)?.find?.((item) => item.code === "WHT")?.amount ?? 0)).toFixed(2),
      employee.mwe ? "Y" : "N",
      "DRAFT",
    ].map(csv).join(",")),
  ].join("\n");

  return {
    filename: `bir-1604c-annual-source-${run.id}.csv`,
    contentType: "text/csv",
    body: `${headerNote}\n# Source extract only. Validate and transform this annual dataset through the current BIR validation workflow before filing.\n${body}`,
  };
}
