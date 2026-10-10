import type { HcmWorkerJourney, WorkerJourneyStage, WorkerJourneyStageId } from "./hcm-worker-journey";

/**
 * Next actions are suggestions based on source-linked evidence, not new HCM states.
 * No financial adjustment, separation, provisioning, authorization or approval
 * is performed by this helper. It never uses source details containing PII.
 */
export type HcmJourneyActionPriority = "review" | "follow_up" | "source_check";
export type HcmJourneyNextAction = {
  stageId: WorkerJourneyStageId;
  stageLabel: string;
  page: WorkerJourneyStage["page"];
  priority: HcmJourneyActionPriority;
  title: string;
  instruction: string;
  responsibleTeam: string;
};

export type HcmJourneyActionPlan = {
  actions: HcmJourneyNextAction[];
  summary: { review: number; followUp: number; sourceCheck: number };
  disclaimer: string;
};

const RECOMMENDATIONS: Record<WorkerJourneyStageId, {
  responsibleTeam: string;
  review: [string, string];
  follow_up: [string, string];
  source_check: [string, string];
}> = {
  recruitment: {
    responsibleTeam: "People Ops / Recruiting",
    review: ["Reconcile the hired-applicant linkage", "Check the applicant stage against the employee and requisition. Resolve mismatches in Recruitment; do not fabricate a hire record."],
    follow_up: ["Continue the governed hiring workflow", "Verify the authorized requisition and complete remaining hiring approvals in Recruitment."],
    source_check: ["Check recruitment provenance", "Direct or migrated hires may legitimately lack an applicant link. Check historical records only if required by employer policy."],
  },
  position: {
    responsibleTeam: "People Ops / Workforce Planning",
    review: ["Review position assignment conflict", "Reconcile the worker's effective-dated position and organizational assignment through the governed Planning workflow."],
    follow_up: ["Confirm future-dated position transition", "Check the approved effective date. A future assignment is not yet a current position."],
    source_check: ["Verify job-position coverage", "Check whether the employee requires a governed position assignment or has legitimate legacy assignment history."],
  },
  onboarding: {
    responsibleTeam: "People Ops / IT",
    review: ["Review outstanding onboarding evidence", "Reconcile onboarding exceptions with the owning teams; a checked task alone does not verify statutory or identity documents."],
    follow_up: ["Finish assigned onboarding tasks", "Use the existing onboarding checklist. Confirm each task with its responsible owner."],
    source_check: ["Check onboarding checklist coverage", "No linked checklist is recorded. Verify a historical onboarding source before creating missing tasks."],
  },
  performance: {
    responsibleTeam: "People Ops / Manager",
    review: ["Review performance workflow exceptions", "Check the authoritative review cycle and required approvals; do not infer a compensation change."],
    follow_up: ["Continue performance review", "Confirm review inputs and completion through Performance. A review does not authorize a salary adjustment."],
    source_check: ["Check review schedule and eligibility", "No review is linked. Confirm whether this worker should be included in a review cycle."],
  },
  compensation: {
    responsibleTeam: "People Ops / Compensation Approver",
    review: ["Investigate the compensation proposal", "Review a failed proposal and independent approval evidence in Compensation. Never edit pay or reapply a salary without authorization."],
    follow_up: ["Follow the compensation approval workflow", "Check proposal and maker-checker status in Compensation before any salary change becomes effective."],
    source_check: ["Verify compensation-review coverage", "No proposal is linked. Not every employee requires a compensation change; do not infer one from performance."],
  },
  payroll: {
    responsibleTeam: "Payroll Operations",
    review: ["Reconcile payroll-release evidence", "Review authorized payroll records and corrections. A Released run does not establish bank settlement."],
    follow_up: ["Check payroll-release workflow", "Follow existing payroll preparation, independent approval and reconciliation controls."],
    source_check: ["Verify payroll source coverage", "No Released payroll entry is linked. Check migration history or payroll runs; do not conclude wages were unpaid."],
  },
  offboarding: {
    responsibleTeam: "People Ops / IT / Finance",
    review: ["Resolve separation or clearance exception", "Reconcile the approved separation record, open offboarding tasks and unreturned assets. Do not release final pay automatically."],
    follow_up: ["Continue governed offboarding", "Confirm clearance, access revocation, asset return and final-pay approval through existing Separation workflows."],
    source_check: ["Verify historical separation record", "An exited worker may have migrated history. Reconcile authoritative evidence before creating or changing separation state."],
  },
};

const ORDER: Record<HcmJourneyActionPriority, number> = { review: 0, follow_up: 1, source_check: 2 };

/**
 * Stable priority order, source order inside each priority.
 * Restricted and completed stages are excluded even if their source includes
 * untrusted or confidential detail. No source text is copied into actions.
 */
export function buildHcmJourneyActionPlan(journey: HcmWorkerJourney): HcmJourneyActionPlan {
  const actions: HcmJourneyNextAction[] = [];
  for (const stage of journey.stages) {
    if (stage.state === "restricted" || stage.state === "recorded" || stage.state === "not_applicable") {
      continue;
    }
    const priority: HcmJourneyActionPriority = stage.state === "attention"
      ? "review" : stage.state === "in_progress" ? "follow_up" : "source_check";
    const policy = RECOMMENDATIONS[stage.id];
    if (!policy) continue; // fail-closed on future unrecognized stage IDs
    const [title, instruction] = policy[priority];
    actions.push({
      stageId: stage.id,
      stageLabel: stage.label,
      page: stage.page,
      priority,
      title,
      instruction,
      responsibleTeam: policy.responsibleTeam,
    });
  }
  actions.sort((a, b) => ORDER[a.priority] - ORDER[b.priority]);
  return {
    actions,
    summary: {
      review: actions.filter((item) => item.priority === "review").length,
      followUp: actions.filter((item) => item.priority === "follow_up").length,
      sourceCheck: actions.filter((item) => item.priority === "source_check").length,
    },
    disclaimer: "Review-only suggestions based on existing records. No HR decision, wage change, payroll release, bank payment or legal-compliance certification occurs here.",
  };
}
