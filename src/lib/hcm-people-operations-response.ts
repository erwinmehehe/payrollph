import { PEOPLE_OPS_TEAMS, type PeopleOpsPayload } from "@/lib/hcm-people-operations-inbox";

/**
 * Validate the entire read-only HR inbox snapshot before presenting counts,
 * rows, links or an apparently clear queue. Authorization and employer-scope
 * checks remain separately enforced by the route and its caller.
 */
const CATEGORIES = new Set(["employment", "onboarding", "position", "performance", "separation"]);
const PRIORITIES = new Set(["review", "follow_up", "source_check"]);
const PAGES = new Set(["People", "Planning", "Performance", "Separation"]);
const TEAMS = new Set<string>(PEOPLE_OPS_TEAMS);

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function date(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validRow(value: unknown): boolean {
  if (!object(value)) return false;
  return text(value.id) && count(value.employeeId) && value.employeeId > 0 &&
    text(value.employeeNo) && text(value.employeeName) &&
    CATEGORIES.has(String(value.category)) && PRIORITIES.has(String(value.priority)) &&
    text(value.title) && text(value.detail) && text(value.responsibleTeam) &&
    PAGES.has(String(value.page)) &&
    (value.dueDate === null || date(value.dueDate)) &&
    (value.daysUntil === null ||
      (typeof value.daysUntil === "number" && Number.isSafeInteger(value.daysUntil)));
}

export function isVerifiedPeopleOperationsPayload(
  value: unknown, requestedPage: number,
): value is PeopleOpsPayload {
  if (!object(value) || !date(value.today) || !object(value.summary) ||
      !object(value.attention) || !Array.isArray(value.rows) ||
      !Array.isArray(value.teamLoad) || !text(value.disclaimer)) return false;

  const summary = value.summary;
  if (!["total", "review", "followUp", "sourceCheck", "employeesAffected"]
    .every((key) => count(summary[key]))) return false;
  if (summary.total !== Number(summary.review) + Number(summary.followUp) + Number(summary.sourceCheck) ||
      Number(summary.employeesAffected) > Number(summary.total)) return false;

  const attention = value.attention;
  if (!["overdue", "dueToday", "dueNext7", "dueNext30", "undated"]
    .every((key) => count(attention[key]))) return false;
  if (Number(attention.overdue) + Number(attention.dueToday) +
      Number(attention.dueNext7) + Number(attention.dueNext30) +
      Number(attention.undated) > Number(summary.total)) return false;

  if (!count(value.filteredTotal) || value.filteredTotal > summary.total ||
      !count(value.page) || value.page < 1 ||
      !count(value.pages) || value.pages < 1 ||
      value.pageSize !== 20 || !Number.isSafeInteger(requestedPage) || requestedPage < 1) return false;
  const expectedPages = Math.max(1, Math.ceil(value.filteredTotal / value.pageSize));
  if (value.pages !== expectedPages || value.page !== Math.min(requestedPage, value.pages)) return false;
  const expectedRows = Math.min(value.pageSize,
    Math.max(0, value.filteredTotal - (value.page - 1) * value.pageSize));
  if (value.rows.length !== expectedRows || !value.rows.every(validRow)) return false;
  if (new Set(value.rows.map((row: Record<string, unknown>) => row.id)).size !== value.rows.length) return false;

  const seenTeams = new Set<string>();
  for (const candidate of value.teamLoad) {
    if (!object(candidate) || !text(candidate.team) || !TEAMS.has(candidate.team) ||
        seenTeams.has(candidate.team) ||
        !["total", "review", "overdue", "dueWithin7"].every((key) => count(candidate[key])) ||
        Number(candidate.review) > Number(candidate.total) ||
        Number(candidate.overdue) > Number(candidate.total) ||
        Number(candidate.dueWithin7) > Number(candidate.total)) return false;
    seenTeams.add(candidate.team);
  }
  return true;
}
