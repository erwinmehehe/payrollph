import {
  HCM_REVIEW_TYPES,
  type HcmGovernanceFinding,
} from "@/lib/hcm-governance-readiness";

/**
 * Pure aggregate-only triage. No employee identifiers, financial amounts,
 * mutable workflow state, assignments or external API calls.
 */
export type HcmWorklistInput = {
  asOf: string;
  findings: ReadonlyArray<Pick<HcmGovernanceFinding, "code" | "severity" | "affected">>;
  processes: ReadonlyArray<{
    processType: string;
    configuredDefinitions: number;
    currentActiveDefinitions: number;
    scopedDefinitions: number;
    policyState: string;
  }>;
};

export type HcmWorklistTask = {
  key: string;
  priority: "High" | "Review";
  title: string;
  matches: number | null;
  suggestedReviewer: string;
  direction: string;
};

const FINDING_REVIEW: Record<string, {
  title: string; owner: string; direction: string;
}> = {
  UNKNOWN_WAGE_REGION: {
    title: "Verify wage-region codes",
    owner: "Payroll + People",
    direction: "Confirm actual work location and applicable wage order; use approved employee corrections only.",
  },
  DUPLICATE_EMPLOYEE_NUMBERS: {
    title: "Reconcile duplicate employee identifiers",
    owner: "People + Payroll",
    direction: "Review source HR and historical payroll identities without automatically merging or renumbering workers.",
  },
  FINAL_PAY_CLEARANCE_MISMATCH: {
    title: "Reconcile incomplete separation clearances",
    owner: "HR + IT + Finance",
    direction: "Collect original clearance evidence; never backfill or rewrite a released final-pay register without approval.",
  },
  FINAL_PAY_EMPLOYEE_STATUS_MISMATCH: {
    title: "Reconcile final-pay lifecycle mismatches",
    owner: "People + Payroll",
    direction: "Compare separation decisions, released pay and worker status through the authorized lifecycle correction process.",
  },
  FINAL_PAY_REFERENCE_MISSING: {
    title: "Verify final-pay settlement references",
    owner: "Finance + Payroll",
    direction: "Find independent bank/employee payment evidence; a newly entered reference is not proof of settlement.",
  },
  SEPARATED_WITH_ACTIVE_POSITION: {
    title: "Review assignments after separation",
    owner: "People Operations",
    direction: "Reconcile effective-dated position handoff and separation history before any approved assignment change.",
  },
  FUTURE_EMPLOYMENT_START_DATE: {
    title: "Check future-dated active workers",
    owner: "People Operations",
    direction: "Review signed employment dates and activation rules before sending payroll for calculation.",
  },
  PAY_PROFILE_MISSING: {
    title: "Review missing employee pay profiles",
    owner: "Payroll + HR",
    direction: "Reconcile contracts and salary history; do not automatically fabricate a rate or payroll profile.",
  },
  REST_DAY_NOT_CONFIGURED: {
    title: "Confirm missing rest-day settings",
    owner: "HR + Workforce Management",
    direction: "Validate approved schedule policy and premium calculation requirements before changing worker setup.",
  },
};

const REVIEW_TYPE_LABELS: Record<string, string> = {
  hire: "Hire",
  change_job: "Change Job",
  promotion: "Promotion",
  transfer: "Transfer",
  compensation_change: "Compensation Change",
  termination: "Termination",
  create_position: "Create Position",
  close_position: "Close Position",
};

const KNOWN_POLICY_TYPES = new Set<string>(HCM_REVIEW_TYPES);

export function buildHcmGovernanceWorklist(input: HcmWorklistInput) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.asOf)) {
    throw new Error("An ISO report date is required.");
  }
  const flagged: HcmWorklistTask[] = input.findings.map(finding => {
    if (!Number.isSafeInteger(finding.affected) || finding.affected < 0) {
      throw new Error("Invalid aggregate finding count.");
    }
    const safeCode = finding.code.replace(/[^A-Z0-9_]/g, "").slice(0, 64);
    const guidance = FINDING_REVIEW[finding.code];
    return {
      key: "finding:" + safeCode,
      priority: finding.severity === "high" ? "High" as const : "Review" as const,
      title: guidance?.title ?? "Investigate unrecognized aggregate HCM indicator",
      matches: finding.affected,
      suggestedReviewer: guidance?.owner ?? "People + Payroll",
      direction: guidance?.direction ?? "Confirm the definition and source evidence before any governed correction.",
    };
  });

  // No policy is automatically a defect: scopes and system fallbacks can
  // apply. Create a verification task rather than implying noncompliance.
  const policyReviews: HcmWorklistTask[] = input.processes
    .filter(process => KNOWN_POLICY_TYPES.has(process.processType))
    .filter(process => process.currentActiveDefinitions === 0 || process.scopedDefinitions > 0)
    .map(process => {
      const label = REVIEW_TYPE_LABELS[process.processType];
      const inactive = process.currentActiveDefinitions === 0;
      return {
        key: "coverage:" + process.processType,
        priority: "Review" as const,
        title: label + (inactive ? " policy coverage review" : " supervisory-scope review"),
        matches: null,
        suggestedReviewer: process.processType === "compensation_change"
          ? "People + Finance" : process.processType === "termination"
            ? "People + Payroll" : "People Operations",
        direction: inactive
          ? "Confirm whether an effective, employer-approved policy or a documented system fallback should govern this transaction."
          : "Verify supervisory-unit inheritance and company-wide coverage; one active scoped policy does not prove all workers are covered.",
      };
    });
  flagged.sort((a, b) =>
    (a.priority === "High" ? 0 : 1) - (b.priority === "High" ? 0 : 1)
    || (b.matches ?? 0) - (a.matches ?? 0)
    || a.key.localeCompare(b.key),
  );
  const tasks = [...flagged, ...policyReviews];
  return {
    asOf: input.asOf,
    tasks,
    highCount: flagged.filter(task => task.priority === "High").length,
    aggregateFlagCount: flagged.length,
    policyReviewCount: policyReviews.length,
  };
}

export function formatHcmGovernanceWorklist(plan: ReturnType<typeof buildHcmGovernanceWorklist>): string {
  const lines = [
    "HCM GOVERNANCE REVIEW WORKLIST",
    "Aggregate evidence date: " + plan.asOf,
    "Read-only planning aid. Not payroll, statutory, bank or employer certification.",
    "Exception counts may overlap and can include identifier groups; never sum them as distinct employees.",
    "Suggested reviewers are role guidance, not actual assignees or signatories.",
    "",
  ];
  if (plan.tasks.length === 0) {
    lines.push("No aggregate follow-up items were generated. Independent controls and payroll approval are still required.");
  }
  for (const [index, task] of plan.tasks.entries()) {
    lines.push(
      String(index + 1) + ". [" + task.priority + "] " + task.title,
      "   Matches: " + (task.matches == null ? "Policy scope verification; no affected-employee count" : String(task.matches) + " aggregate records/groups"),
      "   Suggested reviewer: " + task.suggestedReviewer,
      "   Review direction: " + task.direction,
      "",
    );
  }
  lines.push("Do not enter employee, bank, tax ID or salary details into this aggregate checklist.");
  lines.push("Resolve findings through approved HR/payroll processes and retain evidence outside this text.");
  return lines.join("\n");
}
