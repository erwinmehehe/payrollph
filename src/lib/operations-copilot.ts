import type { AssuranceFinding, AssuranceSeverity } from "./payroll-assurance";
import { PAYROLL_FINDING_EXPLANATION_TEMPLATES } from "./payroll-finding-explanations";
import { automationModelAllowedForOrganization } from "./automation-model-consent";

/**
 * Read-only source-linked operations triage. This module never calculates wages,
 * creates cases, changes approvals, or sends personal records to a model.
 */
export const OPERATIONS_COPILOT_PREVIEW_LIMIT = 30;

export type CopilotArea = "payroll" | "hr";
export type CopilotPriority = "high" | "medium" | "info";
export type CopilotSignal = {
  key: string;
  priority: CopilotPriority;
  blocking?: boolean;
  count: number;
  title: string;
  reason: string;
  nextStep: string;
  evidence: string;
  sourceUrl: string;
};
export type CopilotBrief = {
  area: CopilotArea;
  organizationId: number;
  runId: number | null;
  metrics: Array<{ key: string; label: string; value: number }>;
  signals: CopilotSignal[];
  signalsShown: number;
  signalTypesOrCases: number;
  previewTruncated: boolean;
  source: "stored-payroll-assurance" | "scoped-hr-operational-cases";
  caution: string;
};

export type HrCaseSource = {
  id: number;
  organizationId: number;
  caseType: string;
  status: string;
  ownerUserId: number | null;
  dueAt: string | null;
  overdue: boolean;
};

export type HrQueueTotals = {
  totalOpen: number;
  overdue: number;
  unassigned: number;
};

const severityRank: Record<CopilotPriority, number> = { high: 0, medium: 1, info: 2 };
const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
const safeCode = (code: string) => /^[A-Z][A-Z0-9_]{0,79}$/.test(code);
const safeCaseType = (type: string) => /^[a-z][a-z0-9_]{0,79}$/.test(type) ? type.replace(/_/g, " ") : "operational case";

/**
 * A dedicated tenant pilot allowlist rather than a new global boolean gate.
 * Changing the shared release-flag registry invalidates sealed security and
 * isolation proofs for unrelated modules. Empty or malformed config fails
 * closed; no other module is activated by this pilot.
 */
function tenantInPilotList(organizationId: number, value: string | undefined): boolean {
  if (!validId(organizationId) || !value || value.length > 2048) return false;
  const parts = value.split(",");
  if (!parts.length || parts.length > 100 || parts.some(part => !/^[1-9]\d*$/.test(part.trim()))) {
    return false;
  }
  const ids = parts.map(part => Number(part.trim()));
  if (ids.some(id => !validId(id)) || new Set(ids).size !== ids.length) return false;
  return ids.includes(organizationId);
}

/** Enables ONLY the named tenant's read-only preview. Disabled by default. */
export function operationsCopilotEnabled(
  organizationId: number,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  // The new API and SSR surface has NO independently accepted two-tenant
  // real-HTTP proof yet. Do not make it available in production even if a
  // tenant allowlist is accidentally populated. Exact-head acceptance is
  // required before this restriction can be reviewed for removal.
  if (env.NODE_ENV === "production") return false;
  return tenantInPilotList(organizationId, env.OPERATIONS_COPILOT_PILOT_ORG_IDS);
}

/** External AI requires its own tenant allowlist plus the existing DPA gate. */
export function operationsCopilotAiAllowed(
  organizationId: number,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return operationsCopilotEnabled(organizationId, env)
    && tenantInPilotList(organizationId, env.OPERATIONS_COPILOT_AI_PILOT_ORG_IDS)
    && automationModelAllowedForOrganization(organizationId, env);
}

/**
 * Reads ONLY source finding codes, severities and blocking flags. Titles,
 * details, employee IDs and monetary values are intentionally discarded.
 */
export function buildPayrollOperationsBrief(input: {
  organizationId: number;
  runId: number;
  findings: readonly AssuranceFinding[];
}): CopilotBrief {
  const { organizationId, runId, findings } = input;
  if (!validId(organizationId) || !validId(runId)) throw new Error("COPILOT_INVALID_SCOPE");
  const groups = new Map<string, { count: number; priority: AssuranceSeverity; blocking: boolean }>();
  let blocking = 0;
  let high = 0;
  for (const finding of findings) {
    if (!safeCode(finding.code) || !["high", "medium", "info"].includes(finding.severity)) {
      throw new Error("COPILOT_INVALID_SOURCE_FINDING");
    }
    if (finding.blocking === true) blocking += 1;
    if (finding.severity === "high") high += 1;
    const previous = groups.get(finding.code);
    if (!previous) {
      groups.set(finding.code, { count: 1, priority: finding.severity, blocking: finding.blocking === true });
    } else {
      previous.count += 1;
      previous.blocking ||= finding.blocking === true;
      if (severityRank[finding.severity] < severityRank[previous.priority]) previous.priority = finding.severity;
    }
  }

  const sourceUrl = "/app?organizationId=" + organizationId + "&workspacePage=Payroll&runId=" + runId;
  const signals = Array.from(groups.entries()).map(([code, group]) => {
    const description = PAYROLL_FINDING_EXPLANATION_TEMPLATES[code];
    return {
      key: code,
      priority: group.blocking ? "high" as const : group.priority,
      blocking: group.blocking,
      count: group.count,
      title: description?.what ?? "A recorded payroll finding needs review.",
      reason: description?.why ?? "The original assurance source contains this finding code.",
      nextStep: description?.next ?? "Review the source finding through the existing payroll workflow.",
      evidence: "Assurance finding " + code + (group.blocking ? " (source marked blocking)" : " (review only)"),
      sourceUrl,
    };
  }).sort((a, b) =>
    Number(b.blocking) - Number(a.blocking) ||
    severityRank[a.priority] - severityRank[b.priority] ||
    b.count - a.count ||
    a.key.localeCompare(b.key)
  );

  return {
    area: "payroll",
    organizationId,
    runId,
    metrics: [
      { key: "findings", label: "Recorded findings", value: findings.length },
      { key: "blocking", label: "Source-marked blockers", value: blocking },
      { key: "high", label: "High-severity findings", value: high },
    ],
    signals: signals.slice(0, OPERATIONS_COPILOT_PREVIEW_LIMIT),
    signalsShown: Math.min(signals.length, OPERATIONS_COPILOT_PREVIEW_LIMIT),
    signalTypesOrCases: signals.length,
    previewTruncated: signals.length > OPERATIONS_COPILOT_PREVIEW_LIMIT,
    source: "stored-payroll-assurance",
    caution: "Explanations are based only on existing assurance findings. No findings is not a payroll approval, statutory certification, or permission to release.",
  };
}

/**
 * Read-only view of EXISTING tenant-scoped cases. Case title, notes, employee
 * identifiers, personal circumstances and private source payloads never enter
 * these signals or the optional external model snapshot.
 */
export function buildHrOperationsBrief(input: {
  organizationId: number;
  cases: readonly HrCaseSource[];
  totals: HrQueueTotals;
}): CopilotBrief {
  const { organizationId, cases, totals } = input;
  if (!validId(organizationId)
    || Object.values(totals).some(value => !Number.isSafeInteger(value) || value < 0)
    || totals.overdue > totals.totalOpen || totals.unassigned > totals.totalOpen
    || totals.totalOpen < cases.length) throw new Error("COPILOT_INVALID_QUEUE_TOTALS");
  const ids = new Set<number>();
  for (const row of cases) {
    if (!validId(row.id) || row.organizationId !== organizationId || ids.has(row.id)
      || !["open", "acknowledged"].includes(row.status)
      || !(row.ownerUserId === null || validId(row.ownerUserId))
      || typeof row.caseType !== "string" || typeof row.overdue !== "boolean"
      || !(row.dueAt === null || (typeof row.dueAt === "string" && Number.isFinite(Date.parse(row.dueAt))))) {
      throw new Error("COPILOT_INVALID_QUEUE_ROW");
    }
    ids.add(row.id);
  }
  const sourceUrl = "/hcm/work-items?organizationId=" + organizationId;
  const ordered = [...cases];
  // Explicit stable ordering instead of relying on an externally supplied list.
  ordered.sort((a, b) =>
    Number(b.overdue) - Number(a.overdue)
    || Number(b.ownerUserId === null) - Number(a.ownerUserId === null)
    || (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999")
    || a.id - b.id
  );
  const signals = ordered.slice(0, OPERATIONS_COPILOT_PREVIEW_LIMIT).map(row => {
    const priority: CopilotPriority = row.overdue ? "high" : row.ownerUserId === null ? "medium" : "info";
    return {
      key: "case:" + row.id,
      priority,
      count: 1,
      title: row.overdue ? "Overdue HR follow-up" : row.ownerUserId === null ? "Unassigned HR follow-up" : "Open HR follow-up",
      reason: "Recorded " + safeCaseType(row.caseType) + " case #" + row.id
        + (row.overdue ? " is overdue." : row.ownerUserId === null ? " has no assigned owner." : " is still open."),
      nextStep: row.overdue
        ? "Open the existing HR Work Queue and review the deadline and escalation with its authorized owner."
        : row.ownerUserId === null
          ? "Assign an authorized owner through the existing HR Work Queue approval process."
          : "Review the source case and follow up in its existing workflow.",
      evidence: "Existing HR case #" + row.id + " (" + row.status + ")",
      sourceUrl,
    };
  });

  return {
    area: "hr",
    organizationId,
    runId: null,
    metrics: [
      { key: "open", label: "Open or acknowledged cases", value: totals.totalOpen },
      { key: "overdue", label: "Overdue", value: totals.overdue },
      { key: "unassigned", label: "Without an assigned owner", value: totals.unassigned },
    ],
    signals,
    signalsShown: signals.length,
    signalTypesOrCases: totals.totalOpen,
    previewTruncated: totals.totalOpen > signals.length,
    source: "scoped-hr-operational-cases",
    caution: "This is a bounded preview of open and acknowledged operational cases, not all HR work. It does not assign, close, or escalate cases.",
  };
}

/** Strict aggregate-only payload for external narration. Never send source case IDs. */
export function modelSafeOperationsSnapshot(brief: CopilotBrief) {
  if (brief.area === "hr") {
    return {
      area: "hr" as const,
      metrics: brief.metrics.map(item => ({ key: item.key, value: item.value })),
      focusKeys: ["overdue", "unassigned", "open"],
    };
  }
  return {
    area: "payroll" as const,
    metrics: brief.metrics.map(item => ({ key: item.key, value: item.value })),
    focusKeys: brief.signals.map(item => item.key),
    findingTypes: brief.signals.map(item => ({
      key: item.key, count: item.count, priority: item.priority,
      nextStep: item.nextStep,
    })),
  };
}
