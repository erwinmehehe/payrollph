import { isCanonicalPhSemiMonthlyPeriod } from "./payroll-calendar";
import type { FirstPayrollReadiness } from "./first-payroll-readiness";

export type JourneyRole = "owner" | "hr" | "payroll" | "checker" | "bookkeeper";
export type FirstPayrollJourneyState = "complete" | "available" | "review" | "upcoming";
export type FirstPayrollJourneyStep = {
  key: "company" | "people" | "time" | "reviewers" | "payroll" | "approval" | "exports";
  ownerRole: JourneyRole;
  title: string;
  detail: string;
  state: FirstPayrollJourneyState;
  page: "Settings" | "People" | "Time & attendance" | "Payroll" | "Approvals" | "Exports";
  actionLabel: string;
  settingsTab?: "organization" | "team";
};

/**
 * Navigation only: the existing payroll/approval/export endpoints remain the
 * authoritative gates. Never derive period-specific attendance sign-off or
 * government filing acceptance from the five setup flags.
 */
export function buildFirstPayrollJourney(readiness: FirstPayrollReadiness): FirstPayrollJourneyStep[] {
  const flags = new Map(readiness.items.map((item) => [item.key, item.ready]));
  const company = flags.get("workspace") === true;
  const people = flags.get("employees") === true && flags.get("payout") === true;
  const reviewers = flags.get("payroll-officer") === true && flags.get("checker") === true;
  const started = readiness.firstPayrollStarted;
  const released = readiness.firstPayrollReleased;

  return [
    {
      key: "company",
      ownerRole: "owner",
      title: "Confirm employer setup",
      detail: "Check your legal employer details, payroll calendar and security settings.",
      state: company ? "complete" : "available",
      page: "Settings",
      actionLabel: "Review company",
      settingsTab: "organization",
    },
    {
      key: "people",
      ownerRole: "hr",
      title: "Add people and payout details",
      detail: people ? "The active roster and payout fields are present. Check each employee's payroll inputs." : "Add active employees and their complete payout details.",
      state: people ? "complete" : "available",
      page: "People",
      actionLabel: "Open people",
    },
    {
      key: "time",
      ownerRole: "hr",
      title: "Review attendance and period inputs",
      detail: "Resolve missing punches, leave and per-period HR exceptions. This step needs an authorized human review.",
      state: people ? "review" : "upcoming",
      page: "Time & attendance",
      actionLabel: "Review attendance",
    },
    {
      key: "reviewers",
      ownerRole: "owner",
      title: "Assign maker and independent checker",
      detail: "A Payroll Officer prepares the run; a separate Checker approves the exact submitted snapshot.",
      state: reviewers ? "complete" : "available",
      page: "Settings",
      actionLabel: "Review team access",
      settingsTab: "team",
    },
    {
      key: "payroll",
      ownerRole: "payroll",
      title: "Calculate and inspect payroll",
      detail: released
        ? "The payroll workflow records a released run."
        : started
          ? "A run exists. Review its calculations, exceptions and assurance results before submission."
          : "Create your first pay period only after setup and payroll inputs have been reviewed.",
      state: released ? "complete" : started ? "review" : readiness.ready ? "available" : "upcoming",
      page: "Payroll",
      actionLabel: started ? "Open payroll run" : "Prepare payroll",
    },
    {
      key: "approval",
      ownerRole: "checker",
      title: "Independent approval and release",
      detail: "The payroll server requires its own checker, assurance and release gates. Setup alone never authorizes payment.",
      state: released ? "complete" : started ? "review" : "upcoming",
      page: "Approvals",
      actionLabel: "Review approvals",
    },
    {
      key: "exports",
      ownerRole: "bookkeeper",
      title: "Export payslips and filing worksheets",
      detail: "After release, generate employee outputs, reconcile draft government worksheets and retain agency receipts. A download is not filing acceptance.",
      state: released ? "review" : "upcoming",
      page: "Exports",
      actionLabel: "Open exports",
    },
  ];
}

// All onboarding surfaces use this inventory. Employee provisioning tasks and
// bootstrap account creation remain separate workflows, not payroll steps.
export const FIRST_PAYROLL_STEPS = buildFirstPayrollJourney({
  items: [], ready: false, completed: 0, total: 5, activeEmployees: 0,
  employeesMissingPayout: 0, payrollOfficerCount: 0, checkerCount: 0,
  firstPayrollStarted: false, firstPayrollReleased: false, payrollRunCount: 0,
});
export type JourneySchedule = { periodStart: string; periodEnd: string; payDate: string };
export function validJourneySchedule(value: unknown): value is JourneySchedule {
  if (!value || typeof value !== "object") return false;
  const v = value as JourneySchedule;
  const valid = (d: string) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
  return valid(v.periodStart) && valid(v.periodEnd) && valid(v.payDate) && v.periodStart <= v.periodEnd && v.periodEnd <= v.payDate && (Date.parse(v.periodEnd) - Date.parse(v.periodStart)) / 86400000 < 16 && isCanonicalPhSemiMonthlyPeriod(v.periodStart, v.periodEnd);
}
export function journeyRoleCanReviewTime(role: string) {
  return ["owner", "admin", "bookkeeper", "hr", "payroll"].includes(role);
}
