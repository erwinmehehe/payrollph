import { calculateEmployeePay } from "./payroll-engine";
import { criticalReleaseFlagEnabled } from "./critical-release-flags";
import { practicePayrollAllowed, type PracticePayload, type PracticeWorker } from "./practice-payroll";

type Input = Parameters<typeof calculateEmployeePay>[0];
/** Fixed non-persisted fixtures. Does not load workers, enqueue jobs or call providers. */
export function buildPracticePayroll(): PracticePayload {
  function worker(id: number, name: string, rate: number, startDate: string, daily = false): PracticeWorker {
    const input: Input = {
      employee: { id: -id, organizationId: -1, employeeNo: `PRACTICE-${id}`, firstName: "Fictional", lastName: name,
        title: "Practice only", avatarInitials: "QA", status: "Active", startDate, basicRate: String(daily ? rate * 22 : rate),
        mwe: false, region: "NCR", restDay: "Sunday", pagIbigVoluntaryMonthly: "0.00", bankAccount: null, bankCode: null, mobile: null,
      } as Input["employee"],
      punches: daily ? ["01", "02", "05", "06", "07"].map((day, index) => ({
        id: -100 - index, workDate: `2026-10-${day}`, status: "Complete", shiftStart: "09:00", shiftEnd: "18:00",
        timeIn: new Date(`2026-10-${day}T09:00:00+08:00`), timeOut: new Date(`2026-10-${day}T18:00:00+08:00`),
        breakStart: new Date(`2026-10-${day}T12:00:00+08:00`), breakEnd: new Date(`2026-10-${day}T13:00:00+08:00`),
      } as Input["punches"][number])) : [],
      advisories: [], unitName: "Fictional practice team", periodLabel: "PRACTICE ONLY · October 1–15, 2026",
      payProfile: { payBasis: daily ? "daily" : "monthly", rateAmount: rate, standardWorkDaysPerMonth: 22, standardHoursPerDay: 8 },
      holidayCalendar: [], periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-15",
      statutoryRuleVersions: { sss: "PRACTICE — NOT CERTIFIED", philHealth: "PRACTICE — NOT CERTIFIED", pagIbig: "PRACTICE — NOT CERTIFIED", withholding: "PRACTICE — NOT CERTIFIED" },
    };
    const result = calculateEmployeePay(input);
    return { id: `practice-${id}`, name: `Fictional ${name}`, basis: daily ? "Daily paid" : "Monthly salaried", startDate,
      inputSummary: daily ? `PHP ${rate} daily · five recorded 8-hour days` : `PHP ${rate} monthly · starts ${startDate}`,
      grossCents: Math.round(result.gross * 100), deductionCents: Math.round(result.deductions * 100), netCents: Math.round(result.net * 100),
      lines: result.lineItems.map(line => ({ label: line.label, cents: Math.round(Number(line.amount) * 100) })),
    };
  }
  return { status: "ready", scenarios: [
    { id: "monthly", name: "Monthly team", explanation: "Two monthly salaries over a fixed semi-monthly cutoff. No attendance adjustments in this sample.", workers: [worker(1, "Alex", 30000, "2025-01-01"), worker(2, "Sam", 22000, "2025-01-01")] },
    { id: "new-hire", name: "Mid-cutoff hire", explanation: "A monthly employee starting October 8. Compare the engine's start-date proration with the full-cutoff scenario.", workers: [worker(3, "Jamie", 22000, "2026-10-08")] },
    { id: "daily", name: "Daily attendance", explanation: "Five complete 8-hour days, with one-hour breaks. No overtime or holiday work is supplied.", workers: [worker(4, "Taylor", 1000, "2025-01-01", true)] },
  ] };
}

export function ownerPracticePayroll(access: { role: string; companyWide: boolean } | null | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env, build: () => PracticePayload = buildPracticePayroll): { practicePayroll?: PracticePayload } {
  if (!practicePayrollAllowed(criticalReleaseFlagEnabled("ownerPracticePayroll", env), access)) return {};
  try { return { practicePayroll: build() }; } catch { return { practicePayroll: { status: "unavailable" } }; }
}
