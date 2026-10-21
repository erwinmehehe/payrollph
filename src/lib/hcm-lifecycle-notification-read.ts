/** Source, employer and action-bound lifecycle reminder contracts. */
export type VerifiedLifecycleNotificationTask = {
  id: number; organizationId: number; employeeId: number;
  sourceType: string; sourceId: number | null;
  employeeNo: string; employeeName: string;
  action: string; stage: string; escalationStage: number;
  severity: "info" | "warning" | "blocker";
  title: string; detail: string; dueDate: string | null;
  status: "open" | "acknowledged" | "snoozed" | "resolved";
  ownerUserId: number | null; ownerName: string | null;
  snoozeUntil: string | null; lastNotifiedAt: string | null;
};
export type VerifiedLifecycleNotificationQueue = {
  organizationId: number;
  tasks: VerifiedLifecycleNotificationTask[];
  owners: Array<{ userId: number; name: string; email: string; role: string }>;
  canAssign: boolean;
};
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const nullableText = (v: unknown) => v === null || typeof v === "string";
const nullableId = (v: unknown) => v === null || id(v);
const nullableInstant = (v: unknown) => v === null ||
  (typeof v === "string" && Number.isFinite(Date.parse(v)));
const nullableDate = (v: unknown) => v === null ||
  (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)));
function task(v: unknown, organizationId: number): v is VerifiedLifecycleNotificationTask {
  return record(v) && id(v.id) && v.organizationId === organizationId && id(v.employeeId) &&
    text(v.sourceType) && nullableId(v.sourceId) &&
    typeof v.employeeNo === "string" && text(v.employeeName) &&
    text(v.action) && text(v.stage) && count(v.escalationStage) &&
    ["info", "warning", "blocker"].includes(String(v.severity)) &&
    text(v.title) && typeof v.detail === "string" && nullableDate(v.dueDate) &&
    ["open", "acknowledged", "snoozed", "resolved"].includes(String(v.status)) &&
    nullableId(v.ownerUserId) && nullableText(v.ownerName) &&
    nullableInstant(v.snoozeUntil) && nullableInstant(v.lastNotifiedAt);
}
function owner(v: unknown) {
  return record(v) && id(v.userId) && text(v.name) && text(v.email) && text(v.role);
}
export function isVerifiedLifecycleNotificationQueue(
  v: unknown, organizationId: number,
): v is VerifiedLifecycleNotificationQueue {
  if (!id(organizationId) || !record(v) || v.organizationId !== organizationId ||
      !Array.isArray(v.tasks) || v.tasks.length > 5000 ||
      !Array.isArray(v.owners) || v.owners.length > 1000 ||
      typeof v.canAssign !== "boolean" ||
      !v.tasks.every((item: unknown) => task(item, organizationId)) ||
      !v.owners.every(owner) || (!v.canAssign && v.owners.length > 0)) return false;
  const ids = v.tasks.map((item: VerifiedLifecycleNotificationTask) => item.id);
  return new Set(ids).size === ids.length;
}
/** HTTP success is not mutation evidence. */
export function isVerifiedLifecycleNotificationReceipt(
  v: unknown, organizationId: number, taskId: number,
  action: string, extra: Readonly<Record<string, unknown>> = {},
): boolean {
  if (!id(organizationId) || !id(taskId) || !record(v) ||
      !record(v.task) || v.task.organizationId !== organizationId ||
      v.task.id !== taskId) return false;
  if (action === "assign") {
    return id(extra.ownerUserId) && v.task.ownerUserId === extra.ownerUserId;
  }
  if (action === "snooze") {
    return v.task.status === "snoozed" &&
      typeof v.task.snoozeUntil === "string" &&
      Number.isFinite(Date.parse(v.task.snoozeUntil));
  }
  return (action === "acknowledge" || action === "dismiss") &&
    v.task.status === "acknowledged";
}
