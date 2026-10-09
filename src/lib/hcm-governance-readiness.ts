export type HcmGovernanceCounters = {
  employees: number;
  activeWorkers: number;
  futureStartDates: number;
  missingRestDays: number;
  missingPayProfiles: number;
  unsupportedWageRegions: number;
  duplicateEmployeeNumbers: number;
  approvedSeparationsWithoutClearance: number;
  releasedSeparationsWithoutReference: number;
  releasedSeparationsWorkerNotSeparated: number;
  separatedWorkersWithOpenAssignments: number;
  inProgressBusinessProcesses: number;
};

export type HcmGovernancePolicy = {
  processType: string;
  active: boolean;
  effectiveFrom: string;
  effectiveUntil: string | null;
  supervisoryOrgUnitId: number | null;
};

export type HcmGovernanceFinding = {
  code: string;
  severity: "high" | "review";
  affected: number;
  title: string;
  nextAction: string;
};

export const HCM_REVIEW_TYPES = [
  "hire", "change_job", "promotion", "transfer",
  "compensation_change", "termination", "create_position", "close_position",
] as const;

const CHECKS: Array<{
  field: keyof HcmGovernanceCounters;
  code: string;
  severity: "high" | "review";
  title: string;
  nextAction: string;
}> = [
  {
    field: "unsupportedWageRegions",
    code: "UNKNOWN_WAGE_REGION",
    severity: "high",
    title: "Workers with unsupported wage-region codes",
    nextAction: "Check actual work location and applicable regional/sector wage order with payroll before correcting the employee record.",
  },
  {
    field: "duplicateEmployeeNumbers",
    code: "DUPLICATE_EMPLOYEE_NUMBERS",
    severity: "high",
    title: "Repeated employee numbers inside the employer",
    nextAction: "Reconcile employee identity and historical payroll before assigning unique identifiers; never auto-merge workers.",
  },
  {
    field: "approvedSeparationsWithoutClearance",
    code: "FINAL_PAY_CLEARANCE_MISMATCH",
    severity: "high",
    title: "Approved/released separations with incomplete departmental clearance",
    nextAction: "Review original IT, HR, Admin and Finance evidence. Do not infer missing attestations or rewrite released final pay.",
  },
  {
    field: "releasedSeparationsWorkerNotSeparated",
    code: "FINAL_PAY_EMPLOYEE_STATUS_MISMATCH",
    severity: "high",
    title: "Released final pay where employee lifecycle is not Separated",
    nextAction: "Investigate worker history, final-pay release and payroll settlement with HR; corrections need an approved, audited process.",
  },
  {
    field: "releasedSeparationsWithoutReference",
    code: "FINAL_PAY_REFERENCE_MISSING",
    severity: "high",
    title: "Released final-pay records without a payout reference",
    nextAction: "Find bank/employee settlement evidence independently. Do not treat a newly typed reference as proof of actual payment.",
  },
  {
    field: "separatedWorkersWithOpenAssignments",
    code: "SEPARATED_WITH_ACTIVE_POSITION",
    severity: "review",
    title: "Separated workers with open primary position assignments",
    nextAction: "Reconcile approved position history and offboarding handoff without manually overwriting an effective-dated assignment.",
  },
  {
    field: "futureStartDates",
    code: "FUTURE_EMPLOYMENT_START_DATE",
    severity: "review",
    title: "Current workers whose start date is after today's Philippine calendar date",
    nextAction: "Review the start-date contract and employment activation before payroll; future-dated hires should not already be marked Active.",
  },
  {
    field: "missingPayProfiles",
    code: "PAY_PROFILE_MISSING",
    severity: "review",
    title: "Current workers without payroll pay profiles",
    nextAction: "Reconcile pay basis and rate against employment contract and payroll register before creating missing profiles.",
  },
  {
    field: "missingRestDays",
    code: "REST_DAY_NOT_CONFIGURED",
    severity: "review",
    title: "Current workers without an explicit rest day",
    nextAction: "Confirm employer-approved rest-day policy and schedule; do not infer premium calculations from an arbitrary default.",
  },
];

export function buildHcmGovernanceReadiness(input: {
  asOf: string;
  counters: HcmGovernanceCounters;
  definitions: HcmGovernancePolicy[];
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) {
    throw new Error("HCM governance audit requires an ISO calendar date.");
  }
  for (const field of Object.keys(input.counters) as Array<keyof HcmGovernanceCounters>) {
    const n = input.counters[field];
    if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Invalid HCM aggregate ${field}`);
  }
  const findings: HcmGovernanceFinding[] = CHECKS
    .filter(check => input.counters[check.field] > 0)
    .map(check => ({
      code: check.code,
      severity: check.severity,
      affected: input.counters[check.field],
      title: check.title,
      nextAction: check.nextAction,
    }));

  const processes = HCM_REVIEW_TYPES.map(processType => {
    const configured = input.definitions.filter(row => row.processType === processType);
    const applicableToday = configured.filter(row =>
      row.active
      && row.effectiveFrom <= input.asOf
      && (row.effectiveUntil == null || row.effectiveUntil >= input.asOf)
    );
    return {
      processType,
      configuredDefinitions: configured.length,
      currentActiveDefinitions: applicableToday.length,
      scopedDefinitions: configured.filter(row => row.supervisoryOrgUnitId != null).length,
      policyState: (configured.length === 0
        ? "system_default_or_not_configured"
        : applicableToday.length > 0
          ? "active_definition_exists"
          : "configured_without_current_active_definition") as
          "system_default_or_not_configured" | "active_definition_exists" | "configured_without_current_active_definition",
    };
  });
  const warnings = findings.filter(row => row.severity === "high").length;
  return {
    asOf: input.asOf,
    status: (warnings || findings.length ? "manual_review_required" : "inventory_only") as
      "manual_review_required" | "inventory_only",
    summary: {
      employeeCount: input.counters.employees,
      currentWorkers: input.counters.activeWorkers,
      highPriorityCategories: warnings,
      reviewCategories: findings.length - warnings,
      inProgressBusinessProcesses: input.counters.inProgressBusinessProcesses,
    },
    findings,
    processes,
    limitations: [
      "Read-only aggregate evidence, not a compliance certificate or verification of employee-specific HCM approvals.",
      "An active policy definition may cover only one supervisory organization. Its coverage is not proven for every worker by this report.",
      "Zero flagged records does not demonstrate bank settlement, correct wage/tax computations, statutory filing acceptance or employer signoff.",
      "Counts are from separate SELECT statements and may change during concurrent HR activity; refresh before planning remediation.",
    ],
  };
}
