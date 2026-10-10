/**
 * Read-only cross-module HCM journey evidence.
 *
 * "Recorded" means a matching source record exists. It is NOT a statement
 * that labor rules, payroll remittances, bank settlement or a person's
 * complete employment history have been independently certified.
 *
 * Never infer hiring, approval, pay settlement or departure from today's
 * employee status alone. Missing historical links can be legitimate legacy
 * imports and must not be silently labeled as completed.
 */
export type WorkerJourneyState =
  | "recorded"
  | "in_progress"
  | "attention"
  | "not_recorded"
  | "not_applicable"
  | "restricted";

export type WorkerJourneyStageId =
  | "recruitment"
  | "position"
  | "onboarding"
  | "performance"
  | "compensation"
  | "payroll"
  | "offboarding";

export type WorkerJourneyStage = {
  id: WorkerJourneyStageId;
  label: string;
  state: WorkerJourneyState;
  detail: string;
  page: "Recruitment" | "Planning" | "People" | "Performance" | "Compensation" | "Payroll" | "Separation";
  evidence: { source: string; id: number } | null;
};

export type HcmWorkerJourney = {
  stages: WorkerJourneyStage[];
  summary: {
    recorded: number;
    inProgress: number;
    attention: number;
    notRecorded: number;
    restricted: number;
    notApplicable: number;
  };
  disclaimer: string;
};

export type WorkerJourneyInput = {
  employeeStatus: string;
  asOfDate: string; // Philippine business date, YYYY-MM-DD
  recruitment: null | {
    applicantId: number;
    stage: string;
    requisitionId: number;
    requisitionPositionId: number | null;
  };
  currentPositionId: number | null;
  currentPositionEffectiveFrom: string | null;
  lastPositionAssignmentId: number | null;
  onboarding: Array<{ done: boolean }>;
  offboarding: Array<{ done: boolean }>;
  latestPerformance: null | { id: number; status: string };
  compensationVisible: boolean;
  latestCompensation: null | { id: number; status: string };
  payrollVisible: boolean;
  lastReleasedPayroll: null | { runId: number; periodEnd: string };
  separation: null | { id: number; status: string };
  outstandingAssets: number;
};

function stage(
  id: WorkerJourneyStageId,
  label: string,
  page: WorkerJourneyStage["page"],
  state: WorkerJourneyState,
  detail: string,
  evidence: WorkerJourneyStage["evidence"] = null,
): WorkerJourneyStage {
  return { id, label, page, state, detail, evidence };
}

export function buildHcmWorkerJourney(input: WorkerJourneyInput): HcmWorkerJourney {
  const stages: WorkerJourneyStage[] = [];
  const exited = ["Separated", "Inactive", "Terminated"].includes(input.employeeStatus);

  // A historic direct hire or imported employee has no recruitment applicant.
  // Absence of an ATS link is neither proof of an unauthorized hire nor a
  // reason to manufacture a recruitment record.
  if (!input.recruitment) {
    stages.push(stage("recruitment", "Recruitment and hire", "Recruitment", "not_recorded",
      "No linked hired applicant; direct and migrated hires may be legitimate."));
  } else if (input.recruitment.stage === "hired") {
    stages.push(stage("recruitment", "Recruitment and hire", "Recruitment", "recorded",
      `Hired applicant #${input.recruitment.applicantId} links to requisition #${input.recruitment.requisitionId}.`,
      { source: "job_applicants", id: input.recruitment.applicantId }));
  } else {
    stages.push(stage("recruitment", "Recruitment and hire", "Recruitment", "attention",
      "An applicant links to this employee but is not marked hired. Review the source records.",
      { source: "job_applicants", id: input.recruitment.applicantId }));
  }

  if (input.currentPositionId != null && input.currentPositionEffectiveFrom
    && input.currentPositionEffectiveFrom > input.asOfDate) {
    stages.push(stage("position", "Position and organization", "Planning", "in_progress",
      `Position #${input.currentPositionId} is scheduled effective ${input.currentPositionEffectiveFrom}; it is not yet a current incumbent assignment.`,
      { source: "positions", id: input.currentPositionId }));
  } else if (input.currentPositionId != null) {
    stages.push(stage("position", "Position and organization", "Planning", "recorded",
      `Current authoritative position #${input.currentPositionId} is assigned.`,
      { source: "positions", id: input.currentPositionId }));
  } else if (exited && input.lastPositionAssignmentId != null) {
    stages.push(stage("position", "Position and organization", "Planning", "recorded",
      "A historical position assignment exists; the former worker has no current incumbent position.",
      { source: "position_assignments", id: input.lastPositionAssignmentId }));
  } else {
    stages.push(stage("position", "Position and organization", "Planning", "not_recorded",
      "No linked primary position. Review historical/direct-hire context before assigning one."));
  }

  const onboardingDone = input.onboarding.filter((task) => task.done).length;
  if (input.onboarding.length === 0) {
    stages.push(stage("onboarding", "Onboarding", "People", "not_recorded",
      "No onboarding checklist is recorded; this does not mean onboarding was skipped."));
  } else {
    stages.push(stage("onboarding", "Onboarding", "People",
      onboardingDone === input.onboarding.length ? "recorded" : "in_progress",
      `${onboardingDone} of ${input.onboarding.length} onboarding tasks marked complete. Task completion is not independent document verification.`));
  }

  const review = input.latestPerformance;
  stages.push(!review
    ? stage("performance", "Performance", "Performance", "not_recorded",
        "No performance review is linked to this worker.")
    : stage("performance", "Performance", "Performance",
        review.status === "completed" ? "recorded" : "in_progress",
        review.status === "completed"
          ? `Review #${review.id} is completed; no pay decision is implied.`
          : `Latest review #${review.id} is ${review.status}; separate review governance still applies.`,
        { source: "performance_reviews", id: review.id }));

  // Restrict even a stray supplied proposal when the caller lacks scope.
  if (!input.compensationVisible) {
    stages.push(stage("compensation", "Compensation decisions", "Compensation", "restricted",
      "Compensation evidence is limited to company-wide authorized People administrators."));
  } else if (!input.latestCompensation) {
    stages.push(stage("compensation", "Compensation decisions", "Compensation", "not_recorded",
      "No linked compensation proposal. A salary change is never inferred from a review."));
  } else {
    const proposal = input.latestCompensation;
    const state: WorkerJourneyState = proposal.status === "applied"
      ? "recorded"
      : proposal.status === "failed" ? "attention"
        : proposal.status === "rejected" || proposal.status === "cancelled"
          ? "not_recorded" : "in_progress";
    stages.push(stage("compensation", "Compensation decisions", "Compensation", state,
      proposal.status === "applied"
        ? `Compensation proposal #${proposal.id} is recorded as applied; this is not a bank payout.`
        : `Latest proposal #${proposal.id} is ${proposal.status}; no automatic salary action occurs here.`,
      { source: "compensation_proposals", id: proposal.id }));
  }

  // A Released payroll entry proves a released calculation entry; it does not
  // prove bank settlement, government remittance or successful disbursement.
  if (!input.payrollVisible) {
    stages.push(stage("payroll", "Released payroll evidence", "Payroll", "restricted",
      "Payroll records are hidden without payroll-view authority and its permission-set gate."));
  } else if (!input.lastReleasedPayroll) {
    stages.push(stage("payroll", "Released payroll evidence", "Payroll", "not_recorded",
      "No Released payroll entry found. This does not establish non-payment."));
  } else {
    stages.push(stage("payroll", "Released payroll evidence", "Payroll", "recorded",
      `Released run #${input.lastReleasedPayroll.runId}, period ending ${input.lastReleasedPayroll.periodEnd}. Bank settlement is not verified here.`,
      { source: "payroll_runs", id: input.lastReleasedPayroll.runId }));
  }

  const openExitTasks = input.offboarding.filter((task) => !task.done).length;
  if (!input.separation) {
    stages.push(stage("offboarding", "Offboarding and separation", "Separation",
      exited ? "attention" : "not_applicable",
      exited
        ? "Employee is marked exited without a linked Separation record; reconcile historical evidence."
        : "No Separation record; this worker has no recorded offboarding workflow."));
  } else {
    const released = input.separation.status === "released";
    const complete = released && input.offboarding.length > 0
      && openExitTasks === 0 && input.outstandingAssets === 0;
    const state: WorkerJourneyState = complete ? "recorded"
      : released && (openExitTasks > 0 || input.outstandingAssets > 0) ? "attention"
        : "in_progress";
    const detail = complete
      ? "Separation package released and recorded checklist cleared; this does not prove bank settlement."
      : `Separation #${input.separation.id} is ${input.separation.status}; ${openExitTasks} open exit tasks, ${input.outstandingAssets} assigned assets. ${released ? "Validate any outstanding clearance evidence." : "Final pay remains a governed process."}`;
    stages.push(stage("offboarding", "Offboarding and separation", "Separation", state, detail,
      { source: "separation_records", id: input.separation.id }));
  }

  const summary = {
    recorded: stages.filter((row) => row.state === "recorded").length,
    inProgress: stages.filter((row) => row.state === "in_progress").length,
    attention: stages.filter((row) => row.state === "attention").length,
    notRecorded: stages.filter((row) => row.state === "not_recorded").length,
    restricted: stages.filter((row) => row.state === "restricted").length,
    notApplicable: stages.filter((row) => row.state === "not_applicable").length,
  };

  return {
    stages,
    summary,
    disclaimer: "Source-linked HR journey evidence only. Not a payroll, legal, identity, bank-settlement or compliance certification.",
  };
}
