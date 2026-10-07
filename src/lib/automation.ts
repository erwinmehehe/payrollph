import { and, eq, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalTasks,
  automationExecutions,
  automationRules,
  benefitEnrollments,
  benefitPlans,
  employees,
  jobProfiles,
  orgUnits,
  permissionSets,
  positionAssignments,
  positions,
  provisioningTasks,
  scimIdentities,
  sessions,
  userOrganizations,
  userPermissionAssignments,
  users,
} from "@/db/schema";
import { queueMessage } from "@/lib/mailer";
import { dispatchWebhook } from "@/lib/webhooks";
import { assignEmployeeScheduleGoverned } from "@/lib/workforce-schedule-assignment";
import { generateAutomationEmployeeDocument } from "@/lib/automation-document-generation";
import { createApprovalFromConfiguredChain } from "@/lib/approval-chains";
import {
  getAutomationDocumentTemplate,
  type AutomationDocumentTrigger,
} from "@/lib/automation-document-templates";

export const AUTOMATION_TRIGGERS = [
  "employee.hired",
  "employee.updated",
  "employee.moved",
  "employee.promoted",
  "employee.separated",
  "payroll.created",
  "payroll.submitted",
  "payroll.approved",
  "payroll.released",
  "attendance.exception_created",
  "overtime.requested",
  "overtime.approved",
  "leave.requested",
  "leave.approved",
  "compensation.changed",
  "candidate.hired",
  "position.opened",
  "document.expires",
  "government.remittance_due",
  "contribution.discrepancy_detected",
] as const;

export const LIFECYCLE_TRIGGERS = [
  "employee.hired",
  "employee.moved",
  "employee.separated",
] as const;

export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];
export type LifecycleTrigger = (typeof LIFECYCLE_TRIGGERS)[number];

export const AUTOMATION_LIVE_TRIGGERS = [
  "employee.hired",
  "employee.updated",
  "employee.moved",
  "employee.promoted",
  "employee.separated",
  "payroll.created",
  "payroll.submitted",
  "payroll.approved",
  "payroll.released",
  "attendance.exception_created",
  "overtime.requested",
  "overtime.approved",
  "leave.requested",
  "leave.approved",
  "compensation.changed",
  "candidate.hired",
  "position.opened",
  "document.expires",
  "government.remittance_due",
  "contribution.discrepancy_detected",
] as const satisfies readonly AutomationTrigger[];

export const AUTOMATION_PLANNED_TRIGGERS = [] as const satisfies readonly AutomationTrigger[];

export function automationTriggerIsLive(trigger: AutomationTrigger) {
  return (AUTOMATION_LIVE_TRIGGERS as readonly string[]).includes(trigger);
}

export const AUTOMATION_TRIGGER_CATALOG: Array<{
  value: AutomationTrigger;
  label: string;
  category: string;
  employeeScoped: boolean;
}> = [
  { value: "employee.hired", label: "Employee hired", category: "People", employeeScoped: true },
  { value: "employee.updated", label: "Employee updated", category: "People", employeeScoped: true },
  { value: "employee.moved", label: "Employee changes department / position", category: "People", employeeScoped: true },
  { value: "employee.promoted", label: "Employee promoted", category: "People", employeeScoped: true },
  { value: "employee.separated", label: "Employee separated", category: "People", employeeScoped: true },
  { value: "payroll.created", label: "Payroll created", category: "Payroll", employeeScoped: false },
  { value: "payroll.submitted", label: "Payroll submitted for review", category: "Payroll", employeeScoped: false },
  { value: "payroll.approved", label: "Payroll approved", category: "Payroll", employeeScoped: false },
  { value: "payroll.released", label: "Payroll released", category: "Payroll", employeeScoped: false },
  { value: "attendance.exception_created", label: "Attendance exception created", category: "Workforce", employeeScoped: true },
  { value: "overtime.requested", label: "Overtime requested", category: "Workforce", employeeScoped: true },
  { value: "overtime.approved", label: "Overtime approved", category: "Workforce", employeeScoped: true },
  { value: "leave.requested", label: "Leave requested", category: "Workforce", employeeScoped: true },
  { value: "leave.approved", label: "Leave approved", category: "Workforce", employeeScoped: true },
  { value: "compensation.changed", label: "Compensation changed", category: "HCM", employeeScoped: true },
  { value: "candidate.hired", label: "Candidate hired", category: "HCM", employeeScoped: true },
  { value: "position.opened", label: "Position opened", category: "HCM", employeeScoped: false },
  { value: "document.expires", label: "Document expires", category: "Compliance", employeeScoped: true },
  { value: "government.remittance_due", label: "Government remittance due", category: "Compliance", employeeScoped: false },
  { value: "contribution.discrepancy_detected", label: "Contribution discrepancy detected", category: "Compliance", employeeScoped: true },
];

export const AUTOMATION_CONDITION_FIELDS = [
  { value: "orgUnitId", label: "Org unit ID", kind: "number" },
  { value: "previousOrgUnitId", label: "Previous org unit ID", kind: "number" },
  { value: "department", label: "Department / org unit", kind: "string" },
  { value: "location", label: "Location / region", kind: "string" },
  { value: "employmentType", label: "Employment type", kind: "string" },
  { value: "title", label: "Job title", kind: "string" },
  { value: "role", label: "Role", kind: "string" },
  { value: "jobFamily", label: "Job family", kind: "string" },
  { value: "jobLevel", label: "Job level", kind: "string" },
  { value: "grade", label: "Grade", kind: "string" },
  { value: "salary", label: "Monthly-equivalent salary", kind: "number" },
  { value: "tenureDays", label: "Tenure (days)", kind: "number" },
  { value: "tenureYears", label: "Tenure (years)", kind: "number" },
  { value: "payrollAmount", label: "Payroll amount", kind: "number" },
  { value: "overtimeMinutes", label: "Overtime minutes", kind: "number" },
  { value: "attendanceExceptionKind", label: "Attendance exception type", kind: "string" },
  { value: "attendanceExceptionSeverity", label: "Attendance exception severity", kind: "string" },
  { value: "minutes", label: "Attendance exception minutes", kind: "number" },
  { value: "leaveType", label: "Leave type", kind: "string" },
  { value: "positionCode", label: "Position code", kind: "string" },
  { value: "employeeStatus", label: "Employee status", kind: "string" },
  { value: "legalEntityId", label: "Legal employer ID", kind: "number" },
  { value: "eventAmount", label: "Event amount", kind: "number" },
  { value: "documentKind", label: "Document type", kind: "string" },
  { value: "documentRequirementCode", label: "Document requirement code", kind: "string" },
  { value: "documentStatus", label: "Document compliance status", kind: "string" },
  { value: "daysUntilExpiry", label: "Days until document expiry", kind: "number" },
  { value: "statutoryAgency", label: "Statutory agency", kind: "string" },
  { value: "applicableMonth", label: "Applicable month", kind: "string" },
  { value: "daysUntilDue", label: "Days until remittance due", kind: "number" },
  { value: "remittanceAlertTone", label: "Remittance alert severity", kind: "string" },
  { value: "complianceActionTaskId", label: "Compliance action task ID", kind: "number" },
  { value: "contributionIssueType", label: "Contribution issue type", kind: "string" },
  { value: "contributionSource", label: "Contribution discrepancy source", kind: "string" },
  { value: "contributionSeverity", label: "Contribution discrepancy severity", kind: "string" },
  { value: "contributionCaseId", label: "Contribution case ID", kind: "number" },
] as const;

export const AUTOMATION_OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "in",
  "exists",
] as const;

export type AutomationOperator = (typeof AUTOMATION_OPERATORS)[number];

export type AutomationConditionClause = {
  field: string;
  operator: AutomationOperator;
  value?: unknown;
};

export type StudioConditions = {
  version?: 1;
  all?: AutomationConditionClause[];
  any?: AutomationConditionClause[];
};

export type LifecycleContext = {
  orgUnitId?: number | null;
  previousOrgUnitId?: number | null;
  employmentType?: string | null;
  title?: string | null;
  [key: string]: unknown;
};

type LegacyRuleCondition = {
  orgUnitId?: number;
  fromOrgUnitId?: number;
  toOrgUnitId?: number;
  employmentType?: string;
  titleContains?: string;
};

type CreateTaskAction = {
  type: "create_task";
  title: string;
  owner?: string;
  kind?: string;
};

type ChecklistItem = {
  title: string;
  owner?: string;
  kind?: string;
};

type CreateChecklistAction = {
  type: "create_onboarding_checklist";
  items: ChecklistItem[];
};

type RequestApprovalAction = {
  type: "request_approval";
  title: string;
  detail: string;
  approver?: string;
  approvalChainCode?: string;
  dueLabel?: string;
  priority?: string;
};

type SendEmailAction = {
  type: "send_email";
  recipient: "employee" | "manager" | "custom";
  email?: string;
  subject: string;
  body: string;
};

type AssignPermissionSetAction = {
  type: "assign_permission_set";
  permissionSetId: number;
};

type AssignBenefitAction = {
  type: "assign_benefit";
  planId: number;
  monthlyContribution?: number;
};

type AssignScheduleAction = {
  type: "assign_schedule";
  patternId: number;
  effectiveDateSource: "event_effective_date" | "employee_start_date" | "today";
  offsetDays?: number;
  reason: string;
};

type GenerateDocumentAction = {
  type: "generate_document";
  templateId: string;
};

type RevokeSessionsAction = {
  type: "revoke_sessions";
};

type DeactivateAccessAction = {
  type: "deactivate_access";
};

type WebhookAction = {
  type: "webhook";
};

type PayrollAdjustmentApprovalAction = {
  type: "request_payroll_adjustment";
  amount: number;
  reason: string;
  approver?: string;
  approvalChainCode?: string;
};

type WaitAction = {
  type: "wait";
  amount: number;
  unit: "minutes" | "hours" | "days";
};

type ApprovalGateAction = {
  type: "approval_gate";
  title: string;
  detail: string;
  approver?: string;
  approvalChainCode?: string;
  dueLabel?: string;
  priority?: string;
};

type BranchAction = {
  type: "branch";
  conditions: StudioConditions;
  then: AutomationWorkflowStep[];
  else: AutomationWorkflowStep[];
};

export type AutomationAction =
  | CreateTaskAction
  | CreateChecklistAction
  | RequestApprovalAction
  | SendEmailAction
  | AssignPermissionSetAction
  | AssignBenefitAction
  | AssignScheduleAction
  | GenerateDocumentAction
  | RevokeSessionsAction
  | DeactivateAccessAction
  | WebhookAction
  | PayrollAdjustmentApprovalAction;

export type AutomationWorkflowStep =
  | AutomationAction
  | WaitAction
  | ApprovalGateAction
  | BranchAction;

type RunnableAutomationStep = Exclude<AutomationWorkflowStep, BranchAction>;

export type LifecycleAction = AutomationWorkflowStep;

export const AUTOMATION_ACTION_CATALOG = [
  { value: "create_task", label: "Create task", category: "Operations" },
  { value: "create_onboarding_checklist", label: "Create onboarding checklist", category: "People" },
  { value: "request_approval", label: "Request approval", category: "Governance" },
  { value: "send_email", label: "Send email / notification", category: "Communication" },
  { value: "assign_permission_set", label: "Assign access policy", category: "Access" },
  { value: "assign_benefit", label: "Assign benefit", category: "Benefits" },
  { value: "assign_schedule", label: "Assign schedule pattern", category: "Workforce" },
  { value: "generate_document", label: "Generate employee document", category: "People" },
  { value: "revoke_sessions", label: "Revoke active sessions", category: "Access" },
  { value: "deactivate_access", label: "Remove workspace access", category: "Access" },
  { value: "request_payroll_adjustment", label: "Request payroll adjustment approval", category: "Payroll" },
  { value: "webhook", label: "Call registered integration webhook", category: "Integration" },
  { value: "wait", label: "Wait / delay", category: "Flow Control" },
  { value: "approval_gate", label: "Pause until approval", category: "Governance" },
  { value: "branch", label: "Conditional branch", category: "Flow Control" },
] as const;

const EMPLOYEE_ACCESS_TRIGGERS = new Set<AutomationTrigger>([
  "employee.hired",
  "employee.updated",
  "employee.moved",
  "employee.promoted",
  "candidate.hired",
]);

const SCHEDULE_ASSIGNMENT_TRIGGERS = new Set<AutomationTrigger>([
  "employee.hired",
  "employee.moved",
  "employee.promoted",
]);

function todayPh() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

function scalar(value: unknown) {
  return value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean";
}

export function validLifecycleConditions(value: unknown): value is LegacyRuleCondition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const supported = new Set(["orgUnitId", "fromOrgUnitId", "toOrgUnitId", "employmentType", "titleContains"]);
  if (Object.keys(row).some((key) => !supported.has(key))) return false;
  if (row.orgUnitId !== undefined && !Number.isInteger(Number(row.orgUnitId))) return false;
  if (row.fromOrgUnitId !== undefined && !Number.isInteger(Number(row.fromOrgUnitId))) return false;
  if (row.toOrgUnitId !== undefined && !Number.isInteger(Number(row.toOrgUnitId))) return false;
  if (row.employmentType !== undefined && typeof row.employmentType !== "string") return false;
  if (row.titleContains !== undefined && typeof row.titleContains !== "string") return false;
  return true;
}

function validConditionClause(value: unknown): value is AutomationConditionClause {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const field = String(row.field ?? "").trim();
  const operator = String(row.operator ?? "");
  if (!field || field.length > 80 || !/^[A-Za-z0-9_.]+$/.test(field)) return false;
  if (!(AUTOMATION_OPERATORS as readonly string[]).includes(operator)) return false;
  if (operator === "exists") {
    return row.value === undefined || typeof row.value === "boolean";
  }
  if (operator === "in") {
    return Array.isArray(row.value) && row.value.length > 0 && row.value.length <= 50 && row.value.every(scalar);
  }
  return scalar(row.value);
}

export function validAutomationConditions(value: unknown): value is LegacyRuleCondition | StudioConditions {
  if (validLifecycleConditions(value)) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.some((key) => !["version", "all", "any"].includes(key))) return false;
  if (row.version !== undefined && row.version !== 1) return false;
  const all = row.all === undefined ? [] : row.all;
  const any = row.any === undefined ? [] : row.any;
  if (!Array.isArray(all) || !Array.isArray(any)) return false;
  if (all.length + any.length > 20) return false;
  return all.every(validConditionClause) && any.every(validConditionClause);
}

function normalizeChecklistItems(value: unknown): ChecklistItem[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null;
  const items: ChecklistItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    const title = String(row.title ?? "").trim();
    if (!title) return null;
    items.push({
      title: title.slice(0, 160),
      owner: String(row.owner ?? "People Ops").trim().slice(0, 80) || "People Ops",
      kind: String(row.kind ?? "automation").trim().slice(0, 24) || "automation",
    });
  }
  return items;
}

function normalizeAutomationSteps(
  value: unknown,
  depth: number,
  budget: { count: number },
): AutomationWorkflowStep[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20 || depth > 4) return null;
  const actions: AutomationWorkflowStep[] = [];

  for (const raw of value) {
    budget.count += 1;
    if (budget.count > 50) return null;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const action = raw as Record<string, unknown>;
    const type = String(action.type ?? "");

    if (type === "wait") {
      const amount = Number(action.amount);
      const unit = String(action.unit ?? "minutes") as WaitAction["unit"];
      const maximum = unit === "minutes" ? 43_200 : unit === "hours" ? 720 : unit === "days" ? 30 : 0;
      if (!Number.isInteger(amount) || amount < 1 || maximum === 0 || amount > maximum) return null;
      actions.push({ type, amount, unit });
      continue;
    }

    if (type === "approval_gate") {
      const title = String(action.title ?? "").trim();
      const detail = String(action.detail ?? "").trim();
      if (!title || !detail) return null;
      actions.push({
        type,
        title: title.slice(0, 180),
        detail: detail.slice(0, 240),
        approver: String(action.approver ?? "People Ops").trim().slice(0, 120) || "People Ops",
        approvalChainCode: String(action.approvalChainCode ?? "").trim().toLowerCase().slice(0, 64) || undefined,
        dueLabel: String(action.dueLabel ?? "Workflow paused for approval").trim().slice(0, 80) || "Workflow paused for approval",
        priority: String(action.priority ?? "Normal").trim().slice(0, 32) || "Normal",
      });
      continue;
    }

    if (type === "branch") {
      const conditions = action.conditions;
      if (!validAutomationConditions(conditions) || validLifecycleConditions(conditions)) return null;
      const thenSteps = normalizeAutomationSteps(action.then, depth + 1, budget);
      const elseSteps = action.else == null || (Array.isArray(action.else) && action.else.length === 0)
        ? []
        : normalizeAutomationSteps(action.else, depth + 1, budget);
      if (!thenSteps || !elseSteps) return null;
      actions.push({
        type,
        conditions: conditions as StudioConditions,
        then: thenSteps,
        else: elseSteps,
      });
      continue;
    }

    if (type === "create_task") {
      const title = String(action.title ?? "").trim();
      if (!title) return null;
      actions.push({
        type,
        title: title.slice(0, 160),
        owner: String(action.owner ?? "People Ops").trim().slice(0, 80) || "People Ops",
        kind: String(action.kind ?? "automation").trim().slice(0, 24) || "automation",
      });
      continue;
    }

    if (type === "create_onboarding_checklist") {
      const items = normalizeChecklistItems(action.items);
      if (!items) return null;
      actions.push({ type, items });
      continue;
    }

    if (type === "request_approval") {
      const title = String(action.title ?? "").trim();
      const detail = String(action.detail ?? "").trim();
      if (!title || !detail) return null;
      actions.push({
        type,
        title: title.slice(0, 180),
        detail: detail.slice(0, 240),
        approver: String(action.approver ?? "People Ops").trim().slice(0, 120) || "People Ops",
        approvalChainCode: String(action.approvalChainCode ?? "").trim().toLowerCase().slice(0, 64) || undefined,
        dueLabel: String(action.dueLabel ?? "Review required").trim().slice(0, 80) || "Review required",
        priority: String(action.priority ?? "Normal").trim().slice(0, 32) || "Normal",
      });
      continue;
    }

    if (type === "send_email") {
      const recipient = String(action.recipient ?? "employee");
      const subject = String(action.subject ?? "").trim();
      const body = String(action.body ?? "").trim();
      if (!["employee", "manager", "custom"].includes(recipient) || !subject || !body) return null;
      const email = action.email == null ? undefined : String(action.email).trim().toLowerCase();
      if (recipient === "custom" && (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) return null;
      actions.push({
        type,
        recipient: recipient as SendEmailAction["recipient"],
        email,
        subject: subject.slice(0, 200),
        body: body.slice(0, 8000),
      });
      continue;
    }

    if (type === "generate_document") {
      const templateId = String(action.templateId ?? "").trim();
      if (!templateId || !getAutomationDocumentTemplate(templateId)) return null;
      actions.push({ type, templateId });
      continue;
    }

    if (type === "assign_schedule") {
      const patternId = Number(action.patternId);
      const effectiveDateSource = String(action.effectiveDateSource ?? "event_effective_date") as AssignScheduleAction["effectiveDateSource"];
      const offsetDays = Number(action.offsetDays ?? 0);
      const reason = String(action.reason ?? "").trim();
      if (
        !Number.isInteger(patternId)
        || patternId <= 0
        || !["event_effective_date", "employee_start_date", "today"].includes(effectiveDateSource)
        || !Number.isInteger(offsetDays)
        || offsetDays < 0
        || offsetDays > 365
        || !reason
      ) return null;
      actions.push({
        type,
        patternId,
        effectiveDateSource,
        offsetDays,
        reason: reason.slice(0, 240),
      });
      continue;
    }

    if (type === "assign_permission_set") {
      const permissionSetId = Number(action.permissionSetId);
      if (!Number.isInteger(permissionSetId) || permissionSetId <= 0) return null;
      actions.push({ type, permissionSetId });
      continue;
    }

    if (type === "assign_benefit") {
      const planId = Number(action.planId);
      const monthlyContribution = action.monthlyContribution == null ? undefined : Number(action.monthlyContribution);
      if (!Number.isInteger(planId) || planId <= 0) return null;
      if (monthlyContribution !== undefined && (!Number.isFinite(monthlyContribution) || monthlyContribution < 0)) return null;
      actions.push({ type, planId, monthlyContribution });
      continue;
    }

    if (type === "revoke_sessions") {
      actions.push({ type });
      continue;
    }

    if (type === "deactivate_access") {
      actions.push({ type });
      continue;
    }

    if (type === "request_payroll_adjustment") {
      const amount = Number(action.amount);
      const reason = String(action.reason ?? "").trim();
      if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100_000_000 || !reason) return null;
      actions.push({
        type,
        amount,
        reason: reason.slice(0, 240),
        approver: String(action.approver ?? "Payroll").trim().slice(0, 120) || "Payroll",
        approvalChainCode: String(action.approvalChainCode ?? "").trim().toLowerCase().slice(0, 64) || undefined,
      });
      continue;
    }

    if (type === "webhook") {
      actions.push({ type });
      continue;
    }

    return null;
  }

  return actions;
}

export function normalizeAutomationActions(value: unknown): AutomationWorkflowStep[] | null {
  return normalizeAutomationSteps(value, 0, { count: 0 });
}

export function normalizeLifecycleActions(value: unknown): AutomationWorkflowStep[] | null {
  return normalizeAutomationActions(value);
}

export function validateAutomationActionTrigger(trigger: AutomationTrigger, actions: AutomationWorkflowStep[]): string | null {
  for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
    const action = actions[actionIndex];
    if (action.type === "branch") {
      const thenError = validateAutomationActionTrigger(trigger, action.then);
      if (thenError) return thenError;
      const elseError = validateAutomationActionTrigger(trigger, action.else);
      if (elseError) return elseError;
      continue;
    }
    if (action.type === "wait") continue;
    if (action.type === "approval_gate") {
      if (
        String(action.approver ?? "").trim().toLowerCase() === "manager"
        && !AUTOMATION_TRIGGER_CATALOG.find((item) => item.value === trigger)?.employeeScoped
      ) {
        return "Manager-routed approval gates require an employee-scoped trigger.";
      }
      continue;
    }
    if (action.type === "generate_document") {
      const template = getAutomationDocumentTemplate(action.templateId);
      if (!template || !template.allowedTriggers.some((allowed) => allowed === trigger)) {
        return "Generated-document template is not approved for this trigger.";
      }
      if (actions[actionIndex - 1]?.type !== "approval_gate") {
        return "Document generation must be immediately preceded by an approval gate.";
      }
      continue;
    }
  if (action.type === "assign_schedule") {
      if (!SCHEDULE_ASSIGNMENT_TRIGGERS.has(trigger)) {
        return "Schedule assignment automation is allowed only after employee hire, move, or promotion events.";
      }
      if (actions[actionIndex - 1]?.type !== "approval_gate") {
        return "Schedule assignment automation must be immediately preceded by an approval gate.";
      }
      continue;
    }
    if ((action.type === "revoke_sessions" || action.type === "deactivate_access") && trigger !== "employee.separated") {
      return "Session revocation and workspace-access removal are allowed only after employee separation.";
    }
    if (
      (action.type === "assign_permission_set" || action.type === "assign_benefit")
      && !EMPLOYEE_ACCESS_TRIGGERS.has(trigger)
    ) {
      return "Access-policy and benefit assignment actions require a governed employee hire/update/move/promotion event.";
    }
    if (
      (action.type === "create_task" || action.type === "create_onboarding_checklist")
      && !AUTOMATION_TRIGGER_CATALOG.find((item) => item.value === trigger)?.employeeScoped
    ) {
      return "Employee task/checklist actions require an employee-scoped trigger.";
    }
    if (
      action.type === "send_email"
      && action.recipient !== "custom"
      && !AUTOMATION_TRIGGER_CATALOG.find((item) => item.value === trigger)?.employeeScoped
    ) {
      return "Employee or manager email actions require an employee-scoped trigger; use a custom recipient for organization events.";
    }
    if (
      action.type === "request_approval"
      && String(action.approver ?? "").trim().toLowerCase() === "manager"
      && !AUTOMATION_TRIGGER_CATALOG.find((item) => item.value === trigger)?.employeeScoped
    ) {
      return "Manager-routed approval actions require an employee-scoped trigger.";
    }
  }
  return null;
}

function valueAtPath(context: Record<string, unknown>, path: string) {
  let value: unknown = context;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function conditionClauseMatches(clause: AutomationConditionClause, context: Record<string, unknown>) {
  const actual = valueAtPath(context, clause.field);
  const expected = clause.value;

  if (clause.operator === "exists") {
    const exists = actual !== undefined && actual !== null && actual !== "";
    return expected === false ? !exists : exists;
  }
  if (clause.operator === "eq") return actual === expected || String(actual ?? "") === String(expected ?? "");
  if (clause.operator === "neq") return !(actual === expected || String(actual ?? "") === String(expected ?? ""));
  if (clause.operator === "contains") {
    return String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
  }
  if (clause.operator === "in") {
    return Array.isArray(expected) && expected.some((item) => actual === item || String(actual ?? "") === String(item ?? ""));
  }

  const left = Number(actual);
  const right = Number(expected);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (clause.operator === "gt") return left > right;
  if (clause.operator === "gte") return left >= right;
  if (clause.operator === "lt") return left < right;
  if (clause.operator === "lte") return left <= right;
  return false;
}

function conditionMatches(
  condition: LegacyRuleCondition | StudioConditions,
  trigger: AutomationTrigger,
  context: Record<string, unknown>,
) {
  if (validLifecycleConditions(condition)) {
    if (condition.orgUnitId !== undefined && context.orgUnitId !== condition.orgUnitId) return false;
    if (condition.fromOrgUnitId !== undefined && context.previousOrgUnitId !== condition.fromOrgUnitId) return false;
    if (condition.toOrgUnitId !== undefined && context.orgUnitId !== condition.toOrgUnitId) return false;
    if (condition.employmentType && context.employmentType !== condition.employmentType) return false;
    if (
      condition.titleContains
      && !String(context.title ?? "").toLowerCase().includes(condition.titleContains.toLowerCase())
    ) return false;
    if (trigger !== "employee.moved" && (condition.fromOrgUnitId !== undefined || condition.toOrgUnitId !== undefined)) {
      return false;
    }
    return true;
  }

  const all = condition.all ?? [];
  const any = condition.any ?? [];
  if (!all.every((clause) => conditionClauseMatches(clause, context))) return false;
  if (any.length > 0 && !any.some((clause) => conditionClauseMatches(clause, context))) return false;
  return true;
}

function compileAutomationPlan(
  steps: AutomationWorkflowStep[],
  trigger: AutomationTrigger,
  context: Record<string, unknown>,
): RunnableAutomationStep[] {
  const plan: RunnableAutomationStep[] = [];
  for (const step of steps) {
    if (step.type === "branch") {
      const selected = conditionMatches(step.conditions, trigger, context) ? step.then : step.else;
      plan.push(...compileAutomationPlan(selected, trigger, context));
      continue;
    }
    plan.push(step);
  }
  return plan;
}

function executionResultArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    : [];
}

function executionContextObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function waitDurationMs(step: WaitAction) {
  const unitMs = step.unit === "days" ? 86_400_000 : step.unit === "hours" ? 3_600_000 : 60_000;
  return step.amount * unitMs;
}

async function enrichEmployeeContext(input: {
  organizationId: number;
  employeeId?: number | null;
  context?: Record<string, unknown>;
}) {
  if (!input.employeeId) return { ...(input.context ?? {}) };

  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, input.employeeId),
    eq(employees.organizationId, input.organizationId),
  )).limit(1);
  if (!employee) return { employeeId: input.employeeId, ...(input.context ?? {}) };

  const [assignment] = await db.select().from(positionAssignments).where(and(
    eq(positionAssignments.organizationId, input.organizationId),
    eq(positionAssignments.employeeId, employee.id),
    isNull(positionAssignments.effectiveUntil),
  )).limit(1);

  const [unitRows, positionRows] = await Promise.all([
    employee.orgUnitId
      ? db.select({ id: orgUnits.id, name: orgUnits.name }).from(orgUnits).where(and(
          eq(orgUnits.id, employee.orgUnitId),
          eq(orgUnits.organizationId, input.organizationId),
        )).limit(1)
      : Promise.resolve([]),
    assignment
      ? db.select().from(positions).where(and(
          eq(positions.id, assignment.positionId),
          eq(positions.organizationId, input.organizationId),
        )).limit(1)
      : Promise.resolve([]),
  ]);

  const position = positionRows[0] ?? null;
  const [profileRows, managerRows] = await Promise.all([
    position
      ? db.select({
          id: jobProfiles.id,
          title: jobProfiles.title,
          family: jobProfiles.family,
          level: jobProfiles.level,
          grade: jobProfiles.grade,
        }).from(jobProfiles).where(and(
          eq(jobProfiles.id, position.jobProfileId),
          eq(jobProfiles.organizationId, input.organizationId),
        )).limit(1)
      : Promise.resolve([]),
    position?.managerEmployeeId
      ? db.select({
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
          email: employees.email,
          title: employees.title,
        }).from(employees).where(and(
          eq(employees.id, position.managerEmployeeId),
          eq(employees.organizationId, input.organizationId),
        )).limit(1)
      : Promise.resolve([]),
  ]);

  const profile = profileRows[0] ?? null;
  const manager = managerRows[0] ?? null;
  const start = Date.parse(String(employee.startDate) + "T00:00:00Z");
  const today = Date.parse(todayPh() + "T00:00:00Z");
  const tenureDays = Number.isFinite(start) ? Math.max(0, Math.floor((today - start) / 86_400_000)) : 0;

  return {
    employeeId: employee.id,
    employeeNo: employee.employeeNo,
    employeeName: `${employee.firstName} ${employee.lastName}`,
    employeeEmail: employee.email,
    employeeStatus: employee.status,
    employeeStartDate: String(employee.startDate),
    orgUnitId: employee.orgUnitId,
    department: unitRows[0]?.name ?? null,
    location: employee.region,
    employmentType: employee.employmentType,
    title: employee.title,
    role: profile?.title ?? employee.title,
    salary: Number(employee.basicRate),
    legalEntityId: employee.legalEntityId,
    tenureDays,
    tenureYears: Math.round((tenureDays / 365.25) * 100) / 100,
    positionId: position?.id ?? null,
    positionCode: position?.code ?? null,
    jobFamily: profile?.family ?? null,
    jobLevel: profile?.level ?? null,
    grade: profile?.grade ?? null,
    managerEmployeeId: manager?.id ?? null,
    managerName: manager ? `${manager.firstName} ${manager.lastName}` : null,
    managerEmail: manager?.email ?? null,
    ...(input.context ?? {}),
  };
}

function requiredEmployeeId(employeeId: number | null | undefined, action: string) {
  if (!employeeId) throw new Error(`${action} requires an employee-scoped automation event.`);
  return employeeId;
}

function resolveApprover(selector: string | undefined, context: Record<string, unknown>) {
  const value = String(selector ?? "People Ops").trim();
  if (value.toLowerCase() === "manager") {
    const manager = String(context.managerName ?? "").trim();
    if (!manager) throw new Error("Manager approval was requested but no manager is resolved for this employee.");
    return manager;
  }
  return value || "People Ops";
}

async function executeAction(input: {
  organizationId: number;
  employeeId?: number | null;
  trigger: AutomationTrigger;
  eventKey: string;
  executionId: number;
  actionIndex: number;
  action: AutomationAction;
  context: Record<string, unknown>;
}) {
  const action = input.action;

  if (action.type === "create_task") {
    const employeeId = requiredEmployeeId(input.employeeId, "Create task");
    const [task] = await db.insert(provisioningTasks).values({
      organizationId: input.organizationId,
      employeeId,
      kind: action.kind ?? "automation",
      title: action.title,
      owner: action.owner ?? "People Ops",
    }).returning();
    return { type: action.type, taskId: task.id };
  }

  if (action.type === "create_onboarding_checklist") {
    const employeeId = requiredEmployeeId(input.employeeId, "Create onboarding checklist");
    const tasks = await db.insert(provisioningTasks).values(
      action.items.map((item) => ({
        organizationId: input.organizationId,
        employeeId,
        kind: item.kind ?? "automation",
        title: item.title,
        owner: item.owner ?? "People Ops",
      })),
    ).returning({ id: provisioningTasks.id });
    return { type: action.type, taskIds: tasks.map((task) => task.id) };
  }

  if (action.type === "request_approval") {
    const routed = await createApprovalFromConfiguredChain({
      organizationId: input.organizationId,
      chainCode: action.approvalChainCode,
      sourceType: "automation_request_approval",
      sourceKey: `${input.executionId}:${input.actionIndex}`,
      title: action.title,
      detail: action.detail,
      fallbackApprover: resolveApprover(action.approver, input.context),
      dueLabel: action.dueLabel ?? "Review required",
      priority: action.priority ?? "Normal",
    });
    return {
      type: action.type,
      approvalTaskId: routed.task.id,
      approvalChainInstanceId: routed.chainInstance?.id ?? null,
      approvalChainCode: routed.chainInstance?.policyCode ?? null,
    };
  }

  if (action.type === "send_email") {
    let recipient = action.email ?? "";
    if (action.recipient === "employee") recipient = String(input.context.employeeEmail ?? "");
    if (action.recipient === "manager") recipient = String(input.context.managerEmail ?? "");
    if (!recipient) throw new Error(`Email recipient "${action.recipient}" is not available for this event.`);

    const delivery = await queueMessage({
      organizationId: input.organizationId,
      recipient,
      subject: action.subject,
      body: action.body,
      purpose: "automation-studio",
      dedupeKey: `automation:${input.executionId}:${input.actionIndex}`,
      metadata: {
        automationExecutionId: input.executionId,
        trigger: input.trigger,
        eventKey: input.eventKey,
        employeeId: input.employeeId ?? null,
      },
      audit: {
        actor: "Automation Studio",
        metadata: {
          automationExecutionId: input.executionId,
          trigger: input.trigger,
        },
      },
    });
    return { type: action.type, recipient, deliveryStatus: delivery.status, outboxId: delivery.id };
  }

  if (action.type === "generate_document") {
    const employeeId = requiredEmployeeId(input.employeeId, "Generate employee document");
    const template = getAutomationDocumentTemplate(action.templateId);
    if (!template || !template.allowedTriggers.some((allowed) => allowed === input.trigger)) {
      throw new Error("Generated-document template is not approved for this trigger.");
    }

    const result = await generateAutomationEmployeeDocument({
      organizationId: input.organizationId,
      employeeId,
      trigger: input.trigger as AutomationDocumentTrigger,
      templateId: action.templateId,
      sourceKey: `Automation Studio document #${input.executionId}:${input.actionIndex}`,
      context: input.context,
      actor: "Automation Studio",
    });

    return {
      type: action.type,
      documentId: result.document.id,
      templateId: action.templateId,
      templateVersion: template.version,
      fileName: result.document.fileName,
      sha256: result.document.sha256,
      idempotent: result.idempotent,
      auditWarning: result.auditWarning,
    };
  }

  if (action.type === "assign_schedule") {
    const employeeId = requiredEmployeeId(input.employeeId, "Assign schedule pattern");
    const rawDate = action.effectiveDateSource === "event_effective_date"
      ? String(input.context.effectiveDate ?? "")
      : action.effectiveDateSource === "employee_start_date"
        ? String(input.context.employeeStartDate ?? "")
        : todayPh();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      throw new Error(
        action.effectiveDateSource === "event_effective_date"
          ? "Schedule assignment requires a valid effectiveDate in the triggering event."
          : "Schedule assignment could not resolve a valid employee start date.",
      );
    }
    const date = new Date(`${rawDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + (action.offsetDays ?? 0));
    const effectiveFrom = date.toISOString().slice(0, 10);

    const result = await assignEmployeeScheduleGoverned({
      organizationId: input.organizationId,
      employeeId,
      patternId: action.patternId,
      effectiveFrom,
      reason: action.reason,
      sourceKey: `Automation Studio #${input.executionId}:${input.actionIndex}`,
      actor: "Automation Studio",
    });
    return {
      type: action.type,
      assignmentId: result.assignment.id,
      patternId: action.patternId,
      effectiveFrom,
      idempotent: result.idempotent,
      staleTimesheetIds: result.staleTimesheetIds,
      guardrailIssues: result.guardrailIssues,
      auditWarning: result.auditWarning,
    };
  }

  if (action.type === "assign_permission_set") {
    const employeeId = requiredEmployeeId(input.employeeId, "Assign access policy");
    const [set] = await db.select({ id: permissionSets.id, name: permissionSets.name }).from(permissionSets).where(and(
      eq(permissionSets.id, action.permissionSetId),
      eq(permissionSets.organizationId, input.organizationId),
      eq(permissionSets.active, true),
    )).limit(1);
    if (!set) throw new Error("The configured permission set is missing or inactive.");

    const linkedUsers = await db.select({ id: users.id }).from(users).where(eq(users.employeeId, employeeId));
    let assigned = 0;
    for (const linkedUser of linkedUsers) {
      const [membership] = await db.select().from(userOrganizations).where(and(
        eq(userOrganizations.userId, linkedUser.id),
        eq(userOrganizations.organizationId, input.organizationId),
        eq(userOrganizations.active, true),
      )).limit(1);
      if (!membership) continue;
      await db.insert(userPermissionAssignments).values({
        organizationId: input.organizationId,
        userOrganizationId: membership.id,
        permissionSetId: set.id,
      }).onConflictDoUpdate({
        target: userPermissionAssignments.userOrganizationId,
        set: { permissionSetId: set.id },
      });
      assigned += 1;
    }
    if (assigned === 0) throw new Error("No active workspace login is linked to this employee.");
    return { type: action.type, permissionSetId: set.id, permissionSetName: set.name, membershipsUpdated: assigned };
  }

  if (action.type === "assign_benefit") {
    const employeeId = requiredEmployeeId(input.employeeId, "Assign benefit");
    const [plan] = await db.select().from(benefitPlans).where(and(
      eq(benefitPlans.id, action.planId),
      eq(benefitPlans.organizationId, input.organizationId),
      eq(benefitPlans.active, true),
    )).limit(1);
    if (!plan) throw new Error("The configured benefit plan is missing or inactive.");

    const [existing] = await db.select().from(benefitEnrollments).where(and(
      eq(benefitEnrollments.organizationId, input.organizationId),
      eq(benefitEnrollments.employeeId, employeeId),
      eq(benefitEnrollments.planId, plan.id),
      eq(benefitEnrollments.status, "active"),
      isNull(benefitEnrollments.endedOn),
    )).limit(1);
    if (existing) return { type: action.type, benefitEnrollmentId: existing.id, alreadyActive: true };

    const monthlyContribution = action.monthlyContribution ?? Number(plan.employeeShare);
    if (plan.cap != null && monthlyContribution > Number(plan.cap) + 0.01) {
      throw new Error(`Benefit contribution exceeds the configured plan cap of ${plan.cap}.`);
    }

    const [enrollment] = await db.insert(benefitEnrollments).values({
      organizationId: input.organizationId,
      employeeId,
      planId: plan.id,
      monthlyContribution: monthlyContribution.toFixed(2),
      status: "active",
      startedOn: String(input.context.effectiveDate ?? input.context.startDate ?? todayPh()).slice(0, 10),
    }).returning();
    return { type: action.type, benefitEnrollmentId: enrollment.id, planId: plan.id, planName: plan.name };
  }

  if (action.type === "revoke_sessions") {
    if (input.trigger !== "employee.separated") {
      throw new Error("Session revocation automation is allowed only for employee separation.");
    }
    const employeeId = requiredEmployeeId(input.employeeId, "Revoke sessions");
    const linkedUsers = await db.select({ id: users.id }).from(users).where(eq(users.employeeId, employeeId));
    let revoked = 0;
    for (const linkedUser of linkedUsers) {
      const rows = await db.update(sessions).set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, linkedUser.id), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      revoked += rows.length;
    }
    return { type: action.type, revoked };
  }

  if (action.type === "deactivate_access") {
    if (input.trigger !== "employee.separated") {
      throw new Error("Workspace-access removal is allowed only for employee separation.");
    }
    const employeeId = requiredEmployeeId(input.employeeId, "Remove workspace access");
    const linkedUsers = await db.select({ id: users.id }).from(users).where(eq(users.employeeId, employeeId));
    let membershipsDeactivated = 0;
    let scimDeactivated = 0;
    let sessionsRevoked = 0;
    for (const linkedUser of linkedUsers) {
      const memberships = await db.update(userOrganizations).set({ active: false }).where(and(
        eq(userOrganizations.userId, linkedUser.id),
        eq(userOrganizations.organizationId, input.organizationId),
        eq(userOrganizations.active, true),
      )).returning({ id: userOrganizations.id });
      membershipsDeactivated += memberships.length;

      const scim = await db.update(scimIdentities).set({ active: false, lastSyncedAt: new Date() }).where(and(
        eq(scimIdentities.userId, linkedUser.id),
        eq(scimIdentities.organizationId, input.organizationId),
        eq(scimIdentities.active, true),
      )).returning({ id: scimIdentities.id });
      scimDeactivated += scim.length;

      const revoked = await db.update(sessions).set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, linkedUser.id), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      sessionsRevoked += revoked.length;
    }
    return { type: action.type, membershipsDeactivated, scimDeactivated, sessionsRevoked };
  }

  if (action.type === "request_payroll_adjustment") {
    const employeeSuffix = input.employeeId ? ` · employee #${input.employeeId}` : "";
    const routed = await createApprovalFromConfiguredChain({
      organizationId: input.organizationId,
      chainCode: action.approvalChainCode,
      sourceType: "automation_payroll_adjustment",
      sourceKey: `${input.executionId}:${input.actionIndex}`,
      title: "Review automation-requested payroll adjustment",
      detail: `${action.reason} · PHP ${action.amount.toFixed(2)}${employeeSuffix}`.slice(0, 240),
      fallbackApprover: resolveApprover(action.approver ?? "Payroll", input.context),
      dueLabel: "Approval required before payroll mutation",
      priority: "High",
      amount: Math.abs(action.amount),
      amountCurrency: "PHP",
      amountBasis: "absolute_requested_adjustment",
    });
    return {
      type: action.type,
      approvalTaskId: routed.task.id,
      approvalChainInstanceId: routed.chainInstance?.id ?? null,
      approvalChainCode: routed.chainInstance?.policyCode ?? null,
      requestedAmount: action.amount,
      approvalAmount: Math.abs(action.amount),
      appliedAutomatically: false,
    };
  }

  if (action.type === "webhook") {
    const deliveries = await dispatchWebhook({
      organizationId: input.organizationId,
      event: "automation.triggered",
      data: {
        automationExecutionId: input.executionId,
        employeeId: input.employeeId ?? null,
        trigger: input.trigger,
        eventKey: input.eventKey,
        context: input.context,
      },
    });
    return { type: action.type, deliveries };
  }

  const exhaustive: never = action;
  throw new Error(`Unsupported automation action: ${String(exhaustive)}`);
}

export async function advanceAutomationExecution(executionId: number) {
  const [execution] = await db.select().from(automationExecutions)
    .where(eq(automationExecutions.id, executionId))
    .limit(1);
  if (!execution) throw new Error("Automation execution not found.");
  if (!["in_progress", "resuming"].includes(execution.status)) return execution;

  const trigger = execution.trigger as AutomationTrigger;
  if (!(AUTOMATION_TRIGGERS as readonly string[]).includes(trigger)) {
    throw new Error("Stored automation execution has an unsupported trigger.");
  }

  const normalized = normalizeAutomationActions(execution.workflow);
  if (!normalized || normalized.some((step) => step.type === "branch")) {
    throw new Error("Stored automation execution workflow is invalid.");
  }
  const workflow = normalized as RunnableAutomationStep[];
  const context = executionContextObject(execution.context);
  let cursor = Math.max(0, Number(execution.cursor ?? 0));
  const result = executionResultArray(execution.result);

  while (cursor < workflow.length) {
    const step = workflow[cursor];

    if (step.type === "wait") {
      const resumeAt = new Date(Date.now() + waitDurationMs(step));
      result.push({
        type: step.type,
        stepIndex: cursor,
        status: "waiting",
        amount: step.amount,
        unit: step.unit,
        resumeAt: resumeAt.toISOString(),
      });
      const [waiting] = await db.update(automationExecutions).set({
        status: "waiting",
        cursor: cursor + 1,
        resumeAt,
        waitingApprovalTaskId: null,
        result,
        updatedAt: new Date(),
      }).where(and(
        eq(automationExecutions.id, execution.id),
        eq(automationExecutions.status, execution.status),
      )).returning();
      return waiting ?? execution;
    }

    if (step.type === "approval_gate") {
      const routed = await createApprovalFromConfiguredChain({
        organizationId: execution.organizationId,
        chainCode: step.approvalChainCode,
        sourceType: "automation_approval_gate",
        sourceKey: `${execution.id}:${cursor}`,
        title: step.title,
        detail: step.detail,
        fallbackApprover: resolveApprover(step.approver ?? "People Ops", context),
        dueLabel: step.dueLabel ?? "Workflow paused for approval",
        priority: step.priority ?? "Normal",
      });
      const task = routed.task;
      result.push({
        type: step.type,
        stepIndex: cursor,
        status: "pending",
        approvalTaskId: task.id,
        approvalChainInstanceId: routed.chainInstance?.id ?? null,
        approvalChainCode: routed.chainInstance?.policyCode ?? null,
      });
      const [waiting] = await db.update(automationExecutions).set({
        status: "waiting_approval",
        waitingApprovalTaskId: task.id,
        resumeAt: null,
        result,
        updatedAt: new Date(),
      }).where(and(
        eq(automationExecutions.id, execution.id),
        eq(automationExecutions.status, execution.status),
      )).returning();
      return waiting ?? execution;
    }

    try {
      const evidence = await executeAction({
        organizationId: execution.organizationId,
        employeeId: execution.employeeId,
        trigger,
        eventKey: execution.eventKey,
        executionId: execution.id,
        actionIndex: cursor,
        action: step,
        context,
      });
      result.push({ ...evidence, stepIndex: cursor, status: "completed" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Automation action failed.";
      result.push({ type: step.type, stepIndex: cursor, status: "failed", error: message });
    }

    cursor += 1;
    await db.update(automationExecutions).set({
      cursor,
      result,
      updatedAt: new Date(),
    }).where(eq(automationExecutions.id, execution.id));
  }

  const businessResults = result.filter((row) => !["wait", "approval_gate", "approval_gate_decision"].includes(String(row.type ?? "")));
  const failed = businessResults.filter((row) => row.status === "failed");
  const succeeded = businessResults.filter((row) => row.status !== "failed");
  const status = failed.length === 0 ? "completed" : succeeded.length === 0 ? "failed" : "partial";
  const error = failed.length
    ? failed.map((row) => String(row.error ?? "Automation action failed.")).join("\n").slice(0, 4000)
    : null;

  const [finished] = await db.update(automationExecutions).set({
    status,
    cursor: workflow.length,
    resumeAt: null,
    waitingApprovalTaskId: null,
    result,
    error,
    updatedAt: new Date(),
  }).where(eq(automationExecutions.id, execution.id)).returning();

  return finished ?? execution;
}

export async function resumeDueAutomationExecutions(now = new Date(), limit = 25) {
  const due = await db.select().from(automationExecutions).where(and(
    eq(automationExecutions.status, "waiting"),
    lte(automationExecutions.resumeAt, now),
  )).limit(limit);

  const outcomes: Array<{ executionId: number; status: string; error?: string }> = [];
  for (const row of due) {
    const [claimed] = await db.update(automationExecutions).set({
      status: "in_progress",
      resumeAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(automationExecutions.id, row.id),
      eq(automationExecutions.status, "waiting"),
      lte(automationExecutions.resumeAt, now),
    )).returning({ id: automationExecutions.id });
    if (!claimed) continue;

    try {
      const advanced = await advanceAutomationExecution(row.id);
      outcomes.push({ executionId: row.id, status: advanced.status });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Automation resume failed.";
      await db.update(automationExecutions).set({
        status: "failed",
        error: message.slice(0, 4000),
        updatedAt: new Date(),
      }).where(eq(automationExecutions.id, row.id));
      outcomes.push({ executionId: row.id, status: "failed", error: message });
    }
  }
  return outcomes;
}

export async function resumeAutomationExecutionFromApproval(input: {
  approvalTaskId: number;
  decision: "Approved" | "Declined";
  decidedBy: string;
}) {
  const [execution] = await db.select().from(automationExecutions).where(and(
    eq(automationExecutions.waitingApprovalTaskId, input.approvalTaskId),
    eq(automationExecutions.status, "waiting_approval"),
  )).limit(1);
  if (!execution) return null;

  const result = executionResultArray(execution.result);
  result.push({
    type: "approval_gate_decision",
    approvalTaskId: input.approvalTaskId,
    decision: input.decision,
    decidedBy: input.decidedBy,
    decidedAt: new Date().toISOString(),
  });

  if (input.decision === "Declined") {
    const [declined] = await db.update(automationExecutions).set({
      status: "failed",
      waitingApprovalTaskId: null,
      result,
      error: `Approval gate #${input.approvalTaskId} was declined by ${input.decidedBy}.`,
      updatedAt: new Date(),
    }).where(and(
      eq(automationExecutions.id, execution.id),
      eq(automationExecutions.status, "waiting_approval"),
      eq(automationExecutions.waitingApprovalTaskId, input.approvalTaskId),
    )).returning();
    return declined ?? execution;
  }

  const [claimed] = await db.update(automationExecutions).set({
    status: "in_progress",
    cursor: execution.cursor + 1,
    waitingApprovalTaskId: null,
    result,
    updatedAt: new Date(),
  }).where(and(
    eq(automationExecutions.id, execution.id),
    eq(automationExecutions.status, "waiting_approval"),
    eq(automationExecutions.waitingApprovalTaskId, input.approvalTaskId),
  )).returning({ id: automationExecutions.id });
  if (!claimed) return null;

  return advanceAutomationExecution(execution.id);
}

export async function runAutomationEvent(input: {
  organizationId: number;
  employeeId?: number | null;
  trigger: AutomationTrigger;
  eventKey: string;
  context?: Record<string, unknown>;
}) {
  if (!(AUTOMATION_TRIGGERS as readonly string[]).includes(input.trigger)) {
    throw new Error(`Unsupported automation trigger: ${input.trigger}`);
  }

  const context = await enrichEmployeeContext({
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    context: input.context,
  });
  const rules = await db.select().from(automationRules).where(and(
    eq(automationRules.organizationId, input.organizationId),
    eq(automationRules.trigger, input.trigger),
    eq(automationRules.active, true),
  ));
  const outcomes: Array<{ ruleId: number; status: string; result?: unknown; error?: string }> = [];

  for (const rule of rules) {
    const conditions = validAutomationConditions(rule.conditions) ? rule.conditions : null;
    const actions = normalizeAutomationActions(rule.actions);
    if (!conditions || !actions) {
      outcomes.push({ ruleId: rule.id, status: "failed", error: "Stored rule definition is invalid." });
      continue;
    }
    if (!conditionMatches(conditions, input.trigger, context)) continue;

    const actionTriggerError = validateAutomationActionTrigger(input.trigger, actions);
    if (actionTriggerError) {
      outcomes.push({ ruleId: rule.id, status: "failed", error: actionTriggerError });
      continue;
    }

    const workflow = compileAutomationPlan(actions, input.trigger, context);
    if (workflow.length > 50) {
      outcomes.push({ ruleId: rule.id, status: "failed", error: "Compiled workflow exceeds the 50-step safety limit." });
      continue;
    }

    const [execution] = await db.insert(automationExecutions).values({
      organizationId: input.organizationId,
      ruleId: rule.id,
      employeeId: input.employeeId ?? null,
      trigger: input.trigger,
      eventKey: input.eventKey.slice(0, 240),
      status: "in_progress",
      workflow,
      context,
      cursor: 0,
      result: [],
      updatedAt: new Date(),
    }).onConflictDoNothing().returning();
    if (!execution) {
      outcomes.push({ ruleId: rule.id, status: "skipped" });
      continue;
    }

    try {
      const advanced = await advanceAutomationExecution(execution.id);
      outcomes.push({
        ruleId: rule.id,
        status: advanced.status,
        result: advanced.result,
        ...(advanced.error ? { error: advanced.error } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Automation execution failed.";
      await db.update(automationExecutions).set({
        status: "failed",
        error: message.slice(0, 4000),
        updatedAt: new Date(),
      }).where(eq(automationExecutions.id, execution.id));
      outcomes.push({ ruleId: rule.id, status: "failed", error: message });
    }
  }

  return outcomes;
}

/**
 * Route adapters call the safe wrapper only after their authoritative business
 * transaction commits. Automation outages or malformed secondary integrations
 * must never roll back or misreport a successful hire, payroll transition, or
 * employee lifecycle change.
 */
export async function runAutomationEventSafely(input: {
  organizationId: number;
  employeeId?: number | null;
  trigger: AutomationTrigger;
  eventKey: string;
  context?: Record<string, unknown>;
}) {
  try {
    return await runAutomationEvent(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Automation engine failed.";
    return [{
      ruleId: 0,
      status: "engine_error",
      error: message.slice(0, 4000),
    }];
  }
}

/**
 * Backwards-compatible wrapper for the original joiner/mover/leaver engine.
 * Existing callers and stored rules continue to work while Automation Studio
 * uses the broader event/condition/action model underneath.
 */
export async function runLifecycleAutomations(input: {
  organizationId: number;
  employeeId: number;
  trigger: LifecycleTrigger;
  eventKey: string;
  context?: LifecycleContext;
}) {
  return runAutomationEventSafely({
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    trigger: input.trigger,
    eventKey: input.eventKey,
    context: input.context,
  });
}
