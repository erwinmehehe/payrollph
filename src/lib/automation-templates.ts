import {
  automationTriggerIsLive,
  normalizeAutomationActions,
  validAutomationConditions,
  validateAutomationActionTrigger,
  type AutomationTrigger,
  type AutomationWorkflowStep,
} from "@/lib/automation";

export type AutomationWorkflowTemplate = {
  id: string;
  version: number;
  category: "People" | "Workforce" | "Compliance" | "Benefits";
  name: string;
  description: string;
  trigger: AutomationTrigger;
  conditions: unknown;
  actions: AutomationWorkflowStep[];
};

const RAW_AUTOMATION_WORKFLOW_TEMPLATES = [
  {
    id: "people-new-hire-core-onboarding",
    version: 1,
    category: "People",
    name: "New hire core onboarding",
    description: "Creates a governed onboarding checklist and sends the employee a welcome notification after the authoritative hire event commits.",
    trigger: "employee.hired",
    conditions: { version: 1, all: [], any: [] },
    actions: [
      {
        type: "create_onboarding_checklist",
        items: [
          { title: "Verify employee profile and statutory identifiers", owner: "People Ops", kind: "automation" },
          { title: "Confirm payroll setup and pay schedule", owner: "Payroll", kind: "automation" },
          { title: "Confirm manager, position and worksite assignment", owner: "People Ops", kind: "automation" },
          { title: "Confirm required access and equipment handoff", owner: "IT / Admin", kind: "automation" },
        ],
      },
      {
        type: "send_email",
        recipient: "employee",
        subject: "Your onboarding steps are ready",
        body: "Your worker record has been created. Please review the onboarding steps assigned to you and contact People Ops if any employment or payroll detail is incorrect.",
      },
    ],
  },
  {
    id: "people-promotion-control-check",
    version: 1,
    category: "People",
    name: "Promotion control check",
    description: "Creates a People Ops verification task and notifies the manager after a governed promotion becomes authoritative.",
    trigger: "employee.promoted",
    conditions: { version: 1, all: [], any: [] },
    actions: [
      {
        type: "create_task",
        title: "Validate promoted worker payroll, position and access setup",
        owner: "People Ops",
        kind: "automation",
      },
      {
        type: "send_email",
        recipient: "manager",
        subject: "Promotion effective — review worker setup",
        body: "The governed promotion is now effective. Please verify that the worker's responsibilities, schedule and operating access match the approved change.",
      },
    ],
  },
  {
    id: "people-separation-access-offboarding",
    version: 1,
    category: "People",
    name: "Separation access offboarding",
    description: "Pauses for a People Ops approval before revoking sessions and removing workspace/SCIM access after an authoritative separation.",
    trigger: "employee.separated",
    conditions: { version: 1, all: [], any: [] },
    actions: [
      {
        type: "approval_gate",
        title: "Approve separation access shutdown",
        detail: "Confirm the authoritative separation is ready for access shutdown. This gate does not alter payroll or separation evidence.",
        approver: "People Ops",
        dueLabel: "Access shutdown approval",
        priority: "High",
      },
      {
        type: "create_task",
        title: "Confirm final separation checklist and asset return",
        owner: "People Ops",
        kind: "automation",
      },
      { type: "revoke_sessions" },
      { type: "deactivate_access" },
    ],
  },
  {
    id: "workforce-blocking-attendance-exception",
    version: 1,
    category: "Workforce",
    name: "Blocking attendance exception triage",
    description: "Routes newly detected blocker-level attendance exceptions to Workforce Ops and the worker's manager.",
    trigger: "attendance.exception_created",
    conditions: {
      version: 1,
      all: [
        { field: "attendanceExceptionSeverity", operator: "eq", value: "blocker" },
      ],
      any: [],
    },
    actions: [
      {
        type: "create_task",
        title: "Resolve blocking attendance exception",
        owner: "Workforce Ops",
        kind: "automation",
      },
      {
        type: "send_email",
        recipient: "manager",
        subject: "Blocking attendance exception requires review",
        body: "A blocker-level attendance exception was detected from authoritative workforce data. Review the attendance evidence and use the governed correction workflow when a change is required.",
      },
    ],
  },
  {
    id: "compliance-contribution-discrepancy",
    version: 1,
    category: "Compliance",
    name: "Contribution discrepancy review",
    description: "Creates a compliance task and independent approval request when a statutory contribution discrepancy case is opened.",
    trigger: "contribution.discrepancy_detected",
    conditions: { version: 1, all: [], any: [] },
    actions: [
      {
        type: "create_task",
        title: "Investigate statutory contribution discrepancy",
        owner: "Payroll Compliance",
        kind: "automation",
      },
      {
        type: "request_approval",
        title: "Review contribution discrepancy resolution",
        detail: "Review the authoritative contribution case and confirm the proposed resolution before closing the compliance exception.",
        approver: "Payroll",
        dueLabel: "Contribution discrepancy review",
        priority: "High",
      },
    ],
  },
  {
    id: "benefits-hmo-enrollment-handoff",
    version: 1,
    category: "Benefits",
    name: "HMO enrollment carrier handoff",
    description: "Creates a Benefits Ops handoff task and notifies the employee when a governed HMO enrollment is created.",
    trigger: "benefit.enrollment_created",
    conditions: {
      version: 1,
      all: [{ field: "benefitCategory", operator: "eq", value: "hmo" }],
      any: [],
    },
    actions: [
      {
        type: "create_task",
        title: "Review HMO enrollment and prepare carrier submission",
        owner: "Benefits Ops",
        kind: "automation",
      },
      {
        type: "send_email",
        recipient: "employee",
        subject: "Your HMO enrollment is being processed",
        body: "Your HMO enrollment has been recorded. Benefits Ops will complete the provider handoff and confirm when coverage becomes active.",
      },
    ],
  },
  {
    id: "benefits-hmo-dependent-review",
    version: 1,
    category: "Benefits",
    name: "HMO dependent review",
    description: "Routes a newly added HMO dependent through a governed Benefits Ops approval before carrier submission.",
    trigger: "benefit.dependent_added",
    conditions: { version: 1, all: [], any: [] },
    actions: [
      {
        type: "request_approval",
        title: "Review HMO dependent enrollment",
        detail: "Verify dependent eligibility and required relationship evidence before submitting the dependent to the HMO provider.",
        approver: "Benefits Ops",
        dueLabel: "HMO dependent review",
        priority: "Normal",
      },
    ],
  },
  {
    id: "benefits-hmo-coverage-activated",
    version: 1,
    category: "Benefits",
    name: "HMO coverage activation notice",
    description: "Notifies the employee after HMO coverage is marked active from authoritative Benefits data.",
    trigger: "benefit.coverage_activated",
    conditions: { version: 1, all: [], any: [] },
    actions: [
      {
        type: "send_email",
        recipient: "employee",
        subject: "Your HMO coverage is active",
        body: "Your HMO coverage has been marked active. Review your Benefits workspace for the effective date and plan details.",
      },
    ],
  },
  {
    id: "compliance-government-remittance-due",
    version: 1,
    category: "Compliance",
    name: "Government remittance due review",
    description: "Creates an independent compliance approval request when a statutory remittance reaches a due or overdue event phase.",
    trigger: "government.remittance_due",
    conditions: { version: 1, all: [], any: [] },
    actions: [
      {
        type: "request_approval",
        title: "Review government remittance obligation",
        detail: "Review the legal-entity remittance obligation, due date and evidence before the compliance action is closed.",
        approver: "Compliance",
        dueLabel: "Government remittance review",
        priority: "High",
      },
    ],
  },
  {
    id: "wfm-coverage-recovery-review",
    version: 1,
    category: "Workforce",
    name: "Open-shift coverage recovery review",
    description: "Prepares one source-verified, idempotent manager follow-up case per open shift. No roster publication, open-shift claim approval, or employee schedule mutation.",
    trigger: "coverage.gap_approaching",
    conditions: { version: 1, all: [], any: [] },
    actions: [{
      type: "prepare_operational_review",
      caseType: "coverage_recovery",
      reason: "Review authorized demand, available coverage and employee eligibility. Route any roster changes through the governed manager workflow.",
    }],
  },
  {
    id: "wfm-timesheet-cutoff-escalation",
    version: 1,
    category: "Workforce",
    name: "Timesheet cutoff escalation review",
    description: "Prepares a version-bound timesheet review without submitting, approving, locking or changing payable time.",
    trigger: "timesheet.cutoff_approaching",
    conditions: { version: 1, all: [], any: [] },
    actions: [{
      type: "prepare_operational_review",
      caseType: "timesheet_escalation",
      reason: "Investigate the outstanding timesheet and source blockers. Use the normal timesheet/correction workflow to resolve them.",
    }],
  },
  {
    id: "wfm-attendance-exception-sla-review",
    version: 1,
    category: "Workforce",
    name: "Aging attendance exception follow-up",
    description: "Creates a source-verified review case for an unresolved attendance exception without altering punches or timesheets.",
    trigger: "attendance.exception_aging",
    conditions: { version: 1, all: [], any: [] },
    actions: [{
      type: "prepare_operational_review",
      caseType: "attendance_resolution",
      reason: "Assign an accountable owner and review unresolved attendance evidence. Corrections require the separate governed approval path.",
    }],
  },
  {
    id: "payroll-pay-date-readiness-review",
    version: 1,
    category: "Workforce",
    name: "Upcoming payroll readiness review",
    description: "Opens a payroll evidence review case before pay date. Never creates/clears a payroll hold or releases money.",
    trigger: "payroll.pay_date_approaching",
    conditions: { version: 1, all: [], any: [] },
    actions: [{
      type: "prepare_operational_review",
      caseType: "payroll_readiness",
      reason: "Review payroll readiness, approved timesheets, assurance findings and bank evidence through the existing maker-checker process.",
    }],
  },
  {
    id: "compliance-remittance-operational-followup",
    version: 1,
    category: "Compliance",
    name: "Statutory remittance follow-up case",
    description: "Adds an auditable case linked to the existing authoritative remittance task. Does not prepare a filing or mark a remittance as paid.",
    trigger: "government.remittance_due",
    conditions: { version: 1, all: [], any: [] },
    actions: [{
      type: "prepare_operational_review",
      caseType: "statutory_followup",
      reason: "Verify payment, posting, filing and agency evidence in the statutory control workspace before resolving the underlying compliance task.",
    }],
  },
] as const;

function validateTemplate(
  raw: (typeof RAW_AUTOMATION_WORKFLOW_TEMPLATES)[number],
): AutomationWorkflowTemplate {
  if (!automationTriggerIsLive(raw.trigger)) {
    throw new Error(`Automation template ${raw.id} uses a trigger that is not live.`);
  }
  if (!validAutomationConditions(raw.conditions)) {
    throw new Error(`Automation template ${raw.id} has invalid conditions.`);
  }
  const actions = normalizeAutomationActions(raw.actions);
  if (!actions) {
    throw new Error(`Automation template ${raw.id} has invalid actions.`);
  }
  const compatibilityError = validateAutomationActionTrigger(raw.trigger, actions);
  if (compatibilityError) {
    throw new Error(`Automation template ${raw.id} is incompatible with its trigger: ${compatibilityError}`);
  }
  return {
    id: raw.id,
    version: raw.version,
    category: raw.category,
    name: raw.name,
    description: raw.description,
    trigger: raw.trigger,
    conditions: raw.conditions,
    actions,
  };
}

export const AUTOMATION_WORKFLOW_TEMPLATES: AutomationWorkflowTemplate[] =
  RAW_AUTOMATION_WORKFLOW_TEMPLATES.map(validateTemplate);

export function getAutomationWorkflowTemplate(templateId: string) {
  return AUTOMATION_WORKFLOW_TEMPLATES.find((template) => template.id === templateId) ?? null;
}
