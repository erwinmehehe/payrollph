import type { FirstPayrollReadiness } from "./first-payroll-readiness";

/** The single ordered source of truth for journey keys and accountable roles. */
export const FIRST_PAYROLL_STEPS = [
 { key:"company", owner:"owner", allowedOwners:["owner"] },
 { key:"people", owner:"hr", allowedOwners:["owner","hr"] },
 { key:"time", owner:"hr", allowedOwners:["hr"] },
 { key:"reviewers", owner:"owner", allowedOwners:["owner","admin"] },
 { key:"payroll", owner:"payroll", allowedOwners:["payroll","owner","bookkeeper"] },
 { key:"approval", owner:"checker", allowedOwners:["checker"] },
 { key:"exports", owner:"bookkeeper", allowedOwners:["bookkeeper","payroll","owner"] },
] as const;
export type FirstPayrollKey = (typeof FIRST_PAYROLL_STEPS)[number]["key"];
export type FirstPayrollJourneyState = "complete" | "available" | "review" | "upcoming";
export type FirstPayrollJourneyStep = {
  key: "company" | "people" | "time" | "reviewers" | "payroll" | "approval" | "exports";
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
      title: "Confirm employer setup",
      detail: "Check your legal employer details, payroll calendar and security settings.",
      state: company ? "complete" : "available",
      page: "Settings",
      actionLabel: "Review company",
      settingsTab: "organization",
    },
    {
      key: "people",
      title: "Add people and payout details",
      detail: people ? "The active roster and payout fields are present. Check each employee's payroll inputs." : "Add active employees and their complete payout details.",
      state: people ? "complete" : "available",
      page: "People",
      actionLabel: "Open people",
    },
    {
      key: "time",
      title: "Review attendance and period inputs",
      detail: "Resolve missing punches, leave and per-period HR exceptions. This step needs an authorized human review.",
      state: people ? "review" : "upcoming",
      page: "Time & attendance",
      actionLabel: "Review attendance",
    },
    {
      key: "reviewers",
      title: "Assign maker and independent checker",
      detail: "A Payroll Officer prepares the run; a separate Checker approves the exact submitted snapshot.",
      state: reviewers ? "complete" : "available",
      page: "Settings",
      actionLabel: "Review team access",
      settingsTab: "team",
    },
    {
      key: "payroll",
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
      title: "Independent approval and release",
      detail: "The payroll server requires its own checker, assurance and release gates. Setup alone never authorizes payment.",
      state: released ? "complete" : started ? "review" : "upcoming",
      page: "Approvals",
      actionLabel: "Review approvals",
    },
    {
      key: "exports",
      title: "Export payslips and filing worksheets",
      detail: "After release, generate employee outputs, reconcile draft government worksheets and retain agency receipts. A download is not filing acceptance.",
      state: released ? "review" : "upcoming",
      page: "Exports",
      actionLabel: "Open exports",
    },
  ];
}
