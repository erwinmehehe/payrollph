import { parseCsv } from "@/lib/csv-import";

export type MonthlyFilingSnapshot = {
  applicableMonth: string;
  employeeCount: number;
  reportedTotal: number;
};

const MONTHLY_TOTAL_COLUMNS: Record<string, string> = {
  "SSS:R-3": "Total_Contribution",
  "PhilHealth:RF-1": "TotalPremium",
  "Pag-IBIG:MCRF": "TotalContribution",
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function summarizeMonthlyContributionFile(input: {
  agency: string;
  form: string;
  body: string;
  applicableMonth: string;
}): MonthlyFilingSnapshot | null {
  const totalColumn = MONTHLY_TOTAL_COLUMNS[`${input.agency}:${input.form}`];
  if (!totalColumn) return null;
  if (!/^\d{4}-\d{2}$/.test(input.applicableMonth)) {
    throw new Error("Monthly filing snapshot requires applicableMonth in YYYY-MM format.");
  }

  const csvText = input.body
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("#"))
    .join("\n");
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    throw new Error(`${input.agency} ${input.form} filing has no employee rows to summarize.`);
  }

  const headers = rows[0].map((value) => value.trim());
  const totalIndex = headers.indexOf(totalColumn);
  if (totalIndex < 0) {
    throw new Error(`${input.agency} ${input.form} filing is missing expected column "${totalColumn}".`);
  }

  let reportedTotal = 0;
  let employeeCount = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row.some((cell) => cell.trim())) continue;
    const raw = String(row[totalIndex] ?? "").replace(/[₱,\s]/g, "");
    const amount = Number(raw);
    if (!raw || !Number.isFinite(amount) || amount < 0) {
      throw new Error(
        `${input.agency} ${input.form} filing has invalid total contribution on data row ${index + 1}.`,
      );
    }
    reportedTotal += amount;
    employeeCount += 1;
  }

  if (employeeCount === 0) {
    throw new Error(`${input.agency} ${input.form} filing has no employee rows to summarize.`);
  }

  return {
    applicableMonth: input.applicableMonth,
    employeeCount,
    reportedTotal: round2(reportedTotal),
  };
}

export function compareFilingToRemittance(input: {
  filingEmployeeCount: number;
  filingTotal: number;
  remittanceEmployeeCount: number;
  remittanceTotal: number;
}) {
  const employeeCountMatches = input.filingEmployeeCount === input.remittanceEmployeeCount;
  const totalDifference = round2(input.filingTotal - input.remittanceTotal);
  const totalMatches = Math.abs(totalDifference) <= 0.01;

  return {
    matched: employeeCountMatches && totalMatches,
    employeeCountMatches,
    totalMatches,
    employeeCountDifference: input.filingEmployeeCount - input.remittanceEmployeeCount,
    totalDifference,
  };
}
