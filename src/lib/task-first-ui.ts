/** Presentation and deep-link helpers only. These do not grant access or change payroll rules. */
export type PayrollFocus = "workflow" | "register" | "exceptions" | "comparison" | "history";
export type TaskTarget = { page: string; runId?: number; focus?: PayrollFocus; employeeId?: number; filter?: "attendance-exceptions" | "missing-payout" };
export type WorkspaceLocation = TaskTarget & { organizationId: number };
const FOCUSES = new Set<PayrollFocus>(["workflow","register","exceptions","comparison","history"]);
export function taskFirstUiEnabled() {
  return process.env.NEXT_PUBLIC_LINAW_TASK_FIRST_UI_ENABLED === "true";
}
/** Fieldsets do not validate their descendants; validate each active control. */
export function reportOnboardingStepValidity(controls: Iterable<{ reportValidity(): boolean }>): boolean {
  for (const control of controls) {
    if (!control.reportValidity()) return false;
  }
  return true;
}
export function positiveId(value: unknown): number | undefined {
  if (typeof value !== "number" && (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value))) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}
export function uiMoney(value: string | number | null | undefined) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return "Unavailable";
  return new Intl.NumberFormat("en-PH", { style:"currency",currency:"PHP",minimumFractionDigits:2,maximumFractionDigits:2 }).format(Number(value));
}
export function uiDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Not scheduled";
  const date = new Date(value+"T12:00:00+08:00");
  if (!Number.isFinite(date.getTime())) return "Not scheduled";
  return new Intl.DateTimeFormat("en-PH",{year:"numeric",month:"long",day:"numeric",timeZone:"Asia/Manila"}).format(date);
}
/** A deep link can refer only to objects already authorized and loaded in this employer workspace. */
export function readWorkspaceLocation(search: string, scope: { organizationId:number; pages:readonly string[]; runIds:readonly number[]; employeeIds:readonly number[] }): WorkspaceLocation {
  const fallback: WorkspaceLocation = { organizationId:scope.organizationId,page:"Overview" };
  const q = new URLSearchParams(search);
  if (positiveId(q.get("organizationId")) !== scope.organizationId) return fallback;
  const page = q.get("page") ?? "Overview";
  if (!scope.pages.includes(page)) return fallback;
  const result: WorkspaceLocation = { organizationId:scope.organizationId,page };
  const runId = positiveId(q.get("runId"));
  if (page==="Payroll" && runId && scope.runIds.includes(runId)) result.runId=runId;
  const employeeId = positiveId(q.get("employeeId"));
  if (page==="People" && employeeId && scope.employeeIds.includes(employeeId)) result.employeeId=employeeId;
  const focus = q.get("focus") as PayrollFocus | null;
  if (page==="Payroll" && focus && FOCUSES.has(focus)) result.focus=focus;
  const filter = q.get("filter");
  if (page==="Time & attendance" && filter==="attendance-exceptions") result.filter=filter;
  if (page==="People" && filter==="missing-payout") result.filter=filter;
  return result;
}
export function workspaceSearch(current: string, target: WorkspaceLocation): string {
  const q = new URLSearchParams(current);
  for(const key of ["organizationId","page","runId","focus","employeeId","filter"]) q.delete(key);
  q.set("organizationId",String(target.organizationId));q.set("page",target.page);
  if(target.runId)q.set("runId",String(target.runId));
  if(target.focus)q.set("focus",target.focus);
  if(target.employeeId)q.set("employeeId",String(target.employeeId));
  if(target.filter)q.set("filter",target.filter);
  return "?"+q.toString();
}
export function employeeNeedsPayout(account: string | null | undefined, code:string | null | undefined): boolean {
  return !account || !code;
}
export function unpaidPayslipLabel(payDate: string) {
  return "Pay date "+uiDate(payDate);
}
