import {
  hcmResponseMatchesReadScope, type HcmReadScope,
} from "@/lib/hcm-client-employer-scope";

export type VerifiedLifecycleRow = {
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  employeeStatus: string;
  state: "unconfigured" | "clear" | "upcoming" | "action_required" | "in_progress" | "complete";
  severity: "info" | "warning" | "blocker";
  action: "configure_terms" | "record_decision" | "review_decision" | "await_effective_date"
    | "retry_decision" | "start_separation" | "continue_separation" | "none";
  dueDate: string | null;
  daysUntil: number | null;
  label: string;
  detail: string;
  term: null | {
    id: number; termKind: string; employmentType: string; effectiveFrom: string;
    effectiveUntil?: string | null; probationReviewDate?: string | null;
    contractEndDate?: string | null; status: string;
  };
  decision: null | {
    id: number; decisionKind: string; status: string; effectiveDate: string;
    proposedSeparationLastDay?: string | null; separationHandoffStatus?: string | null;
    separationRecordId?: number | null; failure?: string | null;
  };
};
export type VerifiedLifecyclePayload = {
  organizationId: number; legalEntityId: number | null; today: string;
  policy: { actionWindowDays: number };
  summary: {
    total: number; actionRequired: number; upcoming: number; inProgress: number;
    unconfigured: number; handoffReady: number;
  };
  rows: VerifiedLifecycleRow[];
};

const states = ["unconfigured", "clear", "upcoming", "action_required", "in_progress", "complete"];
const actions = [
  "configure_terms", "record_decision", "review_decision", "await_effective_date",
  "retry_decision", "start_separation", "continue_separation", "none",
];
const severity = ["info", "warning", "blocker"];

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function natural(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function text(value: unknown): value is string {
  return typeof value === "string";
}
function date(value: unknown): value is string {
  return text(value) && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value + "T00:00:00Z"));
}
function optionalDate(value: unknown): boolean {
  return value === null || value === undefined || date(value);
}
function optionalText(value: unknown): boolean {
  return value === null || value === undefined || text(value);
}
function optionalId(value: unknown): boolean {
  return value === null || value === undefined || positive(value);
}
function validRow(value: unknown): value is VerifiedLifecycleRow {
  if (!object(value)) return false;
  if (!positive(value.employeeId) || !text(value.employeeNo) || !text(value.employeeName)
      || !text(value.employeeStatus) || !states.includes(String(value.state))
      || !severity.includes(String(value.severity)) || !actions.includes(String(value.action))
      || !optionalDate(value.dueDate) || value.dueDate === undefined
      || (value.daysUntil !== null && (!Number.isSafeInteger(value.daysUntil)))
      || value.daysUntil === undefined || !text(value.label) || !text(value.detail)) return false;
  if (value.term !== null) {
    const term = value.term;
    if (!object(term) || !positive(term.id) || !text(term.termKind)
        || !text(term.employmentType) || !date(term.effectiveFrom)
        || !text(term.status) || !optionalDate(term.effectiveUntil)
        || !optionalDate(term.probationReviewDate) || !optionalDate(term.contractEndDate)) return false;
  }
  if (value.decision !== null) {
    const decision = value.decision;
    if (!object(decision) || !positive(decision.id) || !text(decision.decisionKind)
        || !text(decision.status) || !date(decision.effectiveDate)
        || !optionalDate(decision.proposedSeparationLastDay)
        || !optionalText(decision.separationHandoffStatus)
        || !optionalId(decision.separationRecordId)
        || !optionalText(decision.failure)) return false;
  }
  if (value.action === "start_separation" && value.state !== "action_required") return false;
  return true;
}

/** A pure gate: a genuine zero-row source may be empty only after scope and shape proof. */
export function readVerifiedLifecycleResponse(
  ok: boolean, body: unknown, scope: HcmReadScope,
): VerifiedLifecyclePayload | null {
  if (!ok || !hcmResponseMatchesReadScope(body, scope) || !object(body)) return null;
  if (!date(body.today) || !object(body.policy) || !natural(body.policy.actionWindowDays)
      || !object(body.summary) || !Array.isArray(body.rows) || !body.rows.every(validRow)) return null;
  const rows = body.rows as VerifiedLifecycleRow[];
  const ids = rows.map((row) => row.employeeId);
  if (new Set(ids).size !== ids.length) return null;
  const expected: Record<string, number> = {
    total: rows.length,
    actionRequired: rows.filter((row) => row.state === "action_required").length,
    upcoming: rows.filter((row) => row.state === "upcoming").length,
    inProgress: rows.filter((row) => row.state === "in_progress").length,
    unconfigured: rows.filter((row) => row.state === "unconfigured").length,
    handoffReady: rows.filter((row) => row.action === "start_separation").length,
  };
  const summary = body.summary as Record<string, unknown>;
  if (Object.entries(expected).some(([key, amount]) => summary[key] !== amount)) return null;
  return body as VerifiedLifecyclePayload;
}
