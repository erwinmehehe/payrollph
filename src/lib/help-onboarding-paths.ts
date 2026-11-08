/**
 * Public, informational onboarding pathways. These do not read tenant data,
 * assign permissions, approve tasks or touch financial workflows.
 */
import type { HelpAudience } from "./help-center-content";

export type HelpOnboardingPath = {
  audience: HelpAudience;
  description: string;
  steps: readonly { guideSlug: string; purpose: string }[];
};

export const HELP_ONBOARDING_PATHS: readonly HelpOnboardingPath[] = [
  {
    audience: "Employees",
    description: "Find your own information and understand what to do when something is missing.",
    steps: [
      { guideSlug: "account-help", purpose: "Confirm your access and where to get support." },
      { guideSlug: "update-personal-info", purpose: "Check permitted personal contact details." },
      { guideSlug: "review-attendance", purpose: "Review punches and raise correction questions." },
      { guideSlug: "find-released-payslips", purpose: "Locate payslips after authorized release." },
    ],
  },
  {
    audience: "Managers",
    description: "Work in your assigned team context and make decisions only in authorized workflows.",
    steps: [
      { guideSlug: "manager-team-view", purpose: "Confirm your employer and team scope." },
      { guideSlug: "manager-decisions", purpose: "Review decisions assigned to your role." },
      { guideSlug: "manager-handoff", purpose: "Verify requests and return unresolved items to HR." },
    ],
  },
  {
    audience: "HR teams",
    description: "Keep employee records and onboarding work in the correct employer context.",
    steps: [
      { guideSlug: "employee-directory", purpose: "Find the correct employee record." },
      { guideSlug: "new-employee-checklists", purpose: "Track onboarding owners and open items." },
      { guideSlug: "import-recovery", purpose: "Handle interrupted imports without duplicate submissions." },
    ],
  },
  {
    audience: "Payroll teams",
    description: "Prepare payroll inputs and handoffs without confusing previews with approval or payout.",
    steps: [
      { guideSlug: "first-payroll-preparation", purpose: "Check the setup sequence and role boundaries." },
      { guideSlug: "payroll-exceptions", purpose: "Understand how source exceptions are reviewed." },
      { guideSlug: "payroll-checker-evidence", purpose: "Prepare for independent review and no-money outputs." },
    ],
  },
];
