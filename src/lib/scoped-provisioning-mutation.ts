/**
 * Every provisioning write must carry the exact employer and worker that
 * were displayed in the authorized HR workspace. Do not infer a tenant from
 * a globally unique task ID or coerce "false" to true.
 */
export type ScopedProvisioningMutation = {
  id: number;
  organizationId: number;
  employeeId: number;
  done: boolean;
};

export function parseScopedProvisioningMutation(value: unknown): ScopedProvisioningMutation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (typeof body.id !== "number" || !Number.isSafeInteger(body.id) || body.id <= 0 ||
      typeof body.organizationId !== "number" || !Number.isSafeInteger(body.organizationId) ||
      body.organizationId <= 0 ||
      typeof body.employeeId !== "number" || !Number.isSafeInteger(body.employeeId) ||
      body.employeeId <= 0 ||
      typeof body.done !== "boolean") return null;
  return {
    id: body.id, organizationId: body.organizationId,
    employeeId: body.employeeId, done: body.done,
  };
}
