/** Defense in depth for verified, tenant-owned statutory action queue reads. */
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const textOrNull = (value: unknown) => value === null || typeof value === "string";
const age = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const oneOf = (value: unknown, set: readonly string[]) =>
  typeof value === "string" && set.includes(value);

function validTask(value: unknown, org: number): boolean {
  if (!record(value)) return false;
  return id(value.id) && value.organizationId === org &&
    typeof value.sourceKey === "string" && value.sourceKey.length > 0 &&
    oneOf(value.severity, ["danger", "warning", "info"]) &&
    oneOf(value.status, ["open", "in_progress", "resolved"]) &&
    typeof value.title === "string" && value.title.length > 0 &&
    typeof value.detail === "string" &&
    textOrNull(value.agency) && textOrNull(value.applicableMonth) &&
    textOrNull(value.dueDate) && textOrNull(value.assignedToName) &&
    textOrNull(value.acknowledgedByName) && textOrNull(value.acknowledgedAt) &&
    textOrNull(value.resolvedAt) &&
    (value.assignedToUserId === null || id(value.assignedToUserId)) &&
    age(value.ageHours) && age(value.severityAgeHours) &&
    typeof value.escalationStage === "number" &&
    Number.isSafeInteger(value.escalationStage) &&
    value.escalationStage >= 0 && value.escalationStage <= 3;
}

function validAssignee(value: unknown): boolean {
  return record(value) && id(value.userId) &&
    typeof value.name === "string" && value.name.length > 0 &&
    typeof value.role === "string" && value.role.length > 0;
}

/** An empty *verified* array is clear. Missing, partial or foreign rows are not. */
export function isValidRemittanceQueuePayload(value: unknown, organizationId: number): boolean {
  if (!id(organizationId) || !record(value) ||
      value.organizationId !== organizationId || !id(value.currentUserId) ||
      !Array.isArray(value.tasks) || !Array.isArray(value.assignees) ||
      !value.tasks.every((task: unknown) => validTask(task, organizationId)) ||
      !value.assignees.every(validAssignee)) return false;
  const ids = value.tasks.map((task: {id: number}) => task.id);
  return new Set(ids).size === ids.length;
}
