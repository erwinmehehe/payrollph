/**
 * Sample data for the public workspace preview.
 *
 * This is a **simulation**: the people and punches below are invented so the
 * preview is playable without an account, and every surface that renders them
 * says so. What is *not* invented is the arithmetic, SSS, PhilHealth, Pag-IBIG
 * and withholding all come from `@/lib/payroll-rules`, the same functions the
 * real payroll engine calls. That is the point of the preview: the numbers you
 * see are the numbers the engine would produce for these inputs.
 *
 * Nothing here is written anywhere. Actions in the preview change local state
 * only.
 */

import {
  computePagIbig,
  computePhilHealth,
  computeSemiMonthlyWithholdingTax,
  computeSss,
} from "@/lib/payroll-rules";

export type SampleEmployee = {
  id: number;
  employeeNo: string;
  firstName: string;
  lastName: string;
  title: string;
  unit: string;
  employmentType: string;
  status: string;
  initials: string;
  monthlyBasic: number;
  /** Overtime minutes derived from punches in the period. */
  overtimeMinutes: number;
  nightMinutes: number;
  lateMinutes: number;
  /** A missing punch pair: derives zero hours for that day and flags the entry. */
  incompletePunchDays: number;
  mwe?: boolean;
};

export const SAMPLE_CLIENTS = [
  { id: 1, name: "Masigla Foods", legalName: "Masigla Foods Corporation", plan: "Scale", people: 6, color: "#0b7a5f" },
  { id: 2, name: "Bayanihan BPO", legalName: "Bayanihan Outsourcing Inc.", plan: "Core", people: 24, color: "#0057b8" },
  { id: 3, name: "Tindahan Retail", legalName: "Tindahan Retail Ventures", plan: "Core", people: 11, color: "#7733b8" },
];

export const SAMPLE_EMPLOYEES: SampleEmployee[] = [
  { id: 1, employeeNo: "MF-0001", firstName: "Aira", lastName: "Villanueva", title: "Operations lead", unit: "Makati HQ", employmentType: "Regular", status: "Active", initials: "AV", monthlyBasic: 48000, overtimeMinutes: 240, nightMinutes: 0, lateMinutes: 12, incompletePunchDays: 0 },
  { id: 2, employeeNo: "MF-0002", firstName: "Jonas", lastName: "Reyes", title: "Line supervisor", unit: "Makati HQ", employmentType: "Regular", status: "Active", initials: "JR", monthlyBasic: 32000, overtimeMinutes: 360, nightMinutes: 480, lateMinutes: 0, incompletePunchDays: 0 },
  { id: 3, employeeNo: "MF-0003", firstName: "Trish", lastName: "Dela Cruz", title: "Production staff", unit: "Cebu Hub", employmentType: "Regular", status: "Active", initials: "TD", monthlyBasic: 18500, overtimeMinutes: 120, nightMinutes: 0, lateMinutes: 45, incompletePunchDays: 1 },
  { id: 4, employeeNo: "MF-0004", firstName: "Rico", lastName: "Mendoza", title: "Warehouse crew", unit: "Cebu Hub", employmentType: "Regular", status: "Active", initials: "RM", monthlyBasic: 15290, overtimeMinutes: 0, nightMinutes: 0, lateMinutes: 0, incompletePunchDays: 0, mwe: true },
  { id: 5, employeeNo: "MF-0005", firstName: "Karla", lastName: "Domingo", title: "Finance associate", unit: "Makati HQ", employmentType: "Probationary", status: "Active", initials: "KD", monthlyBasic: 27000, overtimeMinutes: 60, nightMinutes: 0, lateMinutes: 0, incompletePunchDays: 0 },
  { id: 6, employeeNo: "MF-0006", firstName: "Miguel", lastName: "Santos", title: "Driver", unit: "Cebu Hub", employmentType: "Regular", status: "On leave", initials: "MS", monthlyBasic: 16500, overtimeMinutes: 0, nightMinutes: 0, lateMinutes: 0, incompletePunchDays: 2 },
];

export type SampleLine = { code: string; label: string; amount: number; note?: string };

export type SampleEntry = {
  employee: SampleEmployee;
  gross: number;
  deductions: number;
  net: number;
  status: "Ready" | "Exception";
  flags: string[];
  earnings: SampleLine[];
  withholdings: SampleLine[];
};

const WORKING_DAYS = 22;
const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Builds one semi-monthly entry. The premium multipliers (125% overtime, +10%
 * night differential) and the statutory functions are the repo's own; only the
 * inputs are sample.
 */
export function buildSampleEntry(employee: SampleEmployee): SampleEntry {
  const dailyRate = employee.monthlyBasic / WORKING_DAYS;
  const hourlyRate = dailyRate / 8;

  // Half a month of basic pay, less any day with an unusable punch pair.
  const semiMonthlyBasic = employee.monthlyBasic / 2;
  const lostDayPay = employee.incompletePunchDays * dailyRate;
  const workedPay = Math.max(semiMonthlyBasic - lostDayPay, 0);

  const overtimePay = (employee.overtimeMinutes / 60) * hourlyRate * 1.25;
  const nightPay = (employee.nightMinutes / 60) * hourlyRate * 0.1;
  const lateDeduction = (employee.lateMinutes / 60) * hourlyRate;

  const gross = workedPay + overtimePay + nightPay;

  // Statutory contributions are monthly figures; the engine splits them across
  // the two semi-monthly cutoffs, so the preview does the same.
  const sss = computeSss(employee.monthlyBasic).employee / 2;
  const philHealth = computePhilHealth(employee.monthlyBasic).employee / 2;
  const pagIbig = computePagIbig(employee.monthlyBasic).employee / 2;

  const taxable = Math.max(gross - sss - philHealth - pagIbig - lateDeduction, 0);
  const withholding = computeSemiMonthlyWithholdingTax(taxable, Boolean(employee.mwe));

  const earnings: SampleLine[] = [
    { code: "BASIC", label: "Basic / worked pay", amount: round(workedPay), note: employee.incompletePunchDays ? `${employee.incompletePunchDays} day(s) derive zero hours` : undefined },
    { code: "OT", label: "Overtime (125%)", amount: round(overtimePay) },
    { code: "ND", label: "Night differential (+10%)", amount: round(nightPay) },
  ].filter((line) => line.amount > 0);

  const withholdings: SampleLine[] = [
    { code: "SSS", label: "SSS contribution", amount: round(sss), note: "half of the monthly contribution" },
    { code: "PHIC", label: "PhilHealth contribution", amount: round(philHealth) },
    { code: "HDMF", label: "Pag-IBIG contribution", amount: round(pagIbig) },
    { code: "WHT", label: "Withholding tax", amount: round(withholding), note: employee.mwe ? "minimum-wage earner, exempt" : "TRAIN semi-monthly bracket" },
    { code: "LATE", label: "Tardiness", amount: round(lateDeduction) },
  ].filter((line) => line.amount > 0);

  const deductions = withholdings.reduce((sum, line) => sum + line.amount, 0);

  const flags: string[] = [];
  if (employee.incompletePunchDays > 0) {
    flags.push(`incompletePunch=${employee.incompletePunchDays} day(s), zero hours derived, needs sign-off`);
  }
  if (employee.mwe) flags.push("mwe=true (regional wage order floor), withholding exempt");

  return {
    employee,
    gross: round(gross),
    deductions: round(deductions),
    net: round(Math.max(gross - deductions, 0)),
    status: employee.incompletePunchDays > 0 ? "Exception" : "Ready",
    flags,
    earnings,
    withholdings,
  };
}

export function buildSampleRun() {
  const entries = SAMPLE_EMPLOYEES.map(buildSampleEntry);
  const gross = round(entries.reduce((sum, entry) => sum + entry.gross, 0));
  const net = round(entries.reduce((sum, entry) => sum + entry.net, 0));
  const exceptions = entries.filter((entry) => entry.status === "Exception").length;
  return {
    periodLabel: "March 1–15, 2026",
    scopeLabel: "All locations",
    payDate: "2026-03-20",
    ruleVersion: "PH-2026.01",
    entries,
    gross,
    net,
    deductions: round(gross - net),
    exceptions,
  };
}

export type SampleRun = ReturnType<typeof buildSampleRun>;

export const SAMPLE_APPROVALS = [
  { id: 1, title: "Review March 1–15 payroll", detail: "1 timekeeping exception needs a decision", approver: "Mariel Santos", due: "Due today", priority: "High" },
  { id: 2, title: "Approve leave request", detail: "Aira Villanueva · Mar 17–18 emergency leave", approver: "Mariel Santos", due: "Due in 2 days", priority: "Normal" },
  { id: 3, title: "Offboarding checklist", detail: "Access review for a separating employee", approver: "Mariel Santos", due: "Due Mar 20", priority: "Normal" },
];

export const SAMPLE_PUNCHES = [
  { id: 1, employeeId: 3, date: "2026-03-12", timeIn: "08:52", timeOut: null, status: "Incomplete punch" },
  { id: 2, employeeId: 6, date: "2026-03-13", timeIn: null, timeOut: "17:31", status: "Incomplete punch" },
  { id: 3, employeeId: 2, date: "2026-03-13", timeIn: "21:58", timeOut: "06:04", status: "Night differential" },
  { id: 4, employeeId: 1, date: "2026-03-13", timeIn: "09:06", timeOut: "19:12", status: "Overtime" },
  { id: 5, employeeId: 3, date: "2026-03-13", timeIn: "09:38", timeOut: "18:02", status: "Tardy" },
  { id: 6, employeeId: 5, date: "2026-03-13", timeIn: "08:55", timeOut: "18:01", status: "Complete" },
];
