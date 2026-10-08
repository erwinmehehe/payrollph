"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApprovalChainAdmin } from "@/components/approval-chain-admin";
import { SlackConnectorAdmin } from "@/components/slack-connector-admin";
import { DynamicWorkerGroupsPanel } from "@/components/dynamic-worker-groups-panel";
import {
  Activity,
  Bot,
  CheckCircle2,
  CircleAlert,
  GitBranch,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Workflow,
  Zap,
} from "lucide-react";

type TriggerCatalog = {
  value: string;
  label: string;
  category: string;
  employeeScoped: boolean;
  live: boolean;
};

type ConditionCatalog = {
  value: string;
  label: string;
  kind: string;
};

type ActionCatalog = {
  value: string;
  label: string;
  category: string;
};

type DocumentTemplateCatalog = {
  id: string;
  version: number;
  name: string;
  description: string;
  allowedTriggers: string[];
};

type WorkflowTemplateCatalog = {
  id: string;
  version: number;
  category: string;
  name: string;
  description: string;
  trigger: string;
  conditionCount: number;
  actionCount: number;
};

type AutomationRule = {
  id: number;
  name: string;
  trigger: string;
  conditions: unknown;
  actions: unknown;
  active: boolean;
  publishedVersion: number;
  draftVersion: number | null;
  createdAt: string;
  updatedAt: string;
};

type ApprovalChainPolicy = {
  id: number;
  code: string;
  name: string;
  purpose: string;
  version: number;
  steps: unknown;
  active: boolean;
};

type IntegrationConnector = {
  id: number;
  provider: "slack";
  name: string;
  active: boolean;
  verifiedAt: string | null;
  verifiedIdentity: Record<string, unknown> | null;
  config: {
    defaultChannelId: string;
    allowedChannelIds: string[];
  };
};

type AutomationRuleVersion = {
  id: number;
  ruleId: number;
  version: number;
  status: "draft" | "published" | "superseded";
  name: string;
  trigger: string;
  active: boolean;
  sourceVersion: number | null;
  createdAt: string;
  publishedAt: string | null;
};

type Execution = {
  id: number;
  ruleId: number;
  employeeId: number | null;
  trigger: string;
  eventKey: string;
  status: string;
  result: unknown;
  error: string | null;
  cursor?: number;
  resumeAt?: string | null;
  waitingApprovalTaskId?: number | null;
  createdAt: string;
};

type ImpactPreviewResponse = {
  draft: {
    ruleId: number;
    version: number;
    name: string;
    trigger: string;
  };
  generatedAt: string;
  dataNote: string;
  preview: {
    trigger: string;
    eventsEvaluated: number;
    matchedEvents: number;
    skippedEvents: number;
    projectedSteps: number;
    approvalSteps: number;
    waitSteps: number;
    policyBlocks: number;
    authoritativePolicyBlocks: number;
    legacyPolicyBlocks: number;
    projectedPayrollAdjustmentAmount: number;
    projectedPayrollAdjustmentAbsoluteAmount: number;
    actionCounts: Record<string, number>;
    authoritativeEvents: number;
    legacyBackfillEvents: number;
    definitionError: string | null;
    samples: Array<{
      eventKey: string;
      employeeId: number | null;
      source: string;
      occurredAt: string | null;
      matched: boolean;
      reason: string;
      projectedSteps: string[];
      policyBlocks: string[];
    }>;
  };
};

type OperationalCase = {
  id: number;
  caseType: string;
  sourceType: string;
  sourceId: number;
  sourceVersion: number | null;
  executionId: number | null;
  stepIndex: number | null;
  ownerTeam: string;
  title: string;
  detail: string;
  evidence: unknown;
  status: "open" | "acknowledged" | "resolved";
  acknowledgedByName: string | null;
  acknowledgedAt: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
};

type StudioData = {
  rules: AutomationRule[];
  versions: AutomationRuleVersion[];
  executions: Execution[];
  executionCenter: {
    attentionQueue: Array<{
      executionId: number;
      ruleId: number;
      status: string;
      error: string | null;
      failedSteps: Array<{ stepIndex: number; type: string; error: string }>;
      retryableFailedStepIndices: number[];
      deadLetterAcknowledgedCount: number;
      deadLetters: Array<{ stepIndex: number; caseId: number | null; status: string | null }>;
      replayEligible: boolean;
      ageMinutes: number;
      slaState: "fresh" | "aging" | "breached";
    }>;
    operationalCases: OperationalCase[];
    caseCounts: { open: number; acknowledged: number; resolved: number; deadLetters: number };
    decisionDiagnostics: Array<{
      eventId: number;
      eventKey: string;
      trigger: string;
      occurredAt: string;
      ruleId: number;
      ruleName: string;
      outcome: string;
      reason: string;
      executionId: number | null;
    }>;
    generatedAt: string;
    diagnosticNote: string;
  };
  catalogs: {
    triggers: TriggerCatalog[];
    liveTriggers: string[];
    plannedTriggers: string[];
    conditions: ConditionCatalog[];
    operators: string[];
    actions: ActionCatalog[];
    documentTemplates: DocumentTemplateCatalog[];
    templates: WorkflowTemplateCatalog[];
  };
  orgUnits: Array<{ id: number; name: string; code: string }>;
  permissionSets: Array<{ id: number; name: string; active: boolean }>;
  benefitPlans: Array<{
    id: number;
    name: string;
    category: string;
    active: boolean;
    employeeShare: string;
    cap: string | null;
  }>;
  approvalChains: ApprovalChainPolicy[];
  integrationConnectors: IntegrationConnector[];
  dynamicGroups: Array<{ id: number; code: string; name: string; version: number }>;
  schedulePatterns: Array<{
    id: number;
    code: string;
    name: string;
    cycleDays: number;
    active: boolean;
  }>;
  analytics: {
    activeRules: number;
    recentExecutions: number;
    completed: number;
    partial: number;
    failed: number;
    waiting: number;
    successRate: number;
  };
};

type LanguageProposal = {
  draft: {
    name: string;
    trigger: string;
    conditions: { version: 1; all: Array<{ field: string; operator: string; value?: unknown }>; any: Array<{ field: string; operator: string; value?: unknown }> };
    actions: Array<Record<string, unknown>>;
  };
  validation: { valid: boolean; warnings: string[]; errors: string[] };
  source: "model" | "approved-template";
  sourceNote: string;
};

type ConditionDraft = {
  id: string;
  field: string;
  operator: string;
  value: string;
};

type ActionDraft = {
  id: string;
  type: string;
  caseType: string;
  title: string;
  owner: string;
  detail: string;
  approver: string;
  approvalChainCode: string;
  priority: string;
  recipient: string;
  email: string;
  subject: string;
  body: string;
  permissionSetId: string;
  planId: string;
  monthlyContribution: string;
  amount: string;
  reason: string;
  checklist: string;
  waitAmount: string;
  waitUnit: string;
  branchField: string;
  branchOperator: string;
  branchValue: string;
  branchThenTitle: string;
  branchElseTitle: string;
  schedulePatternId: string;
  scheduleEffectiveDateSource: string;
  scheduleOffsetDays: string;
  scheduleReason: string;
  documentTemplateId: string;
  slackConnectorId: string;
  slackChannelId: string;
  slackMessage: string;
};

const defaultAction = (id: string): ActionDraft => ({
  id,
  type: "create_task",
  caseType: "coverage_recovery",
  title: "",
  owner: "People Ops",
  detail: "",
  approver: "People Ops",
  approvalChainCode: "",
  priority: "Normal",
  recipient: "employee",
  email: "",
  subject: "",
  body: "",
  permissionSetId: "",
  planId: "",
  monthlyContribution: "",
  amount: "",
  reason: "",
  checklist: "",
  waitAmount: "1",
  waitUnit: "days",
  branchField: "department",
  branchOperator: "eq",
  branchValue: "",
  branchThenTitle: "",
  branchElseTitle: "",
  schedulePatternId: "",
  scheduleEffectiveDateSource: "event_effective_date",
  scheduleOffsetDays: "0",
  scheduleReason: "Automation Studio approved schedule assignment",
  documentTemplateId: "",
  slackConnectorId: "",
  slackChannelId: "",
  slackMessage: "",
});

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });

const formatPeso = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(value);

function conditionCount(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const row = value as Record<string, unknown>;
  if (Array.isArray(row.all) || Array.isArray(row.any)) {
    return (Array.isArray(row.all) ? row.all.length : 0) + (Array.isArray(row.any) ? row.any.length : 0);
  }
  return Object.keys(row).length;
}

function actionCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

const OPERATIONAL_REVIEW_BY_TRIGGER: Record<string, string> = {
  "coverage.gap_approaching": "coverage_recovery",
  "timesheet.cutoff_approaching": "timesheet_escalation",
  "timesheet.missing_approaching": "missing_timesheet_escalation",
  "attendance.exception_created": "attendance_resolution",
  "attendance.exception_aging": "attendance_resolution",
  "payroll.pay_date_approaching": "payroll_readiness",
  "government.remittance_due": "statutory_followup",
};

function actionAllowed(trigger: TriggerCatalog | undefined, type: string) {
  if (!trigger) return false;
  if (type === "prepare_operational_review") return Boolean(OPERATIONAL_REVIEW_BY_TRIGGER[trigger.value]);
  if (["revoke_sessions", "deactivate_access"].includes(type)) return trigger.value === "employee.separated";
  if (["assign_permission_set", "assign_benefit"].includes(type)) {
    return ["employee.hired", "employee.updated", "employee.field_changed", "employee.moved", "employee.promoted", "candidate.hired"].includes(trigger.value);
  }
  if (type === "assign_schedule") {
    return ["employee.hired", "employee.moved", "employee.promoted"].includes(trigger.value);
  }
  if (type === "generate_document") {
    return ["employee.hired", "employee.moved", "employee.promoted", "employee.separated"].includes(trigger.value);
  }
  if (["create_task", "create_onboarding_checklist"].includes(type)) return trigger.employeeScoped;
  return true;
}

export function AutomationStudioPanel({
  organizationId,
  setNotice,
}: {
  organizationId: number;
  setNotice: (message: string) => void;
}) {
  const [data, setData] = useState<StudioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mutatingExecutionId, setMutatingExecutionId] = useState<number | null>(null);
  const [mutatingCaseId, setMutatingCaseId] = useState<number | null>(null);
  const [previewingRuleId, setPreviewingRuleId] = useState<number | null>(null);
  const [impactPreview, setImpactPreview] = useState<ImpactPreviewResponse | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [languageRequest, setLanguageRequest] = useState("");
  const [languageProposal, setLanguageProposal] = useState<LanguageProposal | null>(null);
  const [draftingLanguage, setDraftingLanguage] = useState(false);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("employee.hired");
  const [matchMode, setMatchMode] = useState<"all" | "any">("all");
  const [conditions, setConditions] = useState<ConditionDraft[]>([]);
  const [actions, setActions] = useState<ActionDraft[]>([defaultAction("a1")]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/automation-studio?organizationId=${organizationId}`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load Automation Studio.");
      setData(payload as StudioData);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load Automation Studio.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  const selectedTrigger = useMemo(
    () => data?.catalogs.triggers.find((item) => item.value === trigger),
    [data, trigger],
  );
  const ruleById = useMemo(
    () => new Map((data?.rules ?? []).map((rule) => [rule.id, rule])),
    [data],
  );


  async function runExecutionControl(
    action: "retry-execution-step" | "replay-execution",
    executionId: number,
    stepIndex?: number,
  ) {
    setMutatingExecutionId(executionId);
    try {
      const response = await fetch("/api/automation-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action,
          executionId,
          ...(stepIndex == null ? {} : { stepIndex }),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Execution Center action failed.");
      await load();
      setNotice(
        action === "retry-execution-step"
          ? `Execution #${executionId}: safe step retry attempted; current status ${payload.execution?.status ?? "unknown"}. Successful steps were not rerun.`
          : `Execution #${executionId} replayed from its stored snapshot using idempotent state-setting actions only.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Execution Center action failed.");
    } finally {
      setMutatingExecutionId(null);
    }
  }

  async function quarantineExecutionStep(executionId: number, stepIndex: number) {
    const note = window.prompt(
      "Reason for dead-letter quarantine (at least 12 characters). Review external side effects first:",
    )?.trim();
    if (!note) return;
    setMutatingExecutionId(executionId);
    try {
      const response = await fetch("/api/automation-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId, action: "quarantine-execution-step", executionId, stepIndex, note,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not quarantine failed step.");
      await load();
      setNotice(`Execution #${executionId}, step ${stepIndex + 1} saved to the human dead-letter queue without replaying any action.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not quarantine failed step.");
    } finally {
      setMutatingExecutionId(null);
    }
  }

  async function triageOperationalCase(operationalCase: OperationalCase, transition: "acknowledge" | "resolve" | "reopen") {
    const note = window.prompt(
      transition === "resolve"
        ? "Record the governed source resolution or manual dead-letter disposition (at least 16 characters):"
        : transition === "acknowledge"
          ? "Record review/ownership evidence (at least 16 characters):"
          : "Why must this case be reopened? (at least 16 characters):",
    )?.trim();
    if (!note) return;
    setMutatingCaseId(operationalCase.id);
    try {
      const response = await fetch("/api/automation-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "triage-operational-case",
          caseId: operationalCase.id,
          transition,
          note,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not update operations case.");
      await load();
      setNotice(`Case #${operationalCase.id} ${transition} recorded with audit evidence. Underlying source records and execution results were not changed.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update operations case.");
    } finally {
      setMutatingCaseId(null);
    }
  }

  function resetBuilder() {
    setName("");
    setTrigger("employee.hired");
    setMatchMode("all");
    setConditions([]);
    setActions([defaultAction("a" + Date.now())]);
  }

  function addCondition() {
    const field = data?.catalogs.conditions[0]?.value ?? "department";
    setConditions((rows) => [...rows, {
      id: "c" + Date.now() + rows.length,
      field,
      operator: "eq",
      value: "",
    }]);
  }

  function updateCondition(id: string, patch: Partial<ConditionDraft>) {
    setConditions((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function addAction() {
    setActions((rows) => [...rows, defaultAction("a" + Date.now() + rows.length)]);
  }

  function updateAction(id: string, patch: Partial<ActionDraft>) {
    setActions((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function serializeCondition(row: ConditionDraft) {
    const field = data?.catalogs.conditions.find((item) => item.value === row.field);
    if (row.operator === "exists") {
      return { field: row.field, operator: row.operator, value: row.value !== "false" };
    }
    if (row.operator === "in") {
      const values = row.value.split(",").map((item) => item.trim()).filter(Boolean);
      return {
        field: row.field,
        operator: row.operator,
        value: field?.kind === "number" || field?.kind === "number_array" ? values.map(Number) : values,
      };
    }
    return {
      field: row.field,
      operator: row.operator,
      value: field?.kind === "number"
        ? Number(row.value)
        : field?.kind === "boolean"
          ? row.value === "true"
          : row.value,
    };
  }

  function serializeAction(row: ActionDraft): Record<string, unknown> {
    if (row.type === "wait") {
      return { type: row.type, amount: Number(row.waitAmount), unit: row.waitUnit };
    }
    if (row.type === "approval_gate") {
      return {
        type: row.type,
        title: row.title,
        detail: row.detail,
        approver: row.approver,
        approvalChainCode: row.approvalChainCode || undefined,
        priority: row.priority,
        dueLabel: "Workflow paused for approval",
      };
    }
    if (row.type === "branch") {
      const field = data?.catalogs.conditions.find((item) => item.value === row.branchField);
      const value = row.branchOperator === "exists"
        ? row.branchValue !== "false"
        : row.branchOperator === "in"
          ? row.branchValue.split(",").map((item) => item.trim()).filter(Boolean).map((item) => field?.kind === "number" || field?.kind === "number_array" ? Number(item) : item)
          : field?.kind === "number"
            ? Number(row.branchValue)
            : field?.kind === "boolean"
              ? row.branchValue === "true"
              : row.branchValue;
      return {
        type: row.type,
        conditions: {
          version: 1,
          all: [{ field: row.branchField, operator: row.branchOperator, value }],
          any: [],
        },
        then: [{ type: "create_task", title: row.branchThenTitle, owner: row.owner || "People Ops" }],
        else: row.branchElseTitle.trim()
          ? [{ type: "create_task", title: row.branchElseTitle, owner: row.owner || "People Ops" }]
          : [],
      };
    }
    if (row.type === "create_task") {
      return { type: row.type, title: row.title, owner: row.owner };
    }
    if (row.type === "create_onboarding_checklist") {
      return {
        type: row.type,
        items: row.checklist.split("\n").map((title) => title.trim()).filter(Boolean).map((title) => ({
          title,
          owner: row.owner || "People Ops",
          kind: "automation",
        })),
      };
    }
    if (row.type === "request_approval") {
      return {
        type: row.type,
        title: row.title,
        detail: row.detail,
        approver: row.approver,
        approvalChainCode: row.approvalChainCode || undefined,
        priority: row.priority,
      };
    }
    if (row.type === "send_email") {
      return {
        type: row.type,
        recipient: row.recipient,
        ...(row.recipient === "custom" ? { email: row.email } : {}),
        subject: row.subject,
        body: row.body,
      };
    }
    if (row.type === "generate_document") {
      return {
        type: row.type,
        templateId: row.documentTemplateId,
      };
    }
    if (row.type === "assign_schedule") {
      return {
        type: row.type,
        patternId: Number(row.schedulePatternId),
        effectiveDateSource: row.scheduleEffectiveDateSource,
        offsetDays: Number(row.scheduleOffsetDays || "0"),
        reason: row.scheduleReason,
      };
    }
    if (row.type === "assign_permission_set") {
      return { type: row.type, permissionSetId: Number(row.permissionSetId) };
    }
    if (row.type === "assign_benefit") {
      return {
        type: row.type,
        planId: Number(row.planId),
        ...(row.monthlyContribution ? { monthlyContribution: Number(row.monthlyContribution) } : {}),
      };
    }
    if (row.type === "send_slack_message") {
      return {
        type: row.type,
        connectorId: Number(row.slackConnectorId),
        channelId: row.slackChannelId || undefined,
        text: row.slackMessage,
      };
    }
    if (row.type === "prepare_operational_review") {
      return {
        type: row.type,
        caseType: row.caseType,
        reason: row.reason,
      };
    }
    if (row.type === "request_payroll_adjustment") {
      return {
        type: row.type,
        amount: Number(row.amount),
        reason: row.reason,
        approver: row.approver || "Payroll",
        approvalChainCode: row.approvalChainCode || undefined,
      };
    }
    return { type: row.type };
  }

  async function saveRule(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedTrigger?.live) {
      setNotice("That trigger is planned but its authoritative event adapter is not live yet.");
      return;
    }

    const invalidAction = actions.find((row) => !actionAllowed(selectedTrigger, row.type));
    if (invalidAction) {
      setNotice("One or more THEN actions are not allowed for this trigger.");
      return;
    }
    const unsafeScheduleIndex = actions.findIndex((row, index) =>
      row.type === "assign_schedule" && actions[index - 1]?.type !== "approval_gate"
    );
    if (unsafeScheduleIndex >= 0) {
      setNotice("Schedule assignment must be immediately preceded by an approval gate.");
      return;
    }
    const unsafeDocumentIndex = actions.findIndex((row, index) =>
      row.type === "generate_document" && actions[index - 1]?.type !== "approval_gate"
    );
    if (unsafeDocumentIndex >= 0) {
      setNotice("Document generation must be immediately preceded by an approval gate.");
      return;
    }

    setSaving(true);
    try {
      const conditionRows = conditions.map(serializeCondition);
      const response = await fetch("/api/automation-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "save-rule",
          name,
          trigger,
          conditions: {
            version: 1,
            all: matchMode === "all" ? conditionRows : [],
            any: matchMode === "any" ? conditionRows : [],
          },
          actions: actions.map(serializeAction),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not save automation rule.");
      resetBuilder();
      setShowBuilder(false);
      await load();
      setNotice("Automation draft saved. Publish it from the workflow list when it is ready to go live.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save automation rule.");
    } finally {
      setSaving(false);
    }
  }

  async function generateLanguageProposal() {
    setDraftingLanguage(true);
    setLanguageProposal(null);
    setImpactPreview(null);
    try {
      const response = await fetch("/api/automation-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, action: "draft-from-language", request: languageRequest }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not interpret the workflow request.");
      setLanguageProposal(payload as LanguageProposal);
      setNotice("Typed proposal validated. Review the entire definition before saving the unpublished draft.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Natural-language draft failed.");
    } finally {
      setDraftingLanguage(false);
    }
  }

  async function saveLanguageProposal() {
    if (!languageProposal?.validation.valid) return;
    setSavingLanguage(true);
    setImpactPreview(null);
    try {
      const response = await fetch("/api/automation-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "save-rule",
          ...languageProposal.draft,
          active: false, // A language proposal never activates a workflow on save.
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not save typed workflow draft.");
      setLanguageProposal(null);
      setLanguageRequest("");
      await load();
      setNotice("Unpublished workflow saved as inactive draft. Run Impact Preview, then approve/publish explicitly.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save language proposal.");
    } finally {
      setSavingLanguage(false);
    }
  }

  async function instantiateTemplate(template: WorkflowTemplateCatalog) {
    const requestedName = window.prompt("Draft workflow name", template.name)?.trim();
    if (!requestedName) return;

    setSaving(true);
    try {
      const response = await fetch("/api/automation-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "create-from-template",
          templateId: template.id,
          name: requestedName,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not create workflow draft from template.");
      await load();
      setNotice(`${requestedName} created as draft v${payload.draft?.version ?? 1}. Review it before publishing.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create workflow draft from template.");
    } finally {
      setSaving(false);
    }
  }

  async function previewRule(rule: AutomationRule) {
    if (!rule.draftVersion) return;
    setPreviewingRuleId(rule.id);
    try {
      const response = await fetch(
        `/api/automation-studio?organizationId=${organizationId}&previewRuleId=${rule.id}`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not preview automation impact.");
      setImpactPreview(payload as ImpactPreviewResponse);
      const preview = (payload as ImpactPreviewResponse).preview;
      setNotice(
        `Impact Preview: ${preview.matchedEvents} of ${preview.eventsEvaluated} sampled event(s) would match; ${preview.authoritativePolicyBlocks} authoritative policy block(s).`,
      );
    } catch (error) {
      setImpactPreview(null);
      setNotice(error instanceof Error ? error.message : "Could not preview automation impact.");
    } finally {
      setPreviewingRuleId(null);
    }
  }

  async function publishRule(rule: AutomationRule) {
    const currentPreview = impactPreview
      && impactPreview.draft.ruleId === rule.id
      && impactPreview.draft.version === rule.draftVersion
      ? impactPreview
      : null;
    if (!currentPreview) {
      setNotice("Run Impact Preview for this exact draft before publishing.");
      return;
    }
    if (currentPreview.preview.definitionError || currentPreview.preview.authoritativePolicyBlocks > 0) {
      setNotice("Resolve the authoritative Impact Preview policy blocks before publishing.");
      return;
    }

    try {
      const response = await fetch("/api/automation-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "publish-rule",
          ruleId: rule.id,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload.impactPreview) {
          setImpactPreview({
            draft: currentPreview.draft,
            generatedAt: new Date().toISOString(),
            dataNote: currentPreview.dataNote,
            preview: payload.impactPreview,
          });
        }
        throw new Error(payload.error ?? "Could not publish automation draft.");
      }
      setImpactPreview(null);
      await load();
      setNotice(`${rule.name} published as version ${payload.published?.version ?? ""}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not publish automation draft.");
    }
  }

  async function rollbackRule(rule: AutomationRule, targetVersion: number) {
    if (!window.confirm(`Roll back ${rule.name} to the definition from version ${targetVersion}? This creates a new published version and preserves history.`)) return;
    try {
      const response = await fetch("/api/automation-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "rollback-rule",
          ruleId: rule.id,
          targetVersion,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not roll back automation rule.");
      await load();
      setNotice(`${rule.name} restored from version ${targetVersion} as new published version ${payload.published?.version ?? ""}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not roll back automation rule.");
    }
  }

  async function setRuleActive(rule: AutomationRule, active: boolean) {
    try {
      const response = await fetch("/api/automation-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "set-active",
          ruleId: rule.id,
          active,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not update automation rule.");
      await load();
      setNotice(rule.name + (active ? " enabled." : " disabled."));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update automation rule.");
    }
  }

  if (!data) {
    return (
      <div className="card" style={{ padding: 24 }}>
        {loading ? "Loading Automation Studio…" : "Automation Studio unavailable."}
      </div>
    );
  }

  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">AUTOMATION STUDIO</div>
          <h1>Automation Studio</h1>
          <p>
            Connect authoritative payroll, workforce, HCM, access and integration events without letting automation bypass approval, payroll or security controls.
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </button>
          <button className="primary-button" onClick={() => setShowBuilder((value) => !value)}>
            <Plus size={15} /> Workflow
          </button>
        </div>
      </div>

      <section className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="stat-card">
          <div className="stat-icon purple"><Workflow size={19} /></div>
          <p>ACTIVE RULES</p>
          <h3>{data.analytics.activeRules}</h3>
          <span>{data.rules.length} configured</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon blue"><Activity size={19} /></div>
          <p>RECENT RUNS</p>
          <h3>{data.analytics.recentExecutions}</h3>
          <span>Last 100 execution records</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon green"><CheckCircle2 size={19} /></div>
          <p>SUCCESS RATE</p>
          <h3>{data.analytics.successRate}%</h3>
          <span>{data.analytics.completed} fully completed</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon amber"><CircleAlert size={19} /></div>
          <p>PAUSED / ATTENTION</p>
          <h3>{data.analytics.waiting}</h3>
          <span>{data.analytics.failed} failed · {data.analytics.partial} partial</span>
        </article>
      </section>

      <article className="card" style={{ marginTop: 16, padding: 18 }}>
        <div className="notice notice-slate" style={{ margin: 0 }}>
          <ShieldCheck size={16} className="i-purple" />
          <span>
            <strong>Governed execution.</strong> Workflow edits are saved as drafts and do not affect production until separately published. Published versions remain auditable and rollback creates a new version instead of rewriting history. Studio runs after authoritative transactions commit. Timed waits persist across worker restarts and approval gates pause the exact execution. Payroll adjustments become approval requests, access removal is separation-only, and external calls use registered signed webhooks rather than arbitrary URLs.
          </span>
        </div>
      </article>

      <section className="card" style={{ marginTop: 16 }} data-automation-language-studio>
        <div className="card-header">
          <div>
            <div className="card-kicker">NATURAL-LANGUAGE DRAFTING</div>
            <h2>Describe an automation in plain English</h2>
            <p>Request → typed draft → validation → save inactive draft → Impact Preview → human approval/publish. Language cannot execute or publish workflows.</p>
          </div>
          <Bot size={18} className="i-purple" />
        </div>
        <div className="card-body">
          <label style={{ display: "block", marginBottom: 12 }}>
            What should happen?
            <textarea
              value={languageRequest}
              onChange={(event) => { setLanguageRequest(event.target.value); setLanguageProposal(null); }}
              rows={3}
              maxLength={2000}
              style={{ display: "block", width: "100%", marginTop: 6 }}
              placeholder="When a new employee is hired, create an onboarding checklist and send them a welcome email."
            />
          </label>
          <div className="run-actions">
            <button type="button" className="secondary-button"
              disabled={draftingLanguage || languageRequest.trim().length < 12}
              onClick={() => void generateLanguageProposal()}>
              <Bot size={14} /> {draftingLanguage ? "Drafting…" : "Generate typed draft"}
            </button>
          </div>
          {languageProposal && (
            <div style={{ marginTop: 18 }} data-language-typed-draft>
              <div className="notice notice-amber">
                <ShieldCheck size={16} />
                <span><strong>Unpublished, inactive proposal.</strong> {languageProposal.sourceNote}</span>
              </div>
              <h3 style={{ marginTop: 14 }}>{languageProposal.draft.name}</h3>
              <div className="modal-note" style={{ marginBottom: 10 }}>
                WHEN <strong>{languageProposal.draft.trigger}</strong> · IF {languageProposal.draft.conditions.all.length + languageProposal.draft.conditions.any.length} conditions · THEN {languageProposal.draft.actions.length} actions.
              </div>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 360, overflowY: "auto", padding: 14, fontSize: 12, background: "var(--surface, #f8fafc)", borderRadius: 8 }}>
                {JSON.stringify(languageProposal.draft, null, 2)}
              </pre>
              {languageProposal.validation.warnings.map((warning) => (
                <div className="modal-note" key={warning} style={{ marginTop: 8 }}>{warning}</div>
              ))}
              <div className="run-actions" style={{ marginTop: 14 }}>
                <button type="button" className="secondary-button" onClick={() => setLanguageProposal(null)}>Discard proposal</button>
                <button type="button" className="primary-button"
                  disabled={!languageProposal.validation.valid || savingLanguage}
                  onClick={() => void saveLanguageProposal()}>
                  <Plus size={14} /> {savingLanguage ? "Saving…" : "Save inactive draft"}
                </button>
              </div>
              <p className="modal-note">After saving, find this workflow under Configured automations. Run Impact Preview for its exact draft version and review the results before selecting Publish. Saving is not approval.</p>
            </div>
          )}
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">WORKFLOW TEMPLATES</div>
            <h2>Start from a governed workflow pattern</h2>
            <p>Templates are code-reviewed starter definitions. Using one creates an unpublished draft; it cannot execute until an administrator separately publishes it.</p>
          </div>
          <Workflow size={17} className="i-purple" />
        </div>
        <div className="card-body">
          <div className="module-grid two">
            {data.catalogs.templates.map((template) => {
              const triggerInfo = data.catalogs.triggers.find((item) => item.value === template.trigger);
              return (
                <article className="card" key={template.id} style={{ boxShadow: "none", padding: 14 }}>
                  <div className="card-kicker">{template.category} · TEMPLATE V{template.version}</div>
                  <h3 style={{ margin: "6px 0" }}>{template.name}</h3>
                  <p style={{ margin: "0 0 10px" }}>{template.description}</p>
                  <div className="modal-note" style={{ marginBottom: 10 }}>
                    WHEN {triggerInfo?.label ?? template.trigger} · {template.conditionCount} IF · {template.actionCount} THEN
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={saving}
                    onClick={() => void instantiateTemplate(template)}
                  >
                    <Plus size={14} /> Create draft
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <ApprovalChainAdmin organizationId={organizationId} setNotice={setNotice} onChanged={load} />
      <SlackConnectorAdmin organizationId={organizationId} setNotice={setNotice} onChanged={load} />

      <DynamicWorkerGroupsPanel organizationId={organizationId} setNotice={setNotice} />

      {showBuilder && (
        <form onSubmit={saveRule} className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">WORKFLOW BUILDER</div>
              <h2>Configure one deterministic automation</h2>
              <p>Steps execute from top to bottom. Waits resume from the scheduler, approval gates pause until a decision, and branches evaluate the original event context.</p>
            </div>
          </div>

          <div className="card-body">
            <label style={{ display: "block", marginBottom: 16 }}>
              Workflow name
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Finance new-hire onboarding"
                style={{ width: "100%", marginTop: 6 }}
              />
            </label>

            <div className="module-grid" style={{ gridTemplateColumns: "1fr", gap: 12 }}>
              <section className="card" style={{ boxShadow: "none", borderLeft: "4px solid var(--brand)" }}>
                <div className="card-header">
                  <div>
                    <div className="card-kicker">WHEN</div>
                    <h2 style={{ fontSize: 15 }}>Authoritative event</h2>
                  </div>
                  <Zap size={17} className="i-purple" />
                </div>
                <div className="card-body">
                  <select
                    value={trigger}
                    onChange={(event) => {
                      setTrigger(event.target.value);
                      const nextTrigger = data.catalogs.triggers.find((item) => item.value === event.target.value);
                      setActions((rows) => rows.map((row) => {
                        if (!actionAllowed(nextTrigger, row.type)) return { ...row, type: "request_approval" };
                        if (row.type === "prepare_operational_review") {
                          return {
                            ...row,
                            caseType: OPERATIONAL_REVIEW_BY_TRIGGER[event.target.value] ?? "",
                          };
                        }
                        if (row.type === "generate_document") {
                          const template = data.catalogs.documentTemplates.find((item) => item.id === row.documentTemplateId);
                          if (template && !template.allowedTriggers.includes(event.target.value)) {
                            return { ...row, documentTemplateId: "" };
                          }
                        }
                        return row;
                      }));
                    }}
                    style={{ width: "100%" }}
                  >
                    {data.catalogs.triggers.map((item) => (
                      <option key={item.value} value={item.value} disabled={!item.live}>
                        {item.category} · {item.label}{item.live ? "" : " · planned"}
                      </option>
                    ))}
                  </select>
                  <div className="modal-note" style={{ marginTop: 8 }}>
                    {selectedTrigger?.live
                      ? "Live adapter: this event is emitted by the governed source transaction."
                      : "Planned adapter: visible on the Studio roadmap but not selectable until the authoritative event source is connected."}
                  </div>
                </div>
              </section>

              <section className="card" style={{ boxShadow: "none", borderLeft: "4px solid var(--amber, #D99C28)" }}>
                <div className="card-header">
                  <div>
                    <div className="card-kicker">IF</div>
                    <h2 style={{ fontSize: 15 }}>Data conditions</h2>
                  </div>
                  <button type="button" className="secondary-button" onClick={addCondition}>
                    <Plus size={14} /> Condition
                  </button>
                </div>
                <div className="card-body">
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 12 }}>Match</span>
                    <select value={matchMode} onChange={(event) => setMatchMode(event.target.value as "all" | "any")}>
                      <option value="all">ALL conditions</option>
                      <option value="any">ANY condition</option>
                    </select>
                  </div>
                  {conditions.length === 0 && (
                    <div className="empty-state">No IF filter. Every matching WHEN event can run this workflow.</div>
                  )}
                  {conditions.map((row) => {
                    const field = data.catalogs.conditions.find((item) => item.value === row.field);
                    const operators = row.field === "dynamicGroupCodes"
                      ? data.catalogs.operators.filter((operator) => ["eq", "neq", "in", "exists"].includes(operator))
                      : data.catalogs.operators;
                    return (
                      <div key={row.id} style={{ display: "grid", gridTemplateColumns: "1.3fr .8fr 1fr auto", gap: 8, marginBottom: 8 }}>
                        <select
                          value={row.field}
                          onChange={(event) => updateCondition(row.id, {
                            field: event.target.value,
                            operator: event.target.value === "dynamicGroupCodes" ? "eq" : row.operator,
                            value: "",
                          })}
                        >
                          {data.catalogs.conditions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </select>
                        <select value={row.operator} onChange={(event) => updateCondition(row.id, { operator: event.target.value, value: "" })}>
                          {operators.map((operator) => <option key={operator} value={operator}>{operator}</option>)}
                        </select>
                        {row.operator === "exists" ? (
                          <select value={row.value || "true"} onChange={(event) => updateCondition(row.id, { value: event.target.value })}>
                            <option value="true">exists</option>
                            <option value="false">does not exist</option>
                          </select>
                        ) : row.field === "dynamicGroupCodes" && row.operator !== "in" ? (
                          <select required value={row.value} onChange={(event) => updateCondition(row.id, { value: event.target.value })}>
                            <option value="">Select a live group</option>
                            {data.dynamicGroups.map((group) => (
                              <option key={group.id} value={group.code}>{group.name} · {group.code} · v{group.version}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            required
                            type={field?.kind === "number" && row.operator !== "in" ? "number" : "text"}
                            value={row.value}
                            onChange={(event) => updateCondition(row.id, { value: event.target.value })}
                            placeholder={row.field === "dynamicGroupCodes" ? "Comma-separated live group codes" : row.operator === "in" ? "Comma-separated values" : field?.kind === "number" ? "0" : "Value"}
                          />
                        )}
                        <button type="button" className="icon-button" onClick={() => setConditions((rows) => rows.filter((item) => item.id !== row.id))}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="card" style={{ boxShadow: "none", borderLeft: "4px solid var(--green, #2E9B74)" }}>
                <div className="card-header">
                  <div>
                    <div className="card-kicker">THEN</div>
                    <h2 style={{ fontSize: 15 }}>Governed actions</h2>
                  </div>
                  <button type="button" className="secondary-button" onClick={addAction}>
                    <Plus size={14} /> Action
                  </button>
                </div>
                <div className="card-body">
                  {actions.map((row, index) => (
                    <div key={row.id} className="card" style={{ boxShadow: "none", padding: 12, marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 10 }}>
                        <strong style={{ fontSize: 12 }}>THEN {index + 1}</strong>
                        {actions.length > 1 && (
                          <button type="button" className="icon-button" onClick={() => setActions((items) => items.filter((item) => item.id !== row.id))}>
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                      <select
                        value={row.type}
                        onChange={(event) => {
                          const nextType = event.target.value;
                          updateAction(row.id, {
                            type: nextType,
                            ...(nextType === "prepare_operational_review"
                              ? {
                                  caseType: OPERATIONAL_REVIEW_BY_TRIGGER[selectedTrigger?.value ?? ""] ?? "",
                                  reason: "Review the authoritative source in its governed workspace before any manual change.",
                                }
                              : {}),
                            ...(nextType === "assign_schedule"
                              ? {
                                  scheduleEffectiveDateSource:
                                    selectedTrigger?.value === "employee.hired"
                                      ? "employee_start_date"
                                      : "event_effective_date",
                                }
                              : {}),
                            ...(nextType === "generate_document"
                              ? {
                                  documentTemplateId:
                                    data.catalogs.documentTemplates.find((template) =>
                                      template.allowedTriggers.includes(selectedTrigger?.value ?? "")
                                    )?.id ?? "",
                                }
                              : {}),
                          });
                        }}
                        style={{ width: "100%", marginBottom: 10 }}
                      >
                        {data.catalogs.actions.map((item) => (
                          <option
                            key={item.value}
                            value={item.value}
                            disabled={!actionAllowed(selectedTrigger, item.value)}
                          >
                            {item.category} · {item.label}
                          </option>
                        ))}
                      </select>

                      {row.type === "wait" && (
                        <div className="setting-form">
                          <label>Wait amount<input required type="number" min="1" value={row.waitAmount} onChange={(event) => updateAction(row.id, { waitAmount: event.target.value })} /></label>
                          <label>Unit<select value={row.waitUnit} onChange={(event) => updateAction(row.id, { waitUnit: event.target.value })}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option></select></label>
                          <div className="modal-note">The execution is persisted and resumed by the scheduler. Maximum delay is 30 days.</div>
                        </div>
                      )}

                      {row.type === "approval_gate" && (
                        <div className="setting-form">
                          <label>Approval title<input required value={row.title} onChange={(event) => updateAction(row.id, { title: event.target.value })} /></label>
                          <label>Approver<input value={row.approver} onChange={(event) => updateAction(row.id, { approver: event.target.value })} placeholder="manager or named approver" /></label>
                          <label>Approval chain<select value={row.approvalChainCode} onChange={(event) => updateAction(row.id, { approvalChainCode: event.target.value })}><option value="">Single approver</option>{data.approvalChains.map((chain) => <option key={chain.id} value={chain.code}>{chain.name} · v{chain.version}</option>)}</select></label>
                          <label>Detail<input required value={row.detail} onChange={(event) => updateAction(row.id, { detail: event.target.value })} /></label>
                          <label>Priority<select value={row.priority} onChange={(event) => updateAction(row.id, { priority: event.target.value })}><option>Normal</option><option>High</option></select></label>
                          <div className="modal-note">This is a true gate: later workflow steps do not execute until the task is approved. A decline ends the execution as failed evidence.</div>
                        </div>
                      )}

                      {row.type === "branch" && (() => {
                        const branchField = data.catalogs.conditions.find((item) => item.value === row.branchField);
                        return (
                          <div className="setting-form">
                            <label>Branch field<select value={row.branchField} onChange={(event) => updateAction(row.id, { branchField: event.target.value, branchValue: "" })}>{data.catalogs.conditions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                            <label>Operator<select value={row.branchOperator} onChange={(event) => updateAction(row.id, { branchOperator: event.target.value })}>{data.catalogs.operators.map((operator) => <option key={operator} value={operator}>{operator}</option>)}</select></label>
                            {row.branchOperator === "exists" ? (
                              <label>Value<select value={row.branchValue || "true"} onChange={(event) => updateAction(row.id, { branchValue: event.target.value })}><option value="true">exists</option><option value="false">does not exist</option></select></label>
                            ) : (
                              <label>Value<input required type={branchField?.kind === "number" && row.branchOperator !== "in" ? "number" : "text"} value={row.branchValue} onChange={(event) => updateAction(row.id, { branchValue: event.target.value })} placeholder={row.branchOperator === "in" ? "Comma-separated values" : "Value"} /></label>
                            )}
                            <label>TRUE branch task<input required value={row.branchThenTitle} onChange={(event) => updateAction(row.id, { branchThenTitle: event.target.value })} placeholder="Create task when condition matches" /></label>
                            <label>ELSE branch task<input value={row.branchElseTitle} onChange={(event) => updateAction(row.id, { branchElseTitle: event.target.value })} placeholder="Optional fallback task" /></label>
                            <label>Task owner<input value={row.owner} onChange={(event) => updateAction(row.id, { owner: event.target.value })} /></label>
                            <div className="modal-note">The engine supports nested branch step arrays; this first builder surface creates a governed task on the TRUE branch and an optional task on ELSE.</div>
                          </div>
                        );
                      })()}

                      {row.type === "create_task" && (
                        <div className="setting-form">
                          <label>Task<input required value={row.title} onChange={(event) => updateAction(row.id, { title: event.target.value })} /></label>
                          <label>Owner<input value={row.owner} onChange={(event) => updateAction(row.id, { owner: event.target.value })} /></label>
                        </div>
                      )}

                      {row.type === "create_onboarding_checklist" && (
                        <div className="setting-form">
                          <label>Checklist items, one per line<textarea required value={row.checklist} onChange={(event) => updateAction(row.id, { checklist: event.target.value })} rows={5} /></label>
                          <label>Owner<input value={row.owner} onChange={(event) => updateAction(row.id, { owner: event.target.value })} /></label>
                        </div>
                      )}

                      {row.type === "request_approval" && (
                        <div className="setting-form">
                          <label>Approval title<input required value={row.title} onChange={(event) => updateAction(row.id, { title: event.target.value })} /></label>
                          <label>Approver<input value={row.approver} onChange={(event) => updateAction(row.id, { approver: event.target.value })} placeholder="manager or named approver" /></label>
                          <label>Approval chain<select value={row.approvalChainCode} onChange={(event) => updateAction(row.id, { approvalChainCode: event.target.value })}><option value="">Single approver</option>{data.approvalChains.map((chain) => <option key={chain.id} value={chain.code}>{chain.name} · v{chain.version}</option>)}</select></label>
                          <label>Detail<input required value={row.detail} onChange={(event) => updateAction(row.id, { detail: event.target.value })} /></label>
                          <label>Priority<select value={row.priority} onChange={(event) => updateAction(row.id, { priority: event.target.value })}><option>Normal</option><option>High</option></select></label>
                        </div>
                      )}

                      {row.type === "send_email" && (
                        <div className="setting-form">
                          <label>Recipient<select value={row.recipient} onChange={(event) => updateAction(row.id, { recipient: event.target.value })}><option value="employee">Employee</option><option value="manager">Manager</option><option value="custom">Custom email</option></select></label>
                          {row.recipient === "custom" && <label>Email<input required type="email" value={row.email} onChange={(event) => updateAction(row.id, { email: event.target.value })} /></label>}
                          <label>Subject<input required value={row.subject} onChange={(event) => updateAction(row.id, { subject: event.target.value })} /></label>
                          <label>Message<textarea required value={row.body} onChange={(event) => updateAction(row.id, { body: event.target.value })} rows={4} /></label>
                        </div>
                      )}

                      {row.type === "generate_document" && (
                        <div className="setting-form">
                          <label>Document template
                            <select
                              required
                              value={row.documentTemplateId}
                              onChange={(event) => updateAction(row.id, { documentTemplateId: event.target.value })}
                            >
                              <option value="">Choose approved document template</option>
                              {data.catalogs.documentTemplates
                                .filter((template) => template.allowedTriggers.includes(selectedTrigger?.value ?? ""))
                                .map((template) => (
                                  <option key={template.id} value={template.id}>
                                    {template.name} · v{template.version}
                                  </option>
                                ))}
                            </select>
                          </label>
                          {row.documentTemplateId && (() => {
                            const template = data.catalogs.documentTemplates.find((item) => item.id === row.documentTemplateId);
                            return template ? <div className="modal-note">{template.description}</div> : null;
                          })()}
                          <div className="modal-note">
                            This action must immediately follow an approval gate. PayrollPH generates an immutable employee-scoped text artifact from a server-owned template; the generated record does not replace signed contracts, statutory notices, legal advice, or employee acknowledgement.
                          </div>
                        </div>
                      )}

                      {row.type === "assign_schedule" && (
                        <div className="setting-form">
                          <label>Schedule pattern
                            <select
                              required
                              value={row.schedulePatternId}
                              onChange={(event) => updateAction(row.id, { schedulePatternId: event.target.value })}
                            >
                              <option value="">Choose active schedule pattern</option>
                              {data.schedulePatterns.map((pattern) => (
                                <option key={pattern.id} value={pattern.id}>
                                  {pattern.code} · {pattern.name} · {pattern.cycleDays}-day cycle
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>Effective date source
                            <select
                              value={row.scheduleEffectiveDateSource}
                              onChange={(event) => updateAction(row.id, { scheduleEffectiveDateSource: event.target.value })}
                            >
                              <option value="event_effective_date">Trigger event effective date</option>
                              <option value="employee_start_date">Employee start date</option>
                              <option value="today">Current Philippine business date</option>
                            </select>
                          </label>
                          <label>Days after source date
                            <input
                              required
                              type="number"
                              min="0"
                              max="365"
                              value={row.scheduleOffsetDays}
                              onChange={(event) => updateAction(row.id, { scheduleOffsetDays: event.target.value })}
                            />
                          </label>
                          <label>Assignment reason
                            <input
                              required
                              value={row.scheduleReason}
                              onChange={(event) => updateAction(row.id, { scheduleReason: event.target.value })}
                            />
                          </label>
                          <div className="modal-note">
                            This action must immediately follow an approval gate. It will not replace an existing effective schedule, will not backdate a schedule, and still runs WFM schedule guardrails before assignment.
                          </div>
                        </div>
                      )}

                      {row.type === "assign_permission_set" && (
                        <label>Access policy
                          <select required value={row.permissionSetId} onChange={(event) => updateAction(row.id, { permissionSetId: event.target.value })} style={{ width: "100%", marginTop: 6 }}>
                            <option value="">Choose permission set</option>
                            {data.permissionSets.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                          </select>
                        </label>
                      )}

                      {row.type === "assign_benefit" && (
                        <div className="setting-form">
                          <label>Benefit plan<select required value={row.planId} onChange={(event) => updateAction(row.id, { planId: event.target.value })}><option value="">Choose plan</option>{data.benefitPlans.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.category}</option>)}</select></label>
                          <label>Employee monthly contribution<input type="number" min="0" step="0.01" value={row.monthlyContribution} onChange={(event) => updateAction(row.id, { monthlyContribution: event.target.value })} placeholder="Use plan default" /></label>
                        </div>
                      )}

                      {row.type === "prepare_operational_review" && (
                        <div className="setting-form">
                          <label>Source-bound review type
                            <select
                              required
                              value={row.caseType}
                              onChange={(event) => updateAction(row.id, { caseType: event.target.value })}
                            >
                              {Object.entries(OPERATIONAL_REVIEW_BY_TRIGGER)
                                .filter(([eventTrigger]) => eventTrigger === selectedTrigger?.value)
                                .map(([eventTrigger, caseType]) => (
                                  <option key={eventTrigger} value={caseType}>
                                    {caseType.replaceAll("_", " ")}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label>Manual review instructions
                            <textarea
                              required
                              minLength={8}
                              maxLength={240}
                              rows={3}
                              value={row.reason}
                              onChange={(event) => updateAction(row.id, { reason: event.target.value })}
                            />
                          </label>
                          <div className="modal-note">
                            Creates at most one review case per authoritative source. It never publishes rosters,
                            approves timesheets, blocks or clears payroll release, posts remittances, or transfers money.
                            The normal WFM, Payroll and Compliance approval controls remain authoritative.
                          </div>
                        </div>
                      )}

                      {row.type === "request_payroll_adjustment" && (
                        <div className="setting-form">
                          <label>Requested amount<input required type="number" step="0.01" value={row.amount} onChange={(event) => updateAction(row.id, { amount: event.target.value })} /></label>
                          <label>Approver<input value={row.approver || "Payroll"} onChange={(event) => updateAction(row.id, { approver: event.target.value })} /></label>
                          <label>Approval chain<select value={row.approvalChainCode} onChange={(event) => updateAction(row.id, { approvalChainCode: event.target.value })}><option value="">Single approver</option>{data.approvalChains.map((chain) => <option key={chain.id} value={chain.code}>{chain.name} · v{chain.version}</option>)}</select></label>
                          <label>Reason<input required value={row.reason} onChange={(event) => updateAction(row.id, { reason: event.target.value })} /></label>
                          <div className="modal-note">This creates a high-priority approval request. If a chain is selected, the absolute PHP adjustment amount determines which configured approval tiers are required. Automation never posts money directly to payroll.</div>
                        </div>
                      )}

                      {row.type === "send_slack_message" && (() => {
                        const connector = data.integrationConnectors.find((item) => String(item.id) === row.slackConnectorId);
                        const channels = connector?.config.allowedChannelIds ?? [];
                        return (
                          <div className="setting-form">
                            <label>Slack connector
                              <select
                                required
                                value={row.slackConnectorId}
                                onChange={(event) => {
                                  const nextConnector = data.integrationConnectors.find((item) => String(item.id) === event.target.value);
                                  updateAction(row.id, {
                                    slackConnectorId: event.target.value,
                                    slackChannelId: nextConnector?.config.defaultChannelId ?? "",
                                  });
                                }}
                              >
                                <option value="">Choose active Slack connector</option>
                                {data.integrationConnectors.filter((item) => item.active && item.provider === "slack").map((item) => (
                                  <option key={item.id} value={item.id}>{item.name}</option>
                                ))}
                              </select>
                            </label>
                            <label>Channel ID
                              <select required value={row.slackChannelId} onChange={(event) => updateAction(row.id, { slackChannelId: event.target.value })}>
                                <option value="">Choose allow-listed channel</option>
                                {channels.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
                              </select>
                            </label>
                            <label>Message
                              <textarea
                                required
                                rows={4}
                                maxLength={4000}
                                value={row.slackMessage}
                                onChange={(event) => updateAction(row.id, { slackMessage: event.target.value })}
                                placeholder="Payroll review is ready."
                              />
                            </label>
                            <div className="modal-note">Uses the verified Slack Bot API connector and only an allow-listed channel ID. Automation Studio never accepts an arbitrary Slack or webhook URL for this action.</div>
                          </div>
                        );
                      })()}

                      {row.type === "webhook" && (
                        <div className="modal-note">Calls only registered signed webhook endpoints subscribed to <code>automation.triggered</code>. Arbitrary URLs are not accepted.</div>
                      )}
                      {row.type === "revoke_sessions" && <div className="modal-note">Separation-only: revokes active login sessions for linked employee users.</div>}
                      {row.type === "deactivate_access" && <div className="modal-note">Separation-only: deactivates this workspace membership and SCIM identity, then revokes sessions. It does not disable a shared user globally.</div>}
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="run-actions" style={{ marginTop: 16 }}>
              <button type="button" className="secondary-button" onClick={() => { resetBuilder(); setShowBuilder(false); }}>Cancel</button>
              <button className="primary-button" disabled={saving || !name.trim() || !selectedTrigger?.live}>
                <Play size={14} /> {saving ? "Saving…" : "Save draft"}
              </button>
            </div>
          </div>
        </form>
      )}

      {impactPreview && (
        <article className="card" style={{ marginTop: 16 }} data-automation-impact-preview>
          <div className="card-header">
            <div>
              <div className="card-kicker">IMPACT PREVIEW · DRAFT V{impactPreview.draft.version}</div>
              <h2>{impactPreview.draft.name}</h2>
              <p>
                Zero-write replay against up to 200 recent ledger events. Conditions and branches are evaluated exactly,
                but tasks, approvals, payroll requests, schedules, messages, documents, access changes and webhooks are not executed.
              </p>
            </div>
            <span className={
              impactPreview.preview.definitionError || impactPreview.preview.authoritativePolicyBlocks > 0
                ? "status status-failed"
                : "status status-verified"
            }>
              {impactPreview.preview.definitionError || impactPreview.preview.authoritativePolicyBlocks > 0
                ? "Blocked"
                : "Safe to publish"}
            </span>
          </div>

          <section className="stats-grid" style={{ padding: "0 18px 18px", gridTemplateColumns: "repeat(4, 1fr)" }}>
            <article className="stat-card">
              <div className="stat-icon blue"><Activity size={18} /></div>
              <p>EVENTS EVALUATED</p>
              <h3>{impactPreview.preview.eventsEvaluated}</h3>
              <span>{impactPreview.preview.authoritativeEvents} authoritative · {impactPreview.preview.legacyBackfillEvents} legacy</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon green"><CheckCircle2 size={18} /></div>
              <p>WOULD MATCH</p>
              <h3>{impactPreview.preview.matchedEvents}</h3>
              <span>{impactPreview.preview.skippedEvents} would skip</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon purple"><Workflow size={18} /></div>
              <p>PROJECTED STEPS</p>
              <h3>{impactPreview.preview.projectedSteps}</h3>
              <span>{impactPreview.preview.approvalSteps} approval · {impactPreview.preview.waitSteps} wait</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon amber"><ShieldCheck size={18} /></div>
              <p>POLICY BLOCKS</p>
              <h3>{impactPreview.preview.authoritativePolicyBlocks}</h3>
              <span>{impactPreview.preview.legacyPolicyBlocks} legacy-only signal(s)</span>
            </article>
          </section>

          <div className={
            impactPreview.preview.definitionError || impactPreview.preview.authoritativePolicyBlocks > 0
              ? "notice notice-red"
              : impactPreview.preview.authoritativeEvents === 0
                ? "notice notice-amber"
                : "notice notice-slate"
          } style={{ margin: "0 18px 18px" }}>
            <ShieldCheck size={16} />
            <span>
              {impactPreview.preview.definitionError
                ? <><strong>Definition blocked.</strong> {impactPreview.preview.definitionError}</>
                : impactPreview.preview.authoritativePolicyBlocks > 0
                  ? <><strong>Publish blocked.</strong> Resolve {impactPreview.preview.authoritativePolicyBlocks} policy block(s) found on authoritative events.</>
                  : impactPreview.preview.authoritativeEvents === 0
                    ? <><strong>Limited evidence.</strong> No post-ledger authoritative event exists for this trigger yet. Legacy history is informative but does not block publication.</>
                    : <><strong>Safe dry run.</strong> No authoritative sampled event would hit a known Automation Studio policy block.</>}
            </span>
          </div>

          <div className="card-body" style={{ paddingTop: 0 }}>
            <div className="module-grid two" style={{ marginBottom: 14 }}>
              <div className="modal-note">
                <strong>Projected action mix</strong><br />
                {Object.entries(impactPreview.preview.actionCounts).length
                  ? Object.entries(impactPreview.preview.actionCounts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([type, count]) => `${type.replaceAll("_", " ")} × ${count}`)
                      .join(" · ")
                  : "No actions would run for the sampled events."}
              </div>
              <div className="modal-note">
                <strong>Payroll adjustment exposure</strong><br />
                {formatPeso(impactPreview.preview.projectedPayrollAdjustmentAbsoluteAmount)} absolute requested amount
                {impactPreview.preview.projectedPayrollAdjustmentAbsoluteAmount > 0
                  ? ` · signed net ${formatPeso(impactPreview.preview.projectedPayrollAdjustmentAmount)}`
                  : ""}
              </div>
            </div>
            <div className="modal-note" style={{ marginBottom: 14 }}>
              {impactPreview.dataNote} · Generated {formatDateTime(impactPreview.generatedAt)}
            </div>

            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>EVENT</th><th>RESULT</th><th>PROJECTED FLOW</th><th>POLICY</th></tr>
                </thead>
                <tbody>
                  {impactPreview.preview.samples.length === 0 && (
                    <tr><td colSpan={4}><div className="empty-state">No recorded events for this trigger yet.</div></td></tr>
                  )}
                  {impactPreview.preview.samples.map((sample) => (
                    <tr key={sample.eventKey + "-" + (sample.occurredAt ?? "")}>
                      <td>
                        <strong>{sample.eventKey}</strong>
                        <small style={{ display: "block", color: "var(--muted)" }}>
                          {sample.employeeId ? `Employee #${sample.employeeId}` : "Organization"} · {sample.source}
                          {sample.occurredAt ? ` · ${formatDateTime(sample.occurredAt)}` : ""}
                        </small>
                      </td>
                      <td>
                        <span className={sample.matched ? "status status-verified" : "status"}>
                          {sample.matched ? "Match" : "Skip"}
                        </span>
                        <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>{sample.reason}</small>
                      </td>
                      <td>{sample.projectedSteps.length ? sample.projectedSteps.join(" → ").replaceAll("_", " ") : "—"}</td>
                      <td>
                        {sample.policyBlocks.length
                          ? sample.policyBlocks.map((block) => <small key={block} style={{ display: "block", color: "var(--danger)" }}>{block}</small>)
                          : <span className="id">No known block</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </article>
      )}

      <section className="module-grid two" style={{ marginTop: 16 }}>
        <article className="card">
          <div className="card-header">
            <div>
              <div className="card-kicker">WORKFLOWS</div>
              <h2>Configured automations</h2>
              <p>Rules are scoped to this workspace and execute only on their exact event.</p>
            </div>
          </div>
          {data.rules.length === 0 && <div className="empty-state">No Automation Studio workflows yet.</div>}
          {data.rules.map((rule) => {
            const triggerInfo = data.catalogs.triggers.find((item) => item.value === rule.trigger);
            const versions = data.versions
              .filter((version) => version.ruleId === rule.id)
              .sort((a, b) => b.version - a.version);
            const rollbackTarget = versions.find((version) =>
              version.status !== "draft" && version.version !== rule.publishedVersion
            ) ?? null;
            const currentPreview = impactPreview
              && impactPreview.draft.ruleId === rule.id
              && impactPreview.draft.version === rule.draftVersion
              ? impactPreview
              : null;
            const previewSafe = Boolean(
              currentPreview
              && !currentPreview.preview.definitionError
              && currentPreview.preview.authoritativePolicyBlocks === 0,
            );
            return (
              <div className="leave-request" key={rule.id}>
                <div className="inline-icon purple"><Workflow size={16} /></div>
                <div style={{ flex: 1 }}>
                  <strong>{rule.name}</strong>
                  <span>
                    {triggerInfo?.label ?? rule.trigger} · {conditionCount(rule.conditions)} IF · {actionCount(rule.actions)} THEN · {rule.publishedVersion > 0 ? (rule.active ? "active" : "disabled") : "not published"}
                    {triggerInfo && !triggerInfo.live ? " · adapter planned" : ""}
                  </span>
                  <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>
                    {rule.publishedVersion > 0 ? `Published v${rule.publishedVersion}` : "No published version"}
                    {rule.draftVersion ? ` · Draft v${rule.draftVersion} waiting to publish` : ""}
                    {rollbackTarget ? ` · Prior v${rollbackTarget.version} available` : ""}
                  </small>
                </div>
                <div className="run-actions" style={{ margin: 0 }}>
                  {rule.draftVersion && (
                    <button
                      className="secondary-button"
                      onClick={() => void previewRule(rule)}
                      disabled={previewingRuleId === rule.id}
                    >
                      <Activity size={14} /> {previewingRuleId === rule.id ? "Previewing…" : "Impact Preview"}
                    </button>
                  )}
                  {rule.draftVersion && (
                    <button
                      className="primary-button"
                      onClick={() => void publishRule(rule)}
                      disabled={!previewSafe}
                      title={previewSafe ? "Publish reviewed draft" : "Run a safe Impact Preview for this draft first"}
                    >
                      Publish v{rule.draftVersion}
                    </button>
                  )}
                  {rollbackTarget && rule.publishedVersion > 0 && (
                    <button className="secondary-button" onClick={() => void rollbackRule(rule, rollbackTarget.version)}>
                      Rollback to v{rollbackTarget.version}
                    </button>
                  )}
                  {rule.publishedVersion > 0 && (
                    <button className="secondary-button" onClick={() => void setRuleActive(rule, !rule.active)}>
                      {rule.active ? "Disable" : "Enable"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </article>

        <article className="card">
          <div className="card-header">
            <div>
              <div className="card-kicker">EVENT COVERAGE</div>
              <h2>Live vs planned adapters</h2>
              <p>The catalog can grow without pretending a scheduled/compliance source is wired before it really is.</p>
            </div>
            <GitBranch size={17} className="i-purple" />
          </div>
          <div className="card-body">
            {data.catalogs.triggers.map((item) => (
              <div className="payslip-line" key={item.value} style={{ gridTemplateColumns: "1fr auto" }}>
                <span>{item.label}<em>{item.category} · {item.value}</em></span>
                <b>{item.live ? "Live" : "Planned"}</b>
              </div>
            ))}
          </div>
        </article>
      </section>

      <article className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">EXECUTION CENTER</div>
            <h2>Failures, retries and replay</h2>
            <p>Retry only the failed step. Stored-snapshot replay is available only when every action is an idempotent state change; unsafe messaging, task, approval, document, webhook and schedule replays stay blocked.</p>
          </div>
          <RefreshCw size={17} className="i-purple" />
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>WORKFLOW</th><th>FAILURE</th><th>AGE / SLA</th><th>CONTROLS</th></tr></thead>
            <tbody>
              {data.executionCenter.attentionQueue.length === 0 && (
                <tr><td colSpan={4}><div className="empty-state">No failed or partial executions need attention.</div></td></tr>
              )}
              {data.executionCenter.attentionQueue.map((item) => {
                const firstRetryable = item.retryableFailedStepIndices[0];
                return (
                  <tr key={item.executionId}>
                    <td>
                      <strong>{ruleById.get(item.ruleId)?.name ?? `Rule #${item.ruleId}`}</strong>
                      <small style={{ display: "block", color: "var(--muted)" }}>Execution #{item.executionId} · {item.status}</small>
                    </td>
                    <td>
                      {item.failedSteps.map((step) => {
                        const letter = item.deadLetters.find((entry) => entry.stepIndex === step.stepIndex);
                        return (
                          <div key={step.stepIndex} style={{ marginBottom: 8 }}>
                            <small style={{ display: "block", color: "var(--danger)", maxWidth: 420 }}>
                              Step {step.stepIndex + 1} · {step.type}: {step.error}
                            </small>
                            {letter?.caseId ? (
                              <small style={{ display: "block", color: "var(--muted)" }}>
                                Dead letter #{letter.caseId} · {letter.status} · evidence in case queue below
                              </small>
                            ) : (
                              <button
                                type="button"
                                className="secondary-button"
                                disabled={mutatingExecutionId === item.executionId}
                                onClick={() => void quarantineExecutionStep(item.executionId, step.stepIndex)}
                                style={{ marginTop: 4 }}
                              >
                                <CircleAlert size={13} /> Quarantine failed step
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </td>
                    <td>
                      <span className={item.slaState === "breached" ? "status status-failed" : "status"}>
                        {item.slaState}
                      </span>
                      <small style={{ display: "block", color: "var(--muted)" }}>{item.ageMinutes} min since update</small>
                    </td>
                    <td>
                      <div className="run-actions">
                        <button
                          className="secondary-button"
                          disabled={firstRetryable == null || mutatingExecutionId === item.executionId}
                          onClick={() => firstRetryable != null && void runExecutionControl("retry-execution-step", item.executionId, firstRetryable)}
                        >
                          <RefreshCw size={13} /> Retry failed step
                        </button>
                        <button
                          className="secondary-button"
                          disabled={!item.replayEligible || mutatingExecutionId === item.executionId}
                          onClick={() => void runExecutionControl("replay-execution", item.executionId)}
                        >
                          <Play size={13} /> Replay snapshot
                        </button>
                      </div>
                      {firstRetryable == null && item.failedSteps.length > 0 && (
                        <small style={{ display: "block", color: "var(--muted)", marginTop: 6 }}>
                          Failed action requires manual side-effect review.
                        </small>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>

      <article className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">OPERATIONS CASES · DEAD LETTERS</div>
            <h2>Manual WFM/payroll recovery queue</h2>
            <p>
              Review cases are attached to live workforce, payroll or compliance source records.
              Dead letters preserve ambiguous failed-step evidence. Case acknowledgements and dispositions
              never change the authoritative source, retry an action, or mark an execution successful.
            </p>
          </div>
          <ShieldCheck size={17} className="i-purple" />
        </div>
        <div className="card-body" style={{ paddingTop: 6 }}>
          <div className="modal-note">
            Open: {data.executionCenter.caseCounts.open} · Acknowledged: {data.executionCenter.caseCounts.acknowledged}
            · Resolved: {data.executionCenter.caseCounts.resolved} · Outstanding dead letters: {data.executionCenter.caseCounts.deadLetters}
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>CASE / SOURCE</th><th>OWNER / EVIDENCE</th><th>STATUS</th><th>HUMAN CONTROL</th></tr></thead>
            <tbody>
              {data.executionCenter.operationalCases.length === 0 && (
                <tr><td colSpan={4}><div className="empty-state">No review cases or dead letters recorded.</div></td></tr>
              )}
              {data.executionCenter.operationalCases.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.title}</strong>
                    <small style={{ display: "block", color: "var(--muted)" }}>
                      Case #{item.id} · {item.caseType.replaceAll("_", " ")} · {item.sourceType} #{item.sourceId}
                      {item.sourceVersion != null ? ` · source v${item.sourceVersion}` : ""}
                    </small>
                    <small style={{ display: "block" }}>{item.detail}</small>
                  </td>
                  <td>
                    <strong>{item.ownerTeam}</strong>
                    <small style={{ display: "block", color: "var(--muted)" }}>
                      Created {formatDateTime(item.createdAt)}
                      {item.executionId != null ? ` · execution #${item.executionId}` : ""}
                    </small>
                    {item.resolutionNote && <small style={{ display: "block" }}>Disposition: {item.resolutionNote}</small>}
                  </td>
                  <td>
                    <span className={item.status === "resolved" ? "status status-verified" : item.status === "open" ? "status status-failed" : "status"}>
                      {item.status}
                    </span>
                    {item.acknowledgedByName && <small style={{ display: "block" }}>Acknowledged by {item.acknowledgedByName}</small>}
                    {item.resolvedByName && <small style={{ display: "block" }}>Resolved by {item.resolvedByName}</small>}
                  </td>
                  <td>
                    {item.status === "open" && (
                      <button type="button" className="secondary-button"
                        disabled={mutatingCaseId === item.id}
                        onClick={() => void triageOperationalCase(item, "acknowledge")}
                      >Acknowledge</button>
                    )}
                    {item.status === "acknowledged" && (
                      <button type="button" className="secondary-button"
                        disabled={mutatingCaseId === item.id}
                        onClick={() => void triageOperationalCase(item, "resolve")}
                      >Record resolution</button>
                    )}
                    {item.status === "resolved" && (
                      <button type="button" className="secondary-button"
                        disabled={mutatingCaseId === item.id}
                        onClick={() => void triageOperationalCase(item, "reopen")}
                      >Reopen</button>
                    )}
                    <small style={{ display: "block", color: "var(--muted)", marginTop: 5 }}>
                      {item.caseType === "execution_dead_letter"
                        ? "Manual disposition does not rewrite the failed execution."
                        : "Underlying issue must be resolved in its governed workspace first."}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">WHY RAN / WHY SKIPPED</div>
            <h2>Event decision diagnostics</h2>
            <p>{data.executionCenter.diagnosticNote}</p>
          </div>
          <Activity size={17} className="i-purple" />
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>EVENT</th><th>WORKFLOW</th><th>OUTCOME</th><th>REASON</th></tr></thead>
            <tbody>
              {data.executionCenter.decisionDiagnostics.length === 0 && (
                <tr><td colSpan={4}><div className="empty-state">No authoritative event diagnostics yet.</div></td></tr>
              )}
              {data.executionCenter.decisionDiagnostics.slice(0, 50).map((item) => (
                <tr key={`${item.eventId}:${item.ruleId}`}>
                  <td><strong>{item.trigger}</strong><small style={{ display: "block", color: "var(--muted)" }}>{item.eventKey}</small></td>
                  <td>{item.ruleName}</td>
                  <td><span className={item.outcome === "ran" ? "status status-verified" : "status"}>{item.outcome}</span></td>
                  <td>{item.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">EXECUTION EVIDENCE</div>
            <h2>Recent Automation Studio runs</h2>
            <p>Every rule/event pair is idempotent. Paused runs preserve their cursor, workflow snapshot and event context so they can resume without starting over.</p>
          </div>
          <Bot size={17} className="i-purple" />
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>WORKFLOW</th><th>EVENT</th><th>EMPLOYEE</th><th>STATUS</th><th>TIME</th></tr></thead>
            <tbody>
              {data.executions.length === 0 && <tr><td colSpan={5}><div className="empty-state">No Automation Studio executions yet.</div></td></tr>}
              {data.executions.map((row) => (
                <tr key={row.id}>
                  <td>{ruleById.get(row.ruleId)?.name ?? `Rule #${row.ruleId}`}</td>
                  <td><strong>{row.trigger}</strong><small style={{ display: "block", color: "var(--muted)" }}>{row.eventKey}</small></td>
                  <td>{row.employeeId ? `#${row.employeeId}` : "Organization"}</td>
                  <td>
                    <span className={row.status === "completed" ? "status status-verified" : row.status === "failed" ? "status status-failed" : "status"}>
                      {row.status}
                    </span>
                    {row.error && <small style={{ display: "block", color: "var(--danger)", maxWidth: 340 }}>{row.error}</small>}
                  </td>
                  <td>
                    {formatDateTime(row.createdAt)}
                    {row.resumeAt && <small style={{ display: "block", color: "var(--muted)" }}>Resumes {formatDateTime(row.resumeAt)}</small>}
                    {row.waitingApprovalTaskId && <small style={{ display: "block", color: "var(--muted)" }}>Approval #{row.waitingApprovalTaskId}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}
