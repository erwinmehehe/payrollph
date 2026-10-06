import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  bankTemplates,
  costCenters,
  employeeLaborAllocations,
  employees,
  laborGlMappings,
  legalEntities,
  organizations,
  payrollEntries,
  payrollRuns,
} from "@/db/schema";
import { decryptBankAccount } from "@/lib/bank-account-crypto";
import { decryptGovernmentId } from "@/lib/government-id-crypto";
import { computePagIbig, computePhilHealth, computeSss } from "@/lib/payroll-rules";
import { escapeCsvCell } from "@/lib/csv";
import {
  allocateLaborAmount,
  resolveLaborAllocation,
  resolveLaborGlAccount,
  type LaborGlAccountKey,
} from "@/lib/labor-costing";

const csv = escapeCsvCell;
const round2 = (value: number) => Math.round(value * 100) / 100;

export function taxWithheldFromLineItems(value: unknown) {
  const lines = Array.isArray(value)
    ? value as Array<{ code?: string; amount?: string | number }>
    : [];

  return round2(lines.reduce((sum, line) => {
    const code = String(line.code ?? "").toUpperCase();
    const amount = Number(line.amount ?? 0);
    if (!Number.isFinite(amount)) return sum;
    if (code === "WHT") return sum + Math.abs(amount);
    // YE-TAX refunds are positive payroll additions and therefore reduce the
    // BIR liability; collections are negative deductions and increase it.
    if (code.startsWith("YE-TAX-")) return sum - amount;
    return sum;
  }, 0));
}

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

  const bankProvidedMapping = readDelimitedBankMapping(template.mappings);
  const mappedProprietaryBank =
    tName.includes("bdo")
    || tName.includes("bpi")
    || tName.includes("bizlink")
    || tName.includes("unionbank")
    || tName.includes("onehub")
    || tName.includes("security bank")
    || tName.includes("chinabank")
    || tName.includes("cbc")
    || tName.includes("eastwest")
    || tName.includes("rcbc");

  if (tName.includes("metrobank") || tName.includes("mbtc")) {
    // Metrobank's published MBOS guide requires its portal-downloaded,
    // preformatted Excel 97-2003 (.xls) payroll template and explicitly says
    // the template cannot be customized. A CSV approximation is therefore not
    // an acceptable production export.
    throw new Error(
      "Metrobank MBOS payroll requires the bank-provided formatted .xls template downloaded inside MBOS. PayrollPH will not generate a guessed CSV substitute. Capture and validate the exact bank template through UAT before enabling final export.",
    );
  }

  if (mappedProprietaryBank) {
    if (!bankProvidedMapping) {
      throw new Error(
        `${template.name} payroll export requires an explicit bank-provided template mapping. Configure bank_templates.mappings from the bank's current corporate-payroll specification and record portal UAT for that exact template version; PayrollPH will not guess a proprietary layout.`,
      );
    }
    if (template.format.toUpperCase() === "XLS" || template.format.toUpperCase() === "XLSX") {
      throw new Error(
        `${template.name} uses a workbook template that cannot be reproduced safely from a delimited mapping. Store/use the exact bank-provided workbook and validate it in the corporate portal instead of generating substitute bytes.`,
      );
    }

    const identityFields = new Set<MappedBankField>([
      "first_name",
      "middle_name",
      "last_name",
      "email",
    ]);
    const needsIdentitySnapshot = bankProvidedMapping.columns.some((field) => identityFields.has(field));
    if (!dryRun && needsIdentitySnapshot) {
      const missingIdentitySnapshots = rows.filter((row) => !row.immutableIdentitySnapshotPresent).length;
      if (missingIdentitySnapshots > 0) {
        throw new Error(
          `Final ${template.name} file cannot be generated: ${missingIdentitySnapshots} payroll entr${missingIdentitySnapshots === 1 ? "y was" : "ies were"} calculated before immutable identity fields were captured. Recalculate before release.`,
        );
      }
    }

    body = renderMappedBankRows(
      rows.map((row) => ({
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
      })),
      bankProvidedMapping,
    );
  } else if (tName.includes("gcash")) {
    const header = ["mobile", "employee_name", "amount", "reference"];
    body = [header.join(","), ...rows.map((row) => [row.mobile, row.employee_name, row.amount, `${run.id}-${row.employee_no}`].map(csv).join(","))].join("\n");
  } else if (tName.includes("maya") || tName.includes("paymaya")) {
    const header = ["Recipient_Mobile", "Recipient_Name", "Disbursement_Amount", "Batch_Reference"];
    body = [header.join(","), ...rows.map((row) => [row.mobile, row.employee_name, row.amount, `MAYA-${run.id}-${row.employee_no}`].map(csv).join(","))].join("\n");
  } else if (tName.includes("america") || tName.includes("cashpro")) {
    const header = ["Receiving_Account", "Account_Holder", "Amount", "Currency", "PBR_Reference"];
    body = [header.join(","), ...rows.map((row) => [row.account_number, row.employee_name, row.amount, "PHP", `BOA-${run.id}-${row.employee_no}`].map(csv).join(","))].join("\n");
  } else if (bankProvidedMapping) {
    body = renderMappedBankRows(
      rows.map((row) => ({
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
      })),
      bankProvidedMapping,
    );
  } else {
    throw new Error(
      `${template.name} has no verified bank-provided file mapping. PayrollPH will not emit a generic "universal bank CSV" for an unverified bank template.`,
    );
  }

  return {
    filename: `${options.allowSyntheticDemoDestinations ? "demo-" : ""}${template.name.replaceAll(" ", "-").toLowerCase()}-${run.id}.${template.format.toLowerCase()}`,
    contentType: template.format === "CSV" ? "text/csv" : "text/plain",
    body: dryRun
      ? `# DRY-RUN VALIDATION\n# template=${template.name} version=${template.version}\n# rows=${validation.rowCount} totalNet=${validation.totalNet}\n# missingAccounts=${validation.missingAccounts} missingMobiles=${validation.missingMobiles} missingPaymentSnapshots=${validation.missingPaymentSnapshots}\n# syntheticDemoDestinations=${validation.syntheticDemoDestinations}\n# This is a preview. Final files require a released run and immutable payment snapshots.\n${body}`
      : body,
    validation,
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

  const [allocationRows, centerRows, mappingRows, entityRows] = await Promise.all([
    db.select().from(employeeLaborAllocations)
      .where(eq(employeeLaborAllocations.organizationId, run.organizationId))
      .orderBy(asc(employeeLaborAllocations.employeeId), asc(employeeLaborAllocations.id)),
    db.select().from(costCenters)
      .where(eq(costCenters.organizationId, run.organizationId))
      .orderBy(asc(costCenters.code)),
    db.select().from(laborGlMappings)
      .where(eq(laborGlMappings.organizationId, run.organizationId))
      .orderBy(asc(laborGlMappings.id)),
    db.select().from(legalEntities)
      .where(eq(legalEntities.organizationId, run.organizationId))
      .orderBy(asc(legalEntities.code)),
  ]);
  const centerById = new Map(centerRows.map((row) => [row.id, row]));
  const entityById = new Map(entityRows.map((row) => [row.id, row]));

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

  const header = [
    "Date",
    "Journal",
    "Legal Entity",
    "Cost Center",
    "Client",
    "Project",
    "Job",
    "Account Code",
    "Account",
    "Debit",
    "Credit",
    "Description",
  ];
  const rows: Array<Array<string>> = [];

  const pushJournalRow = (input: {
    side: "debit" | "credit";
    amount: number;
    legalEntityId: number | null;
    costCenterId: number | null;
    clientCode?: string | null;
    projectCode?: string | null;
    jobCode?: string | null;
    accountKey: LaborGlAccountKey;
    fallbackAccountName: string;
    description: string;
  }) => {
    if (input.amount <= 0.004) return;
    const account = resolveLaborGlAccount({
      mappings: mappingRows,
      legalEntityId: input.legalEntityId,
      costCenterId: input.costCenterId,
      accountKey: input.accountKey,
      fallbackName: input.fallbackAccountName,
    });
    const entity = input.legalEntityId ? entityById.get(input.legalEntityId) : null;
    const center = input.costCenterId ? centerById.get(input.costCenterId) : null;
    rows.push([
      String(run.payDate),
      "PAYROLL",
      entity ? entity.code : "",
      center ? center.code : "",
      input.clientCode ?? "",
      input.projectCode ?? "",
      input.jobCode ?? "",
      account.accountCode ?? "",
      account.accountName,
      input.side === "debit" ? input.amount.toFixed(2) : "",
      input.side === "credit" ? input.amount.toFixed(2) : "",
      input.description,
    ]);
  };

  for (const { entry, employee } of entries) {
    const employeeTotals = {
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
    const gross = Number(entry.grossPay);
    const net = Number(entry.netPay);
    totals.gross += gross;
    totals.net += net;

    const lines = Array.isArray(entry.lineItems)
      ? entry.lineItems as Array<{ code?: string; amount?: string | number; label?: string }>
      : [];
    employeeTotals.birWht = taxWithheldFromLineItems(lines);

    for (const line of lines) {
      const code = String(line.code ?? "").toUpperCase();
      const amount = Number(line.amount ?? 0);
      if (!Number.isFinite(amount)) continue;
      const abs = Math.abs(amount);

      if (code === "LATE" || code === "UT") employeeTotals.attendanceReductions += abs;
      else if (code.startsWith("EXP-")) employeeTotals.reimbursements += Math.max(0, amount);
      else if (code.startsWith("DM-")) employeeTotals.deMinimis += Math.max(0, amount);
      else if (code === "SSS") employeeTotals.sssEe += abs;
      else if (code === "PHIC") employeeTotals.philHealthEe += abs;
      else if (code === "HDMF") employeeTotals.pagIbigEe += abs;
      else if (code === "HDMF_VOL") employeeTotals.pagIbigVoluntary += abs;
      else if (code.startsWith("LOAN-")) {
        if (/SSS|PAG-IBIG|HDMF/i.test(String(line.label ?? ""))) employeeTotals.governmentLoans += abs;
        else employeeTotals.companyLoans += abs;
      } else if (code.startsWith("EWA-")) employeeTotals.advances += abs;
      else if (code.startsWith("BENEFIT-") || code.startsWith("BEN-")) employeeTotals.benefitDeductions += abs;
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

    employeeTotals.sssEr =
      traceNumber(entry.trace, "sssEmployerCutoff=")
      ?? (sssLine ? 2 * Math.abs(Number(sssLine.amount ?? 0)) : 0);
    employeeTotals.ecEr =
      traceNumber(entry.trace, "sssEmployerEcCutoff=")
      ?? round2(sssRule.employerEC / 2);
    employeeTotals.philHealthEr =
      traceNumber(entry.trace, "philHealthEmployerCutoff=")
      ?? round2(phRule.employer / 2);
    employeeTotals.pagIbigEr =
      traceNumber(entry.trace, "pagIbigEmployerCutoff=")
      ?? round2(hdmfRule.employer / 2);

    totals.attendanceReductions += employeeTotals.attendanceReductions;
    totals.reimbursements += employeeTotals.reimbursements;
    totals.deMinimis += employeeTotals.deMinimis;
    totals.sssEe += employeeTotals.sssEe;
    totals.philHealthEe += employeeTotals.philHealthEe;
    totals.pagIbigEe += employeeTotals.pagIbigEe;
    totals.pagIbigVoluntary += employeeTotals.pagIbigVoluntary;
    totals.birWht += employeeTotals.birWht;
    totals.governmentLoans += employeeTotals.governmentLoans;
    totals.companyLoans += employeeTotals.companyLoans;
    totals.advances += employeeTotals.advances;
    totals.benefitDeductions += employeeTotals.benefitDeductions;
    totals.sssEr += employeeTotals.sssEr;
    totals.ecEr += employeeTotals.ecEr;
    totals.philHealthEr += employeeTotals.philHealthEr;
    totals.pagIbigEr += employeeTotals.pagIbigEr;

    const legalEntityId = employee.legalEntityId ?? run.legalEntityId ?? null;
    const resolved = resolveLaborAllocation({
      employeeId: employee.id,
      asOf: String(run.periodEnd),
      rows: allocationRows.map((row) => ({
        id: row.id,
        employeeId: row.employeeId,
        costCenterId: row.costCenterId,
        effectiveFrom: String(row.effectiveFrom),
        effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
        allocationPercent: row.allocationPercent,
        allocationBasis: row.allocationBasis,
        allocationHours: row.allocationHours,
        projectCode: row.projectCode,
        clientCode: row.clientCode,
        jobCode: row.jobCode,
      })),
    });

    const description = `${employee.employeeNo} · ${run.periodLabel}`;
    const salaryExpense = round2(
      gross
      - employeeTotals.reimbursements
      - employeeTotals.deMinimis
      - employeeTotals.attendanceReductions,
    );
    const expenseLines: Array<{
      accountKey: LaborGlAccountKey;
      fallbackAccountName: string;
      amount: number;
      description: string;
    }> = [
      { accountKey: "salary_expense", fallbackAccountName: "Salaries and Wages Expense", amount: salaryExpense, description },
      { accountKey: "reimbursements_expense", fallbackAccountName: "Employee Reimbursements Expense", amount: employeeTotals.reimbursements, description },
      { accountKey: "de_minimis_expense", fallbackAccountName: "Employee Benefits / De Minimis Expense", amount: employeeTotals.deMinimis, description },
      { accountKey: "sss_employer_expense", fallbackAccountName: "Employer SSS Expense", amount: employeeTotals.sssEr, description: `${description} · employer SSS` },
      { accountKey: "ec_employer_expense", fallbackAccountName: "Employer EC Expense", amount: employeeTotals.ecEr, description: `${description} · employer EC` },
      { accountKey: "philhealth_employer_expense", fallbackAccountName: "Employer PhilHealth Expense", amount: employeeTotals.philHealthEr, description: `${description} · employer PhilHealth` },
      { accountKey: "pagibig_employer_expense", fallbackAccountName: "Employer Pag-IBIG Expense", amount: employeeTotals.pagIbigEr, description: `${description} · employer Pag-IBIG` },
    ];

    for (const expense of expenseLines) {
      for (const allocated of allocateLaborAmount(expense.amount, resolved)) {
        pushJournalRow({
          side: "debit",
          amount: allocated.amount,
          legalEntityId,
          costCenterId: allocated.costCenterId,
          clientCode: allocated.clientCode,
          projectCode: allocated.projectCode,
          jobCode: allocated.jobCode,
          accountKey: expense.accountKey,
          fallbackAccountName: expense.fallbackAccountName,
          description: expense.description,
        });
      }
    }

    const credits: Array<{
      accountKey: LaborGlAccountKey;
      fallbackAccountName: string;
      amount: number;
      description: string;
    }> = [
      { accountKey: "sss_employee_payable", fallbackAccountName: "SSS Employee Contributions Payable", amount: employeeTotals.sssEe, description: `${description} · employee SSS` },
      { accountKey: "sss_employer_payable", fallbackAccountName: "SSS Employer Contributions Payable", amount: employeeTotals.sssEr, description: `${description} · employer SSS` },
      { accountKey: "ec_payable", fallbackAccountName: "Employees Compensation Payable", amount: employeeTotals.ecEr, description: `${description} · employer EC` },
      { accountKey: "philhealth_employee_payable", fallbackAccountName: "PhilHealth Employee Contributions Payable", amount: employeeTotals.philHealthEe, description: `${description} · employee PhilHealth` },
      { accountKey: "philhealth_employer_payable", fallbackAccountName: "PhilHealth Employer Contributions Payable", amount: employeeTotals.philHealthEr, description: `${description} · employer PhilHealth` },
      { accountKey: "pagibig_employee_payable", fallbackAccountName: "Pag-IBIG Employee Contributions Payable", amount: employeeTotals.pagIbigEe, description: `${description} · employee Pag-IBIG` },
      { accountKey: "pagibig_voluntary_payable", fallbackAccountName: "Pag-IBIG Voluntary Contributions Payable", amount: employeeTotals.pagIbigVoluntary, description: `${description} · voluntary Pag-IBIG` },
      { accountKey: "pagibig_employer_payable", fallbackAccountName: "Pag-IBIG Employer Contributions Payable", amount: employeeTotals.pagIbigEr, description: `${description} · employer Pag-IBIG` },
      { accountKey: "bir_withholding_payable", fallbackAccountName: "BIR Withholding Tax Payable", amount: employeeTotals.birWht, description: `${description} · compensation withholding` },
      { accountKey: "government_loans_payable", fallbackAccountName: "Government Loan Deductions Payable", amount: employeeTotals.governmentLoans, description: `${description} · government loan deductions` },
      { accountKey: "company_loan_receivable", fallbackAccountName: "Company Loan Receivable", amount: employeeTotals.companyLoans, description: `${description} · company loan recovery` },
      { accountKey: "employee_advances_receivable", fallbackAccountName: "Employee Advances Receivable", amount: employeeTotals.advances, description: `${description} · earned-wage advance recovery` },
      { accountKey: "employee_benefits_payable", fallbackAccountName: "Employee Benefit Deductions Payable", amount: employeeTotals.benefitDeductions, description: `${description} · employee benefit deductions` },
      { accountKey: "cash_bank", fallbackAccountName: "Cash/Bank", amount: net, description: `${description} · net payroll disbursement` },
    ];
    for (const creditLine of credits) {
      pushJournalRow({
        side: creditLine.amount < 0 ? "debit" : "credit",
        amount: Math.abs(creditLine.amount),
        legalEntityId,
        costCenterId: null,
        accountKey: creditLine.accountKey,
        fallbackAccountName: creditLine.fallbackAccountName,
        description: creditLine.description,
      });
    }
  }

  const employerStatutoryExpense = round2(totals.sssEr + totals.ecEr + totals.philHealthEr + totals.pagIbigEr);
  const debitTotal = rows.reduce((sum, row) => sum + Number(row[9] || 0), 0);
  const creditTotal = rows.reduce((sum, row) => sum + Number(row[10] || 0), 0);
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

  const monthPrefix = String(run.payDate).slice(0, 7);
  const monthlyRuns = isFinalCutoffOfMonth
    ? (await db.select().from(payrollRuns)
        .where(eq(payrollRuns.organizationId, run.organizationId)))
        .filter((candidate) =>
          String(candidate.payDate).startsWith(monthPrefix)
          && (candidate.status === "Released" || candidate.id === run.id)
        )
    : [];
  const monthlyRunIds = monthlyRuns.map((candidate) => candidate.id);
  const monthlyEntryRows = monthlyRunIds.length
    ? await db.select({
        entry: payrollEntries,
        employee: employees,
        runId: payrollRuns.id,
        payDate: payrollRuns.payDate,
        periodEnd: payrollRuns.periodEnd,
      })
        .from(payrollEntries)
        .innerJoin(employees, eq(payrollEntries.employeeId, employees.id))
        .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
        .where(inArray(payrollEntries.payrollRunId, monthlyRunIds))
        .orderBy(
          asc(payrollRuns.payDate),
          asc(payrollRuns.periodEnd),
          asc(payrollRuns.id),
          asc(employees.id),
        )
    : [];

  // Monthly statutory remittances are population reports, not "last cutoff"
  // reports. Use every released payroll in the pay month plus the current final
  // cutoff, then keep each employee's latest month-to-date trace. This preserves
  // employees paid earlier in the month who separated before the final cutoff,
  // and it also covers organizations that run separate payrolls per org unit.
  const statutoryLatestByEmployee = new Map<number, {
    entry: typeof payrollEntries.$inferSelect;
    employee: typeof employees.$inferSelect;
  }>();
  for (const row of monthlyEntryRows) {
    statutoryLatestByEmployee.set(row.employee.id, {
      entry: row.entry,
      employee: row.employee,
    });
  }
  const monthlyStatutoryEntries = [...statutoryLatestByEmployee.values()]
    .sort((a, b) => a.employee.id - b.employee.id);

  const headerNote = [
    "# DRAFT ONLY, not a certified government submission file",
    `# kind=${kind}`,
    `# payrollRun=${run.id}`,
    `# period=${run.periodLabel}`,
    "# Validate against the live government portal before filing.",
  ].join("\n");

  if (kind === "sss-r3") {
    // SSS R-3 is a monthly filing. A single payroll run's stored line item is
    // only half the employee's monthly SSS share, by design, the payroll
    // engine splits it evenly across the two semi-monthly cutoffs
    // (payroll-engine.ts: `sss = sssRule.employee / 2`). This draft recomputes
    // the real monthly figures from computeSss() (single source of truth,
    // shared with the actual payroll calculation) instead of doubling a
    // stored half-month amount, which would silently drift if that split ever
    // changes. This also fixes a previous bug where EC was hardcoded to
    // ₱10.00 for every employee regardless of their actual MSC (correct EC is
    // ₱30 at MSC ≥ ₱15,000, most employees above roughly ₱15,000/month basic
    // pay were being under-reported).
    const missingSss = monthlyStatutoryEntries.filter(({ employee }) => !govId(employee.sssNo));
    if (missingSss.length > 0) {
      throw new Error(
        `SSS R-3 cannot be generated: ${missingSss.length} employee(s) are missing an SSS number: ${missingSss.map(({ employee }) => employee.employeeNo).join(", ")}.`,
      );
    }

    const body = [
      "SSSNo,LastName,FirstName,MiddleName,MSC,RegularMSC,MPFMSC,SS_EE_Regular,SS_EE_MPF,SS_ER_Regular,SS_ER_MPF,EC_Employer,Total_Contribution",
      ...monthlyStatutoryEntries.map(({ employee, entry }) => {
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
      body: `${headerNote}\n# SSS employer workflow uses My.SSS e-CL and a PRN. This worksheet is not an SSS acknowledgement or a certified R3 File Generator output.\n# Figures below are full monthly amounts (recomputed from basic pay), not this single cutoff's half-month deduction.\n${body}`,
    };
  }

  if (kind === "philhealth-rf1") {
    const missingPins = monthlyStatutoryEntries.filter(({ employee }) => !govId(employee.philHealthNo));
    if (missingPins.length > 0) {
      throw new Error(
        `PhilHealth RF-1 cannot be generated: ${missingPins.length} employee(s) are missing a PhilHealth PIN: ${missingPins.map(({ employee }) => employee.employeeNo).join(", ")}.`,
      );
    }

    const body = [
      "PIN,LastName,FirstName,MiddleName,MonthlySalaryBase,EmployeeShare,EmployerShare,TotalPremium",
      ...monthlyStatutoryEntries.map(({ employee, entry }) => {
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
    const missingMids = monthlyStatutoryEntries.filter(({ employee }) => !govId(employee.pagIbigNo));
    if (missingMids.length > 0) {
      throw new Error(
        `Pag-IBIG MCRF cannot be generated: ${missingMids.length} employee(s) are missing a Pag-IBIG MID: ${missingMids.map(({ employee }) => employee.employeeNo).join(", ")}.`,
      );
    }

    const periodCovered = String(run.periodEnd).slice(0, 7).replace("-", "");
    const body = [
      "PagIBIGMID,AccountNumber,MembershipProgram,LastName,FirstName,NameExtension,MiddleName,PeriodCovered,EmployeeShare,EmployerShare,Remarks,FundSalary,TotalContribution",
      ...monthlyStatutoryEntries.map(({ employee, entry }) => {
        const monthlyRemuneration =
          traceNumber(entry.trace, "statutoryMonthlyPagIbigCompensation=")
          ?? traceNumber(entry.trace, "statutoryMonthlyCompensation=")
          ?? Number(employee.basicRate ?? entry.grossPay ?? 0);
        const hd = computePagIbig(monthlyRemuneration);
        return [
          govId(employee.pagIbigNo),
          "",
          "F1",
          employee.lastName,
          employee.firstName,
          "",
          employee.middleName ?? "",
          periodCovered,
          hd.employee.toFixed(2),
          hd.employer.toFixed(2),
          "",
          hd.fundSalary.toFixed(2),
          hd.total.toFixed(2),
        ].map(csv).join(",");
      }),
    ].join("\n");
    return {
      filename: `pagibig-mcrf-esrs-worksheet-${run.id}.csv`,
      contentType: "text/csv",
      body: `${headerNote}\n# Columns now mirror Pag-IBIG's published MCRF encoding instructions: MID/RTN, account number, membership program, names, YYYYMM period covered, EE share, ER share and remarks. This remains an assisted CSV worksheet because Pag-IBIG prescribes its own spreadsheet/eSRS workflow rather than an arbitrary CSV upload.\n# Full monthly mandatory contributions are recomputed from monthly basic salary.\n${body}`,
    };
  }

  if (kind === "bir-1601c") {
    if (!isFinalCutoffOfMonth) {
      throw new Error(
        "BIR Form 1601-C is a monthly remittance return. Generate the worksheet from the final payroll cutoff of the month so all released payroll withholding for the month is included.",
      );
    }

    const monthRuns = monthlyRuns;
    const monthEntries = monthlyEntryRows.map((row) => row.entry);

    const taxFromEntry = (entry: typeof payrollEntries.$inferSelect) =>
      taxWithheldFromLineItems(entry.lineItems);

    const totalWht = monthEntries.reduce((sum, entry) => sum + taxFromEntry(entry), 0);
    const employeeCount = new Set(monthEntries.map((entry) => entry.employeeId)).size;
    const body = [
      "Form,ApplicableMonth,WithholdingTax,Employees,PayrollRunsIncluded,Status",
      [
        "1601-C",
        monthPrefix,
        totalWht.toFixed(2),
        String(employeeCount),
        String(monthRuns.length),
        "DRAFT",
      ].map(csv).join(","),
    ].join("\n");
    return {
      filename: `bir-1601c-monthly-draft-${monthPrefix}-run-${run.id}.csv`,
      contentType: "text/csv",
      body: `${headerNote}\n# BIR Form 1601-C is monthly. This worksheet aggregates all released payroll runs in ${monthPrefix}, plus this run when it is the current final cutoff.\n${body}`,
    };
  }

  if (kind !== "bir-1604c-source") {
    throw new Error(`Government export "${kind}" is not implemented.`);
  }

  // BIR 1604-C is an annual calendar-year return. Build the source dataset
  // from every released payroll paid within the selected run's tax year, then
  // collapse each employee to one annual row. This is still a source extract,
  // not a claimed filing-ready DAT.
  const calendarYear = (value: unknown) => String(value ?? "").match(/\b\d{4}\b/)?.[0] ?? "";
  const taxYear = calendarYear(run.payDate);
  if (!/^\d{4}$/.test(taxYear)) {
    throw new Error("BIR annual draft cannot be generated: payroll pay date does not identify a valid tax year.");
  }

  const annualRuns = (await db.select().from(payrollRuns)
    .where(eq(payrollRuns.organizationId, run.organizationId)))
    .filter((candidate) =>
      candidate.status === "Released"
      && calendarYear(candidate.payDate) === taxYear
    );
  const annualRunIds = annualRuns.map((candidate) => candidate.id);
  if (annualRunIds.length === 0) {
    throw new Error(`BIR annual draft cannot be generated: no released payroll runs exist for tax year ${taxYear}.`);
  }

  const annualEntries = await db.select({
    entry: payrollEntries,
    employee: employees,
  })
    .from(payrollEntries)
    .innerJoin(employees, eq(payrollEntries.employeeId, employees.id))
    .where(inArray(payrollEntries.payrollRunId, annualRunIds))
    .orderBy(asc(employees.id));

  const [organization] = await db.select().from(organizations)
    .where(eq(organizations.id, run.organizationId))
    .limit(1);
  const employerTin = (organization?.birTin ?? "").replace(/\D/g, "");
  const employerBranchCode = (organization?.birBranchCode ?? "").replace(/\D/g, "").padStart(4, "0");

  if (employerTin.length !== 9 || employerBranchCode.length !== 4) {
    throw new Error("BIR annual draft cannot be generated: employer BIR TIN and 4-digit branch code are required.");
  }

  const annualEmployees = [...new Map(
    annualEntries.map(({ employee }) => [employee.id, employee] as const),
  ).values()];
  const missingTin = annualEmployees.filter((employee) => govId(employee.tin).replace(/\D/g, "").length !== 9);
  const missingBranch = annualEmployees.filter((employee) => govId(employee.tinBranchCode).replace(/\D/g, "").length !== 4);
  if (missingTin.length > 0) {
    throw new Error(
      `BIR annual draft cannot be generated: ${missingTin.length} employee(s) are missing a valid 9-digit TIN: ${missingTin.map((employee) => employee.employeeNo).join(", ")}.`,
    );
  }
  if (missingBranch.length > 0) {
    throw new Error(
      `BIR annual draft cannot be generated: ${missingBranch.length} employee(s) are missing a 4-digit BIR branch code: ${missingBranch.map((employee) => employee.employeeNo).join(", ")}.`,
    );
  }

  const taxFromAnnualEntry = (entry: typeof payrollEntries.$inferSelect) =>
    taxWithheldFromLineItems(entry.lineItems);

  const annualByEmployee = new Map<number, {
    employee: typeof employees.$inferSelect;
    grossCompensation: number;
    taxWithheld: number;
  }>();
  for (const { employee, entry } of annualEntries) {
    const current = annualByEmployee.get(employee.id) ?? {
      employee,
      grossCompensation: 0,
      taxWithheld: 0,
    };
    current.grossCompensation += Number(entry.grossPay ?? 0) || 0;
    current.taxWithheld += taxFromAnnualEntry(entry);
    annualByEmployee.set(employee.id, current);
  }

  const body = [
    "EmployerTIN,EmployerBranchCode,EmployeeTIN,EmployeeBranchCode,LastName,FirstName,MiddleName,Nationality,GrossCompensation,TaxWithheld,MWE,Status",
    ...[...annualByEmployee.values()].map(({ employee, grossCompensation, taxWithheld }) => [
      employerTin,
      employerBranchCode,
      govId(employee.tin).replace(/\D/g, ""),
      govId(employee.tinBranchCode).replace(/\D/g, ""),
      employee.lastName,
      employee.firstName,
      employee.middleName ?? "",
      employee.nationality ?? "Filipino",
      grossCompensation.toFixed(2),
      taxWithheld.toFixed(2),
      employee.mwe ? "Y" : "N",
      "DRAFT",
    ].map(csv).join(",")),
  ].join("\n");

  return {
    filename: `bir-1604c-annual-source-${taxYear}-run-${run.id}.csv`,
    contentType: "text/csv",
    body: `${headerNote}\n# taxYear=${taxYear}\n# releasedPayrollRunsIncluded=${annualRuns.length}\n# employeesIncluded=${annualByEmployee.size}\n# Source extract only. Annual gross compensation and withholding aggregate all released payrolls paid in the selected calendar year. Validate and transform this dataset through the current BIR validation workflow before filing.\n${body}`,
  };
}
