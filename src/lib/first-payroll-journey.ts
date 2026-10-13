import type { FirstPayrollReadiness } from "./first-payroll-readiness";

/** Single source of truth for journey order, roles, labels, destinations and actions.
 * Components, persisted handoff policy and the journey view all consume this. */
export const FIRST_PAYROLL_STEPS = [
  { key: "company", owner: "owner", allowedOwners: ["owner"],
    title: "Confirm employer setup", page: "Settings", actionLabel: "Review company", settingsTab: "organization" },
  { key: "people", owner: "hr", allowedOwners: ["owner", "hr"],
    title: "Add people and payout details", page: "People", actionLabel: "Open people" },
  { key: "time", owner: "hr", allowedOwners: ["hr"],
    title: "Review attendance and period inputs", page: "Time & attendance", actionLabel: "Review attendance" },
  { key: "reviewers", owner: "owner", allowedOwners: ["owner"],
    title: "Assign maker and independent checker", page: "Settings", actionLabel: "Review team access", settingsTab: "team" },
  { key: "payroll", owner: "payroll", allowedOwners: ["payroll", "owner", "bookkeeper"],
    title: "Calculate and inspect payroll", page: "Payroll", actionLabel: "Prepare payroll" },
  { key: "approval", owner: "checker", allowedOwners: ["checker"],
    title: "Independent approval and release", page: "Approvals", actionLabel: "Review approvals" },
  { key: "exports", owner: "bookkeeper", allowedOwners: ["bookkeeper", "payroll", "owner"],
    title: "Export payslips and filing worksheets", page: "Exports", actionLabel: "Open exports" },
] as const;

export type FirstPayrollKey = (typeof FIRST_PAYROLL_STEPS)[number]["key"];
export type FirstPayrollJourneyState = "complete" | "available" | "review" | "upcoming";
export type FirstPayrollJourneyStep = {
  key: FirstPayrollKey;
  title: string;
  detail: string;
  state: FirstPayrollJourneyState;
  page: (typeof FIRST_PAYROLL_STEPS)[number]["page"];
  actionLabel: string;
  settingsTab?: "organization" | "team";
};

/**
 * Status is derived from actual readiness; a workspace checkbox is not evidence
 * of a period-specific attendance review, independent approval or government
 * filing acceptance. Financial calculations and authorization are server-owned.
 */
export function buildFirstPayrollJourney(readiness: FirstPayrollReadiness): FirstPayrollJourneyStep[] {
  const flags = new Map(readiness.items.map(item => [item.key, item.ready]));
  const company = flags.get("workspace") === true;
  const people = flags.get("employees") === true && flags.get("payout") === true;
  const reviewers = flags.get("payroll-officer") === true && flags.get("checker") === true;
  const started = readiness.firstPayrollStarted;
  const released = readiness.firstPayrollReleased;

  const status: Record<FirstPayrollKey, Pick<FirstPayrollJourneyStep, "state" | "detail">> = {
    company: {
      detail: "Check your legal employer details, payroll calendar and security settings.",
      state: company ? "complete" : "available",
    },
    people: {
      detail: people
        ? "The active roster and payout fields are present. Check each employee's payroll inputs."
        : "Add active employees and their complete payout details.",
      state: people ? "complete" : "available",
    },
    time: {
      detail: "Resolve missing punches, leave and per-period HR exceptions. This step needs an authorized human review.",
      state: people ? "review" : "upcoming",
    },
    reviewers: {
      detail: "A Payroll Officer prepares the run; a separate Checker approves the exact submitted snapshot.",
      state: reviewers ? "complete" : "available",
    },
    payroll: {
      detail: released
        ? "The payroll workflow records a released run."
        : started
          ? "A run exists. Review its calculations, exceptions and assurance results before submission."
          : "Create your first pay period only after setup and payroll inputs have been reviewed.",
      state: released ? "complete" : started ? "review" : readiness.ready ? "available" : "upcoming",
    },
    approval: {
      detail: "The payroll server requires its own checker, assurance and release gates. Setup alone never authorizes payment.",
      state: released ? "complete" : started ? "review" : "upcoming",
    },
    exports: {
      detail: "After release, generate employee outputs, reconcile draft government worksheets and retain agency receipts. A download is not filing acceptance.",
      state: released ? "review" : "upcoming",
    },
  };

  return FIRST_PAYROLL_STEPS.map(step => ({
    key: step.key,
    title: step.title,
    page: step.page,
    actionLabel: step.key === "payroll" && started ? "Open payroll run" : step.actionLabel,
    ...("settingsTab" in step ? { settingsTab: step.settingsTab } : {}),
    ...status[step.key],
  }));
}
