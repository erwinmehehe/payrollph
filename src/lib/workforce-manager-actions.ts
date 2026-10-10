/**
 * Read-only WFM manager work queue. The parent coverage response is already
 * tenant-/role-scoped; do not query or expose payroll amounts here.
 * This does not publish schedules or run background jobs.
 */
export type WfmActionPriority = "critical" | "high" | "normal";
export type WfmManagerAction = {
  id: string;
  kind: "staffing" | "claim_review" | "schedule_control" | "attendance" | "evidence";
  priority: WfmActionPriority;
  title: string;
  detail: string;
  workDate: string | null;
  destination: "#wfm-smart-recovery" | "#wfm-roster-readiness" |
    "#wfm-claims" | "#wfm-labor-variance";
};
export type WfmActionQueueInput = {
  today: string;
  coverage: Array<{ requirementId: number; workDate: string; gap: number }>;
  openShifts: Array<{ id: number; workDate: string }>;
  claims: Array<{ id: number; openShiftId: number; status: string }>;
  blockingGuardrailIssues: number;
  attendanceExceptionCount: number;
  evidenceWarnings?: Array<{ code: string; count: number; message: string }>;
};

/** Always render staffing urgency in Philippine work dates, not browser time. */
export function phWorkDateAt(instant: Date = new Date()): string {
  if (!Number.isFinite(instant.getTime())) throw new Error("Invalid clock instant");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant);
  const part = (key: string) => parts.find(item => item.type === key)?.value;
  return String(part("year")) + "-" + String(part("month")) + "-" + String(part("day"));
}

function dayIndex(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const dateValue = Date.parse(date + "T00:00:00Z");
  return Number.isFinite(dateValue) && new Date(dateValue).toISOString().slice(0, 10) === date
    ? Math.floor(dateValue / 86_400_000) : null;
}

export function buildWfmManagerActionQueue(input: WfmActionQueueInput): {
  actions: WfmManagerAction[];
  total: number;
  critical: number;
  high: number;
  dueWithinTwoDays: number;
} {
  const today = dayIndex(input.today);
  if (today === null) throw new Error("A valid Philippine work date is required");
  const actions: WfmManagerAction[] = [];
  const add = (row: WfmManagerAction) => actions.push(row);
  for (const row of input.coverage) {
    if (!Number.isSafeInteger(row.gap) || row.gap <= 0 ||
        !Number.isSafeInteger(row.requirementId) || dayIndex(row.workDate) === null) continue;
    const delta = dayIndex(row.workDate)! - today;
    add({
      id: "coverage:" + row.requirementId,
      kind: "staffing",
      priority: delta >= 0 && delta <= 1 ? "critical" : "high",
      workDate: row.workDate,
      title: delta < 0 ? "Investigate past staffing gap" : "Fill " + row.gap + " uncovered staffing slot(s)",
      detail: delta < 0
        ? "The date has passed. Reconcile recorded staffing and attendance; do not backdate a shift automatically."
        : row.gap + " qualified worker slot(s) remain open for " + row.workDate + ". Review the draft and stage a governed claim.",
      destination: delta < 0 ? "#wfm-labor-variance" : "#wfm-smart-recovery",
    });
  }
  const byOpenShift = new Map(input.openShifts.map(row => [row.id, row]));
  const pendingByShift = new Map<number, number>();
  for (const claim of input.claims) {
    if (claim.status !== "pending") continue;
    pendingByShift.set(claim.openShiftId, (pendingByShift.get(claim.openShiftId) ?? 0) + 1);
  }
  for (const [shiftId, pending] of pendingByShift) {
    const shift = byOpenShift.get(shiftId);
    if (!shift || dayIndex(shift.workDate) === null) continue;
    const delta = dayIndex(shift.workDate)! - today;
    add({
      id: "claim:" + shiftId, kind: "claim_review",
      priority: delta <= 1 ? "critical" : "high",
      workDate: shift.workDate,
      title: "Review " + pending + " pending shift claim(s)",
      detail: "A manager must independently approve or reject the requests. Check current qualifications, availability and roster conflicts.",
      destination: "#wfm-claims",
    });
  }
  const blockers = Math.max(0, Math.trunc(input.blockingGuardrailIssues));
  if (blockers > 0 && Number.isFinite(blockers)) add({
    id: "guardrails", kind: "schedule_control", priority: "critical",
    workDate: null, title: "Resolve " + blockers + " blocking schedule guardrail(s)",
    detail: "Review company rest/workload controls before schedule release.",
    destination: "#wfm-roster-readiness",
  });
  const exceptions = Math.max(0, Math.trunc(input.attendanceExceptionCount));
  if (exceptions > 0 && Number.isFinite(exceptions)) add({
    id: "attendance", kind: "attendance", priority: "high",
    workDate: null, title: "Reconcile " + exceptions + " attendance exception(s)",
    detail: "Review actual punches and corrections before payroll cut-off; no pay adjustment is made by this queue.",
    destination: "#wfm-labor-variance",
  });
  const evidenceCodes = new Set(["role_evidence", "capability_evidence", "absence_evidence", "site_evidence"]);
  for (const warning of input.evidenceWarnings ?? []) {
    if (!evidenceCodes.has(warning.code) || !Number.isSafeInteger(warning.count) ||
        warning.count <= 0) continue;
    add({
      id: "evidence:" + warning.code, kind: "evidence", priority: "high",
      workDate: null, title: "Check " + warning.count + " " + warning.code.replace("_", " ") + " item(s)",
      detail: "Resolve incomplete eligibility/source evidence in the existing controlled workflow.",
      destination: "#wfm-roster-readiness",
    });
  }
  const priorityRank: Record<WfmActionPriority, number> = { critical: 0, high: 1, normal: 2 };
  actions.sort((a, b) =>
    priorityRank[a.priority] - priorityRank[b.priority] ||
    (a.workDate ?? "9999-12-31").localeCompare(b.workDate ?? "9999-12-31") ||
    a.id.localeCompare(b.id));
  return {
    actions: actions.slice(0, 25),
    total: actions.length,
    critical: actions.filter(row => row.priority === "critical").length,
    high: actions.filter(row => row.priority === "high").length,
    dueWithinTwoDays: actions.filter(row => row.workDate !== null &&
      dayIndex(row.workDate)! >= today && dayIndex(row.workDate)! - today <= 2).length,
  };
}
