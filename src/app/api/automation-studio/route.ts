import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  automationEventLog,
  automationExecutions,
  automationOperationalCases,
  auditEvents,
  automationRules,
  benefitPlans,
  orgUnits,
  permissionSets,
  schedulePatterns,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, ORG_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { listApprovalChainPolicies } from "@/lib/approval-chains";
import { listSafeIntegrationConnectors } from "@/lib/integration-connectors";
import { listDynamicWorkerGroups } from "@/lib/dynamic-worker-groups";
import {
  createExecutionDeadLetter,
  operationalReviewSourceResolved,
} from "@/lib/automation-operational-cases";
import {
  AUTOMATION_ACTION_CATALOG,
  AUTOMATION_CONDITION_FIELDS,
  AUTOMATION_LIVE_TRIGGERS,
  AUTOMATION_OPERATORS,
  AUTOMATION_PLANNED_TRIGGERS,
  AUTOMATION_TRIGGER_CATALOG,
  AUTOMATION_TRIGGERS,
  automationTriggerIsLive,
  normalizeAutomationActions,
  replayAutomationExecutionSnapshot,
  retryAutomationExecutionFailedStep,
  SAFE_FAILED_STEP_RETRY_ACTIONS,
  simulateAutomationImpact,
  validAutomationConditions,
  validateAutomationActionTrigger,
  type AutomationTrigger,
  type AutomationWorkflowStep,
} from "@/lib/automation";
import { AUTOMATION_DOCUMENT_TEMPLATES } from "@/lib/automation-document-templates";
import { draftAutomationFromLanguage, LanguageDraftError, validateNaturalLanguageDraft } from "@/lib/automation-language-draft";
import { fingerprintLanguageProposal, issueLanguageProposalReceipt, verifyLanguageProposalReceipt } from "@/lib/automation-language-proposal-receipt";
import { fingerprintAutomationDraft, issueAutomationPreviewReceipt, verifyAutomationPreviewReceipt } from "@/lib/automation-preview-approval";
import {
  AUTOMATION_WORKFLOW_TEMPLATES,
  getAutomationWorkflowTemplate,
} from "@/lib/automation-templates";
import {
  AutomationVersionError,
  listAutomationRuleVersions,
  publishAutomationRuleDraft,
  rollbackAutomationRule,
  saveAutomationRuleDraft,
  setAutomationRuleActiveVersioned,
} from "@/lib/automation-versioning";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

function uniqueConstraintViolation(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: string }).code === "23505",
  );
}


function executionResultRows(value: unknown) {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    : [];
}

function latestExecutionSteps(value: unknown) {
  const latest = new Map<number, Record<string, unknown>>();
  for (const row of executionResultRows(value)) {
    const type = String(row.type ?? "");
    if (["wait", "approval_gate", "approval_gate_decision"].includes(type)) continue;
    const stepIndex = Number(row.stepIndex);
    if (!Number.isInteger(stepIndex) || stepIndex < 0) continue;
    latest.set(stepIndex, row);
  }
  return [...latest.entries()].sort(([a], [b]) => a - b).map(([, row]) => row);
}

const SAFE_REPLAY_EXECUTION_ACTIONS = new Set([
  "assign_permission_set",
  "assign_benefit",
  "revoke_sessions",
  "deactivate_access",
]);

async function validateConnectorActions(organizationId: number, actions: AutomationWorkflowStep[]) {
  const connectors = await listSafeIntegrationConnectors(organizationId);
  const byId = new Map(connectors.map((connector) => [connector.id, connector]));

  const walk = (steps: AutomationWorkflowStep[]): string | null => {
    for (const step of steps) {
      if (step.type === "branch") {
        const thenError = walk(step.then);
        if (thenError) return thenError;
        const elseError = walk(step.else);
        if (elseError) return elseError;
        continue;
      }
      if (step.type !== "send_slack_message") continue;
      const connector = byId.get(step.connectorId);
      if (!connector || connector.provider !== "slack" || !connector.active) {
        return "Slack message actions require an active verified Slack connector.";
      }
      const channelId = step.channelId ?? connector.config.defaultChannelId;
      if (!connector.config.allowedChannelIds.includes(channelId)) {
        return "Slack message channel is not allow-listed on the selected connector.";
      }
    }
    return null;
  };

  return walk(actions);
}

async function validateDynamicGroupReferences(
  organizationId: number,
  conditions: unknown,
  actions: AutomationWorkflowStep[],
) {
  const groups = await listDynamicWorkerGroups(organizationId, true);
  const codes = new Set(groups.map((group) => group.code));
  const ids = new Set(groups.map((group) => group.id));

  const checkConditions = (value: unknown): string | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    for (const bucket of ["all", "any"] as const) {
      const clauses = Array.isArray(row[bucket]) ? row[bucket] as Array<Record<string, unknown>> : [];
      for (const clause of clauses) {
        const field = String(clause.field ?? "");
        const operator = String(clause.operator ?? "");
        if (field !== "dynamicGroupCodes" && field !== "dynamicGroupIds") continue;
        if (operator === "contains") {
          return "Dynamic Group workflow conditions require exact eq/neq/in membership, not substring contains.";
        }
        const values = operator === "in"
          ? (Array.isArray(clause.value) ? clause.value : [])
          : [clause.value];
        if (values.length === 0) return "Dynamic Group workflow condition is missing a group reference.";
        if (field === "dynamicGroupCodes") {
          const missing = values.map((value) => String(value ?? "")).filter((value) => !codes.has(value));
          if (missing.length) return `Dynamic Group code is missing or disabled: ${missing.join(", ")}.`;
        } else {
          const missing = values.map(Number).filter((value) => !Number.isInteger(value) || !ids.has(value));
          if (missing.length) return `Dynamic Group ID is missing or disabled: ${missing.join(", ")}.`;
        }
      }
    }
    return null;
  };

  const topError = checkConditions(conditions);
  if (topError) return topError;

  const walk = (steps: AutomationWorkflowStep[]): string | null => {
    for (const step of steps) {
      if (step.type !== "branch") continue;
      const branchError = checkConditions(step.conditions);
      if (branchError) return branchError;
      const thenError = walk(step.then);
      if (thenError) return thenError;
      const elseError = walk(step.else);
      if (elseError) return elseError;
    }
    return null;
  };
  return walk(actions);
}

async function assertStudioAdmin(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    ORG_ADMIN_ROLES,
    "Only company-wide administrators can manage Automation Studio.",
  );
  if (denied) return { denied, access: null };
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return {
      denied: Response.json(
        { error: "Automation Studio requires company-wide access." },
        { status: 403 },
      ),
      access: null,
    };
  }
  return { denied: null, access };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const guard = await assertStudioAdmin(user.id, organizationId);
  if (guard.denied) return guard.denied;

  const previewRuleId = Number(new URL(request.url).searchParams.get("previewRuleId"));
  if (Number.isInteger(previewRuleId) && previewRuleId > 0) {
    const versions = await listAutomationRuleVersions(organizationId);
    const draft = versions.find((version) =>
      version.ruleId === previewRuleId && version.status === "draft"
    );
    if (!draft) {
      return Response.json({ error: "This workflow has no saved draft to preview." }, { status: 404 });
    }
    const trigger = draft.trigger as AutomationTrigger;
    const actions = normalizeAutomationActions(draft.actions);
    if (
      !(AUTOMATION_TRIGGERS as readonly string[]).includes(trigger)
      || !validAutomationConditions(draft.conditions)
      || !actions
    ) {
      return Response.json({ error: "The saved draft definition is invalid and cannot be previewed." }, { status: 409 });
    }
    const connectorError = await validateConnectorActions(organizationId, actions);
    if (connectorError) {
      return Response.json({ error: connectorError }, { status: 409 });
    }
    const groupError = await validateDynamicGroupReferences(organizationId, draft.conditions, actions);
    if (groupError) {
      return Response.json({ error: groupError }, { status: 409 });
    }

    const eventRows = await db.select().from(automationEventLog).where(and(
      eq(automationEventLog.organizationId, organizationId),
      eq(automationEventLog.trigger, trigger),
    )).orderBy(desc(automationEventLog.occurredAt), desc(automationEventLog.id)).limit(200);

    const preview = simulateAutomationImpact({
      trigger,
      conditions: draft.conditions,
      actions,
      events: eventRows.map((row) => ({
        employeeId: row.employeeId,
        eventKey: row.eventKey,
        source: row.source,
        context: row.context && typeof row.context === "object" && !Array.isArray(row.context)
          ? row.context as Record<string, unknown>
          : {},
        occurredAt: row.occurredAt,
      })),
    });

    const previewReceipt = issueAutomationPreviewReceipt({
      organizationId,
      actorUserId: user.id,
      sessionId: user.sessionId,
      sessionToken: user.sessionToken,
      ruleId: draft.ruleId,
      draftVersion: draft.version,
      draftHash: fingerprintAutomationDraft(draft),
    });

    return Response.json({
      preview,
      previewReceipt,
      draft: {
        ruleId: draft.ruleId,
        version: draft.version,
        name: draft.name,
        trigger,
      },
      generatedAt: new Date().toISOString(),
      dataNote: preview.legacyBackfillEvents > 0
        ? "Legacy backfill contains only events that previously produced executions. New authoritative events are captured before rule matching."
        : "All sampled ledger events were captured before rule matching.",
    });
  }

  const [rules, versions, executions, cases, units, sets, plans, patterns, approvalChains, integrationConnectors, dynamicGroups, eventRows] = await Promise.all([
    db.select().from(automationRules)
      .where(eq(automationRules.organizationId, organizationId))
      .orderBy(desc(automationRules.id)),
    listAutomationRuleVersions(organizationId),
    db.select().from(automationExecutions)
      .where(eq(automationExecutions.organizationId, organizationId))
      .orderBy(desc(automationExecutions.id))
      .limit(100),
    db.select().from(automationOperationalCases)
      .where(eq(automationOperationalCases.organizationId, organizationId))
      .orderBy(desc(automationOperationalCases.updatedAt), desc(automationOperationalCases.id))
      .limit(150),
    db.select({ id: orgUnits.id, name: orgUnits.name, code: orgUnits.code })
      .from(orgUnits)
      .where(eq(orgUnits.organizationId, organizationId))
      .orderBy(orgUnits.name),
    db.select({ id: permissionSets.id, name: permissionSets.name, active: permissionSets.active })
      .from(permissionSets)
      .where(eq(permissionSets.organizationId, organizationId))
      .orderBy(permissionSets.name),
    db.select({
      id: benefitPlans.id,
      name: benefitPlans.name,
      category: benefitPlans.category,
      active: benefitPlans.active,
      employeeShare: benefitPlans.employeeShare,
      cap: benefitPlans.cap,
    }).from(benefitPlans)
      .where(eq(benefitPlans.organizationId, organizationId))
      .orderBy(benefitPlans.name),
    db.select({
      id: schedulePatterns.id,
      code: schedulePatterns.code,
      name: schedulePatterns.name,
      cycleDays: schedulePatterns.cycleDays,
      active: schedulePatterns.active,
    }).from(schedulePatterns)
      .where(eq(schedulePatterns.organizationId, organizationId))
      .orderBy(schedulePatterns.name),
    listApprovalChainPolicies(organizationId),
    listSafeIntegrationConnectors(organizationId),
    listDynamicWorkerGroups(organizationId, true),
    db.select().from(automationEventLog)
      .where(eq(automationEventLog.organizationId, organizationId))
      .orderBy(desc(automationEventLog.occurredAt), desc(automationEventLog.id))
      .limit(60),
  ]);

  const completed = executions.filter((row) => row.status === "completed").length;
  const partial = executions.filter((row) => row.status === "partial").length;
  const failed = executions.filter((row) => row.status === "failed").length;
  const waiting = executions.filter((row) => ["waiting", "waiting_approval", "in_progress"].includes(row.status)).length;
  const terminal = completed + partial + failed;


  const executionByRuleEvent = new Map(
    executions.map((row) => [`${row.ruleId}:${row.eventKey}`, row]),
  );
  const caseByExecutionStep = new Map(
    cases.filter((row) => row.caseType === "execution_dead_letter")
      .map((row) => [`${row.sourceId}:${row.stepIndex}`, row]),
  );
  const attentionQueue = executions
    .filter((row) => ["failed", "partial"].includes(row.status))
    .map((row) => {
      const latest = latestExecutionSteps(row.result);
      const failedSteps = latest.filter((step) => step.status === "failed");
      const workflow = normalizeAutomationActions(row.workflow);
      const retryableFailedStepIndices = failedSteps
        .filter((step) => SAFE_FAILED_STEP_RETRY_ACTIONS.has(String(step.type ?? "")))
        .map((step) => Number(step.stepIndex))
        .filter((stepIndex) => Number.isInteger(stepIndex));
      const acknowledged = failedSteps.filter((step) =>
        caseByExecutionStep.get(`${row.id}:${Number(step.stepIndex)}`)?.status === "acknowledged"
      );
      const blocked = failedSteps.filter((step) =>
        caseByExecutionStep.get(`${row.id}:${Number(step.stepIndex)}`)?.status === "open"
        || caseByExecutionStep.get(`${row.id}:${Number(step.stepIndex)}`)?.status === "resolved"
      );
      const replayEligible = Boolean(
        blocked.length === 0
        && workflow
        && workflow.length > 0
        && !workflow.some((step) => step.type === "branch" || step.type === "wait" || step.type === "approval_gate")
        && workflow.every((step) => SAFE_REPLAY_EXECUTION_ACTIONS.has(step.type)),
      );
      const ageMinutes = Math.max(0, Math.floor((Date.now() - new Date(row.updatedAt).getTime()) / 60_000));
      return {
        executionId: row.id,
        ruleId: row.ruleId,
        status: row.status,
        error: row.error,
        failedSteps: failedSteps.map((step) => ({
          stepIndex: Number(step.stepIndex),
          type: String(step.type ?? "unknown"),
          error: String(step.error ?? "Automation action failed."),
        })),
        retryableFailedStepIndices: retryableFailedStepIndices.filter(
          (stepIndex) => !blocked.some((step) => Number(step.stepIndex) === stepIndex),
        ),
        deadLetterAcknowledgedCount: acknowledged.length,
        deadLetters: failedSteps.map((step) => {
          const letter = caseByExecutionStep.get(`${row.id}:${Number(step.stepIndex)}`);
          return {
            stepIndex: Number(step.stepIndex),
            caseId: letter?.id ?? null,
            status: letter?.status ?? null,
          };
        }),
        replayEligible,
        ageMinutes,
        slaState: ageMinutes >= 240 ? "breached" : ageMinutes >= 60 ? "aging" : "fresh",
      };
    });

  const decisionDiagnostics = eventRows.flatMap((event) => {
    const candidates = rules.filter((rule) => rule.trigger === event.trigger);
    return candidates.map((rule) => {
      const actual = executionByRuleEvent.get(`${rule.id}:${event.eventKey}`);
      if (actual) {
        return {
          eventId: event.id,
          eventKey: event.eventKey,
          trigger: event.trigger,
          occurredAt: event.occurredAt,
          ruleId: rule.id,
          ruleName: rule.name,
          outcome: "ran",
          reason: `Execution #${actual.id} is ${actual.status}.`,
          executionId: actual.id,
        };
      }
      if (!rule.active) {
        return {
          eventId: event.id,
          eventKey: event.eventKey,
          trigger: event.trigger,
          occurredAt: event.occurredAt,
          ruleId: rule.id,
          ruleName: rule.name,
          outcome: "skipped",
          reason: "Rule is currently inactive.",
          executionId: null,
        };
      }
      const actions = normalizeAutomationActions(rule.actions);
      if (!actions || !validAutomationConditions(rule.conditions)) {
        return {
          eventId: event.id,
          eventKey: event.eventKey,
          trigger: event.trigger,
          occurredAt: event.occurredAt,
          ruleId: rule.id,
          ruleName: rule.name,
          outcome: "invalid",
          reason: "Current published rule definition is invalid.",
          executionId: null,
        };
      }
      const preview = simulateAutomationImpact({
        trigger: event.trigger as AutomationTrigger,
        conditions: rule.conditions,
        actions,
        events: [{
          employeeId: event.employeeId,
          eventKey: event.eventKey,
          source: event.source,
          context: event.context && typeof event.context === "object" && !Array.isArray(event.context)
            ? event.context as Record<string, unknown>
            : {},
          occurredAt: event.occurredAt,
        }],
      });
      const sample = preview.samples[0];
      return {
        eventId: event.id,
        eventKey: event.eventKey,
        trigger: event.trigger,
        occurredAt: event.occurredAt,
        ruleId: rule.id,
        ruleName: rule.name,
        outcome: sample?.matched ? "matched_diagnostic" : "skipped",
        reason: sample?.reason ?? "No diagnostic evidence available.",
        executionId: null,
      };
    });
  }).slice(0, 120);

  return Response.json({
    rules,
    versions,
    executions,
    executionCenter: {
      attentionQueue,
      operationalCases: cases,
      caseCounts: {
        open: cases.filter((row) => row.status === "open").length,
        acknowledged: cases.filter((row) => row.status === "acknowledged").length,
        resolved: cases.filter((row) => row.status === "resolved").length,
        deadLetters: cases.filter((row) => row.caseType === "execution_dead_letter" && row.status !== "resolved").length,
      },
      decisionDiagnostics,
      generatedAt: new Date().toISOString(),
      diagnosticNote: "Ran outcomes are backed by stored execution evidence. Skipped/matched-without-execution diagnostics evaluate the current published rule against the immutable event ledger and are not a historical reconstruction of an older rule version.",
    },
    catalogs: {
      triggers: AUTOMATION_TRIGGER_CATALOG.map((trigger) => ({
        ...trigger,
        live: automationTriggerIsLive(trigger.value),
      })),
      liveTriggers: AUTOMATION_LIVE_TRIGGERS,
      plannedTriggers: AUTOMATION_PLANNED_TRIGGERS,
      conditions: AUTOMATION_CONDITION_FIELDS,
      operators: AUTOMATION_OPERATORS,
      actions: AUTOMATION_ACTION_CATALOG,
      documentTemplates: AUTOMATION_DOCUMENT_TEMPLATES.map((template) => ({
        id: template.id,
        version: template.version,
        name: template.name,
        description: template.description,
        allowedTriggers: [...template.allowedTriggers],
      })),
      templates: AUTOMATION_WORKFLOW_TEMPLATES.map((template) => ({
        id: template.id,
        version: template.version,
        category: template.category,
        name: template.name,
        description: template.description,
        trigger: template.trigger,
        conditionCount:
          Array.isArray((template.conditions as { all?: unknown[] }).all)
            ? (template.conditions as { all: unknown[] }).all.length
              + (Array.isArray((template.conditions as { any?: unknown[] }).any)
                ? (template.conditions as { any: unknown[] }).any.length
                : 0)
            : 0,
        actionCount: template.actions.length,
      })),
    },
    orgUnits: units,
    permissionSets: sets,
    benefitPlans: plans,
    approvalChains: approvalChains.filter((chain) => chain.active),
    integrationConnectors: integrationConnectors.filter((connector) => connector.active),
    dynamicGroups: dynamicGroups.map((group) => ({
      id: group.id,
      code: group.code,
      name: group.name,
      version: group.version,
    })),
    schedulePatterns: patterns.filter((pattern) => pattern.active),
    analytics: {
      activeRules: rules.filter((row) => row.active).length,
      recentExecutions: executions.length,
      completed,
      partial,
      failed,
      waiting,
      successRate: terminal
        ? Math.round((completed / terminal) * 1000) / 10
        : 100,
    },
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const demoDenied = publicDemoMutationDenied(user.email, "Automation Studio");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const guard = await assertStudioAdmin(user.id, organizationId);
  if (guard.denied) return guard.denied;

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "automation-studio-" + (action || "mutation"),
    resourceId: organizationId,
    limit: action === "draft-from-language" ? 8 : 40,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;


  if (action === "quarantine-execution-step") {
    const executionId = Number(body.executionId);
    const stepIndex = Number(body.stepIndex);
    const note = String(body.note ?? "").trim();
    if (!Number.isSafeInteger(executionId) || executionId < 1
        || !Number.isSafeInteger(stepIndex) || stepIndex < 0 || note.length < 12 || note.length > 480) {
      return Response.json({ error: "An execution, failed step and 12-480 character triage note are required." }, { status: 400 });
    }
    const [execution] = await db.select().from(automationExecutions).where(and(
      eq(automationExecutions.id, executionId),
      eq(automationExecutions.organizationId, organizationId),
    )).limit(1);
    if (!execution || !["failed", "partial"].includes(execution.status)) {
      return Response.json({ error: "Only a failed/partial execution can be quarantined." }, { status: 409 });
    }
    const step = latestExecutionSteps(execution.result).find((row) =>
      row.status === "failed" && Number(row.stepIndex) === stepIndex
    );
    if (!step) return Response.json({ error: "This execution step is not currently failed." }, { status: 409 });
    const result = await createExecutionDeadLetter({
      organizationId,
      executionId,
      stepIndex,
      actor: user.name,
      actorUserId: user.id,
      note,
      latestFailure: {
        type: String(step.type ?? "unknown"),
        error: String(step.error ?? "Failed without a recorded error."),
      },
    });
    return Response.json({
      operationalCase: result.case,
      created: result.created,
      automationWasReplayed: false,
    }, { status: result.created ? 201 : 200 });
  }

  if (action === "triage-operational-case") {
    const caseId = Number(body.caseId);
    const transition = String(body.transition ?? "");
    const note = String(body.note ?? "").trim();
    if (!Number.isSafeInteger(caseId) || caseId < 1
        || !["acknowledge", "resolve", "reopen"].includes(transition)
        || note.length < 16 || note.length > 2000) {
      return Response.json({
        error: "A valid case, acknowledge/resolve/reopen action, and 16-2000 character evidence note are required.",
      }, { status: 400 });
    }

    const [current] = await db.select().from(automationOperationalCases).where(and(
      eq(automationOperationalCases.id, caseId),
      eq(automationOperationalCases.organizationId, organizationId),
    )).limit(1);
    if (!current) return Response.json({ error: "Operational case not found." }, { status: 404 });
    const expected = transition === "acknowledge"
      ? "open" : transition === "resolve" ? "acknowledged" : "resolved";
    if (current.status !== expected) {
      return Response.json({ error: `Case must be ${expected} to ${transition}.` }, { status: 409 });
    }
    if (transition === "resolve" && !await operationalReviewSourceResolved({
      organizationId,
      caseType: current.caseType as Parameters<typeof operationalReviewSourceResolved>[0]["caseType"],
      sourceId: current.sourceId,
    })) {
      return Response.json({
        error: "The underlying authoritative WFM/payroll/compliance source is still open. Resolve it in its governed workspace first.",
      }, { status: 409 });
    }

    const now = new Date();
    const [updated] = await db.transaction(async (tx) => {
      const patch = transition === "acknowledge"
        ? {
            status: "acknowledged",
            acknowledgedByUserId: user.id,
            acknowledgedByName: user.name,
            acknowledgedAt: now,
            updatedAt: now,
          }
        : transition === "resolve"
          ? {
              status: "resolved",
              resolvedByUserId: user.id,
              resolvedByName: user.name,
              resolvedAt: now,
              resolutionNote: note,
              updatedAt: now,
            }
          : {
              status: "open",
              acknowledgedByUserId: null,
              acknowledgedByName: null,
              acknowledgedAt: null,
              resolvedByUserId: null,
              resolvedByName: null,
              resolvedAt: null,
              resolutionNote: null,
              updatedAt: now,
            };
      const [changed] = await tx.update(automationOperationalCases)
        .set(patch)
        .where(and(
          eq(automationOperationalCases.id, caseId),
          eq(automationOperationalCases.organizationId, organizationId),
          eq(automationOperationalCases.status, expected),
        )).returning();
      if (!changed) return [];
      await tx.insert(auditEvents).values({
        organizationId,
        actor: user.name,
        action: `Automation operations case ${transition}`,
        resource: changed.title,
        metadata: {
          caseId, caseType: changed.caseType,
          sourceType: changed.sourceType, sourceId: changed.sourceId,
          executionId: changed.executionId,
          stepIndex: changed.stepIndex,
          note,
          sourceMutation: false,
          underlyingExecutionStatusUnchanged: true,
        },
      });
      return [changed];
    });
    if (!updated) return Response.json({ error: "Case status changed before your decision." }, { status: 409 });
    return Response.json({
      operationalCase: updated,
      sourceMutation: false,
      executionStatusUnchanged: true,
    });
  }

  if (action === "retry-execution-step") {
    const executionId = Number(body.executionId);
    const stepIndex = body.stepIndex == null ? null : Number(body.stepIndex);
    if (!Number.isInteger(executionId) || (stepIndex != null && !Number.isInteger(stepIndex))) {
      return Response.json({ error: "executionId and an optional integer stepIndex are required." }, { status: 400 });
    }
    try {
      const execution = await retryAutomationExecutionFailedStep({
        organizationId,
        executionId,
        stepIndex,
      });
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Automation execution failed step retried",
        resource: `Execution #${executionId}`,
        metadata: {
          executionId,
          requestedStepIndex: stepIndex,
          resultingStatus: execution.status,
        },
      });
      return Response.json({ execution });
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Automation failed-step retry failed.",
      }, { status: 409 });
    }
  }

  if (action === "replay-execution") {
    const executionId = Number(body.executionId);
    if (!Number.isInteger(executionId)) {
      return Response.json({ error: "executionId is required." }, { status: 400 });
    }
    try {
      const execution = await replayAutomationExecutionSnapshot({
        organizationId,
        executionId,
      });
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Automation execution stored snapshot replayed",
        resource: `Execution #${executionId}`,
        metadata: {
          sourceExecutionId: executionId,
          replayExecutionId: execution.id,
          resultingStatus: execution.status,
          replayMode: "idempotent-state-actions-only",
        },
      });
      return Response.json({ execution }, { status: 201 });
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Automation stored-snapshot replay failed.",
      }, { status: 409 });
    }
  }

  if (action === "draft-from-language") {
    // No workflow writes, execution, or publication: only an audit record is written.
    try {
      const result = await draftAutomationFromLanguage(String(body.request ?? ""));
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Automation Studio language draft proposed",
        resource: "language-workflow-proposal",
        metadata: {
          source: result.source,
          trigger: result.draft.trigger,
          actionTypes: result.draft.actions.map((step) => step.type),
          // Never log a raw prompt, employee detail, or model response.
        },
      });
      const proposalReceipt = issueLanguageProposalReceipt({
        organizationId,
        actorUserId: user.id,
        sessionId: user.sessionId,
        sessionToken: user.sessionToken,
        draftHash: fingerprintLanguageProposal(result.draft),
      }, result.source);
      return Response.json({ ...result, proposalReceipt });
    } catch (error) {
      if (error instanceof LanguageDraftError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  }

  if (action === "save-language-draft") {
    // A model proposal cannot be substituted for a different workflow or activated at save.
    const validation = validateNaturalLanguageDraft(body.draft);
    if (!validation.valid || !validation.draft) {
      return Response.json({
        error: "The language proposal is no longer a valid typed workflow. Generate and review it again.",
        validationErrors: validation.errors,
      }, { status: 400 });
    }
    const draft = validation.draft;
    const source = verifyLanguageProposalReceipt(body.proposalReceipt, {
      organizationId,
      actorUserId: user.id,
      sessionId: user.sessionId,
      sessionToken: user.sessionToken,
      draftHash: fingerprintLanguageProposal(draft),
    });
    if (!source) {
      return Response.json({
        error: "Language proposal proof is missing, expired, or does not match this exact definition. Generate a new proposal.",
      }, { status: 409 });
    }

    try {
      const result = await saveAutomationRuleDraft({
        organizationId,
        name: draft.name,
        trigger: draft.trigger,
        conditions: draft.conditions,
        actions: draft.actions,
        active: false,
        actorUserId: user.id,
      });
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Automation Studio signed language draft saved",
        resource: result.draft.name,
        metadata: {
          ruleId: result.rule.id,
          draftVersion: result.draft.version,
          source,
          trigger: draft.trigger,
          active: false,
          actionTypes: draft.actions.map((item) => item.type),
        },
      });
      return Response.json(result, { status: 201 });
    } catch (error) {
      if (error instanceof AutomationVersionError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      if (uniqueConstraintViolation(error)) {
        return Response.json({
          error: "Another Automation Studio rule already uses this name. Generate or choose a different workflow.",
        }, { status: 409 });
      }
      throw error;
    }
  }

  if (action === "create-from-template") {
    const templateId = String(body.templateId ?? "").trim();
    const template = getAutomationWorkflowTemplate(templateId);
    if (!template) {
      return Response.json({ error: "Automation workflow template not found." }, { status: 404 });
    }
    const requestedName = String(body.name ?? template.name).trim();
    if (!requestedName) {
      return Response.json({ error: "Workflow name is required." }, { status: 400 });
    }

    try {
      const result = await saveAutomationRuleDraft({
        organizationId,
        name: requestedName.slice(0, 160),
        trigger: template.trigger,
        conditions: template.conditions,
        actions: template.actions,
        active: true,
        actorUserId: user.id,
      });
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Automation Studio template instantiated as draft",
        resource: result.draft.name,
        metadata: {
          ruleId: result.rule.id,
          draftVersion: result.draft.version,
          templateId: template.id,
          templateVersion: template.version,
          trigger: template.trigger,
          actionTypes: template.actions.map((item) => item.type),
        },
      });
      return Response.json({
        ...result,
        template: {
          id: template.id,
          version: template.version,
          name: template.name,
        },
      }, { status: 201 });
    } catch (error) {
      if (error instanceof AutomationVersionError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      if (uniqueConstraintViolation(error)) {
        return Response.json({
          error: "Another Automation Studio rule already uses this workflow name. Choose a different draft name.",
        }, { status: 409 });
      }
      throw error;
    }
  }

  if (action === "save-rule") {
    const id = body.id ? Number(body.id) : null;
    const name = String(body.name ?? "").trim();
    const trigger = String(body.trigger ?? "") as AutomationTrigger;
    const conditions = body.conditions ?? { version: 1, all: [], any: [] };
    const actions = normalizeAutomationActions(body.actions);
    const desiredActive = body.active === undefined ? true : Boolean(body.active);

    if (
      !name
      || !(AUTOMATION_TRIGGERS as readonly string[]).includes(trigger)
      || !validAutomationConditions(conditions)
      || !actions
    ) {
      return Response.json({
        error: "Rule name, supported trigger, valid IF conditions, and at least one valid THEN action are required.",
      }, { status: 400 });
    }
    if (!automationTriggerIsLive(trigger)) {
      return Response.json({
        error: "This trigger is visible on the Automation Studio roadmap but its authoritative event adapter is not connected yet.",
        trigger,
      }, { status: 409 });
    }

    const compatibilityError = validateAutomationActionTrigger(trigger, actions);
    if (compatibilityError) return Response.json({ error: compatibilityError }, { status: 400 });
    const connectorError = await validateConnectorActions(organizationId, actions);
    if (connectorError) return Response.json({ error: connectorError }, { status: 409 });
    const groupError = await validateDynamicGroupReferences(organizationId, conditions, actions);
    if (groupError) return Response.json({ error: groupError }, { status: 409 });

    try {
      const result = await saveAutomationRuleDraft({
        organizationId,
        ruleId: id,
        name: name.slice(0, 160),
        trigger,
        conditions,
        actions,
        active: desiredActive,
        actorUserId: user.id,
      });
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: result.created ? "Automation Studio draft created" : "Automation Studio draft updated",
        resource: result.draft.name,
        metadata: {
          ruleId: result.rule.id,
          draftVersion: result.draft.version,
          publishedVersion: result.rule.publishedVersion,
          trigger,
          actionTypes: actions.map((item) => item.type),
        },
      });
      return Response.json(result, { status: result.created ? 201 : 200 });
    } catch (error) {
      if (error instanceof AutomationVersionError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      if (uniqueConstraintViolation(error)) {
        return Response.json({ error: "Another Automation Studio rule already uses this workflow name." }, { status: 409 });
      }
      throw error;
    }
  }

  if (action === "publish-rule") {
    const ruleId = Number(body.ruleId);
    if (!Number.isInteger(ruleId)) return Response.json({ error: "ruleId is required." }, { status: 400 });

    const versions = await listAutomationRuleVersions(organizationId);
    const draft = versions.find((version) => version.ruleId === ruleId && version.status === "draft");
    if (!draft) {
      return Response.json({ error: "This workflow has no saved draft to publish." }, { status: 409 });
    }
    if (body.humanApproved !== true) {
      return Response.json({ error: "Explicit human publication approval is required." }, { status: 409 });
    }
    const draftHash = fingerprintAutomationDraft(draft);
    if (!verifyAutomationPreviewReceipt(body.previewReceipt, {
      organizationId,
      actorUserId: user.id,
      sessionId: user.sessionId,
      sessionToken: user.sessionToken,
      ruleId: draft.ruleId,
      draftVersion: draft.version,
      draftHash,
    })) {
      return Response.json({
        error: "Impact Preview proof is missing, stale, or for a different saved draft. Preview this exact version again.",
      }, { status: 409 });
    }
    const draftTrigger = draft.trigger as AutomationTrigger;
    const draftActions = normalizeAutomationActions(draft.actions);
    if (
      !(AUTOMATION_TRIGGERS as readonly string[]).includes(draftTrigger)
      || !validAutomationConditions(draft.conditions)
      || !draftActions
    ) {
      return Response.json({ error: "Draft definition is invalid and cannot be published." }, { status: 409 });
    }
    const connectorError = await validateConnectorActions(organizationId, draftActions);
    if (connectorError) return Response.json({ error: connectorError }, { status: 409 });
    const groupError = await validateDynamicGroupReferences(organizationId, draft.conditions, draftActions);
    if (groupError) return Response.json({ error: groupError }, { status: 409 });

    const previewEvents = await db.select().from(automationEventLog).where(and(
      eq(automationEventLog.organizationId, organizationId),
      eq(automationEventLog.trigger, draftTrigger),
    )).orderBy(desc(automationEventLog.occurredAt), desc(automationEventLog.id)).limit(200);
    const impactPreview = simulateAutomationImpact({
      trigger: draftTrigger,
      conditions: draft.conditions,
      actions: draftActions,
      events: previewEvents.map((row) => ({
        employeeId: row.employeeId,
        eventKey: row.eventKey,
        source: row.source,
        context: row.context && typeof row.context === "object" && !Array.isArray(row.context)
          ? row.context as Record<string, unknown>
          : {},
        occurredAt: row.occurredAt,
      })),
    });
    if (impactPreview.definitionError || impactPreview.authoritativePolicyBlocks > 0) {
      return Response.json({
        error: impactPreview.definitionError
          ?? "Impact Preview found authoritative events that would hit policy blocks. Resolve them before publishing.",
        impactPreview,
      }, { status: 409 });
    }
    if (impactPreview.authoritativeEvents === 0 && body.limitedEvidenceAcknowledged !== true) {
      return Response.json({
        error: "Impact Preview has no authoritative event samples. Explicitly acknowledge limited evidence before publishing.",
        impactPreview,
      }, { status: 409 });
    }

    try {
      const result = await publishAutomationRuleDraft({
        organizationId,
        ruleId,
        actorUserId: user.id,
        expectedDraftHash: draftHash,
      });
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Automation Studio draft published",
        resource: result.rule.name,
        metadata: {
          ruleId,
          publishedVersion: result.published.version,
          trigger: result.rule.trigger,
          active: result.rule.active,
          limitedEvidenceAcknowledged: impactPreview.authoritativeEvents === 0,
          impactPreview: {
            eventsEvaluated: impactPreview.eventsEvaluated,
            matchedEvents: impactPreview.matchedEvents,
            skippedEvents: impactPreview.skippedEvents,
            authoritativeEvents: impactPreview.authoritativeEvents,
            legacyBackfillEvents: impactPreview.legacyBackfillEvents,
            projectedSteps: impactPreview.projectedSteps,
            policyBlocks: impactPreview.policyBlocks,
            projectedPayrollAdjustmentAbsoluteAmount: impactPreview.projectedPayrollAdjustmentAbsoluteAmount,
          },
        },
      });
      return Response.json(result);
    } catch (error) {
      if (error instanceof AutomationVersionError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      if (uniqueConstraintViolation(error)) {
        return Response.json({ error: "Another Automation Studio rule already uses this workflow name." }, { status: 409 });
      }
      throw error;
    }
  }

  if (action === "rollback-rule") {
    const ruleId = Number(body.ruleId);
    const targetVersion = Number(body.targetVersion);
    if (!Number.isInteger(ruleId) || !Number.isInteger(targetVersion)) {
      return Response.json({ error: "ruleId and targetVersion are required." }, { status: 400 });
    }

    const versions = await listAutomationRuleVersions(organizationId);
    const target = versions.find((version) => version.ruleId === ruleId && version.version === targetVersion);
    const targetActions = target ? normalizeAutomationActions(target.actions) : null;
    if (target && !targetActions) {
      return Response.json({ error: "Rollback target actions are invalid." }, { status: 409 });
    }
    if (targetActions) {
      const connectorError = await validateConnectorActions(organizationId, targetActions);
      if (connectorError) return Response.json({ error: connectorError }, { status: 409 });
      if (target) {
        const groupError = await validateDynamicGroupReferences(organizationId, target.conditions, targetActions);
        if (groupError) return Response.json({ error: groupError }, { status: 409 });
      }
    }

    try {
      const result = await rollbackAutomationRule({
        organizationId,
        ruleId,
        targetVersion,
        actorUserId: user.id,
      });
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Automation Studio rule rolled back",
        resource: result.rule.name,
        metadata: {
          ruleId,
          restoredFromVersion: result.restoredFromVersion,
          publishedVersion: result.published.version,
          trigger: result.rule.trigger,
          active: result.rule.active,
        },
      });
      return Response.json(result);
    } catch (error) {
      if (error instanceof AutomationVersionError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      if (uniqueConstraintViolation(error)) {
        return Response.json({ error: "Another Automation Studio rule already uses this workflow name." }, { status: 409 });
      }
      throw error;
    }
  }

  if (action === "set-active") {
    const ruleId = Number(body.ruleId);
    const active = Boolean(body.active);
    if (!Number.isInteger(ruleId)) {
      return Response.json({ error: "ruleId is required." }, { status: 400 });
    }

    if (active) {
      const [rule] = await db.select().from(automationRules).where(eq(automationRules.id, ruleId)).limit(1);
      if (!rule || rule.organizationId !== organizationId) {
        return Response.json({ error: "Automation rule not found." }, { status: 404 });
      }
      const currentActions = normalizeAutomationActions(rule.actions);
      if (!currentActions) return Response.json({ error: "Published actions are invalid." }, { status: 409 });
      const connectorError = await validateConnectorActions(organizationId, currentActions);
      if (connectorError) return Response.json({ error: connectorError }, { status: 409 });
      const groupError = await validateDynamicGroupReferences(organizationId, rule.conditions, currentActions);
      if (groupError) return Response.json({ error: groupError }, { status: 409 });
    }

    try {
      const result = await setAutomationRuleActiveVersioned({
        organizationId,
        ruleId,
        active,
        actorUserId: user.id,
      });
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: active ? "Automation Studio rule enabled" : "Automation Studio rule disabled",
        resource: result.rule.name,
        metadata: {
          ruleId: result.rule.id,
          trigger: result.rule.trigger,
          publishedVersion: result.rule.publishedVersion,
        },
      });
      return Response.json(result);
    } catch (error) {
      if (error instanceof AutomationVersionError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      if (uniqueConstraintViolation(error)) {
        return Response.json({ error: "Another Automation Studio rule already uses this workflow name." }, { status: 409 });
      }
      throw error;
    }
  }

  return Response.json({ error: "Unsupported Automation Studio action." }, { status: 400 });
}
