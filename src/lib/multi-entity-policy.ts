/** Pure, executable entity scope policy. Tenant membership is a prerequisite. */
/** Cross-employer reads require the dedicated tenant-scoped, read-only group HR role.
 * Owner/admin/bookkeeper membership never grants group visibility automatically. */
export const GROUP_ENTITY_ROLES = new Set(["group_hr"]);

export type EntityDecision =
  | { ok: true; group: boolean; selectedEntityId: number | null; allowedEntityIds: number[] }
  | { ok: false; code: "ENTITY_ACCESS_DENIED" | "ENTITY_SELECTION_REQUIRED" };

export function decideEntityAccess(input: {
  role: string;
  availableEntityIds: number[];
  grantedEntityIds: number[];
  requested: string | number | null | undefined;
}): EntityDecision {
  const { role, availableEntityIds, grantedEntityIds, requested } = input;
  const group = GROUP_ENTITY_ROLES.has(role);
  const allowed = new Set(group ? availableEntityIds : grantedEntityIds.filter(id => availableEntityIds.includes(id)));
  if (requested === "all" || requested === null) {
    return group ? { ok: true, group, selectedEntityId: null, allowedEntityIds: [...allowed] }
      : { ok: false, code: "ENTITY_ACCESS_DENIED" };
  }
  if (requested !== undefined && requested !== "") {
    const n = typeof requested === "number" ? requested : Number(requested);
    return Number.isSafeInteger(n) && n > 0 && allowed.has(n)
      ? { ok: true, group, selectedEntityId: n, allowedEntityIds: [...allowed] }
      : { ok: false, code: "ENTITY_ACCESS_DENIED" };
  }
  if (group) return { ok: true, group, selectedEntityId: null, allowedEntityIds: [...allowed] };
  // Even multi-granted administrators always start with ONE employer, never
  // an implicit "all" view. An explicit selection must still pass the grant
  // check above; deterministic initial selection avoids an unusable workspace.
  if (!allowed.size) return { ok: false, code: "ENTITY_SELECTION_REQUIRED" };
  return { ok: true, group, selectedEntityId: Math.min(...allowed), allowedEntityIds: [...allowed] };
}

export function entityResourceAllowed(
  decision: EntityDecision, resourceEntityId: number | null,
): boolean {
  if (!decision.ok || !Number.isSafeInteger(resourceEntityId) || !resourceEntityId || !decision.allowedEntityIds.includes(resourceEntityId)) return false;
  return decision.selectedEntityId === null
    ? decision.group
    : decision.selectedEntityId === resourceEntityId;
}

export function entityConfirmationMatches(legalName: string, typed: string): boolean {
  return legalName.trim().length > 0 && typed.trim() === legalName.trim();
}

// A legal employer's identity, government registration and bank destination
// require a versioned, independently reviewed mutation. Editing the legacy
// projection in place would erase the authoritative registration history.
export const VERSIONED_EMPLOYER_FIELDS = [
  "legalName", "registeredAddress", "birTin", "birBranchCode",
  "sssEmployerNo", "philHealthEmployerNo", "pagIbigEmployerNo",
  "disbursementBankCode", "disbursementAccountName", "disbursementAccount",
] as const;

export function validateLegalEmployerSettingsPatch(value: unknown):
  | { ok: true; payrollCalendarMode: "flexible" | "ph_semi_monthly" }
  | { ok: false; code: "VERSIONED_REGISTRATION_REQUIRED" | "INVALID_SETTINGS_PATCH" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, code: "INVALID_SETTINGS_PATCH" };
  }
  const input = value as Record<string, unknown>;
  // Presence (including null and empty strings) matters: a caller must not
  // reset protected fields by supplying an empty value.
  if (VERSIONED_EMPLOYER_FIELDS.some(field => Object.hasOwn(input, field))) {
    return { ok: false, code: "VERSIONED_REGISTRATION_REQUIRED" };
  }
  if (Object.keys(input).some(key => !["organizationId", "legalEntityId", "payrollCalendarMode"].includes(key))) {
    return { ok: false, code: "INVALID_SETTINGS_PATCH" };
  }
  const mode = input.payrollCalendarMode;
  if (mode !== "flexible" && mode !== "ph_semi_monthly") {
    return { ok: false, code: "INVALID_SETTINGS_PATCH" };
  }
  return { ok: true, payrollCalendarMode: mode };
}


/**
 * A legal-employer transfer is a scoped mutation, NOT a group read.
 * Cross-entity read stays exclusive to group_hr, which can never mutate.
 * Makers and checkers must have explicit grants to BOTH employers and must
 * operate from their selected source-employer context. The separate transfer
 * release flag, MFA, membership, effective-date and liability controls remain
 * mandatory at the HTTP/DB layers.
 */
export type TransferAction = "propose" | "approve" | "reject" | "apply";
export function canActOnEntityTransfer(input: {
  role: string;
  action: TransferAction;
  selectedEntityId: number | null;
  sourceEntityId: number;
  targetEntityId: number;
  grantedEntityIds: readonly number[];
  actorUserId: number;
  makerUserId?: number;
}): boolean {
  if (!Number.isSafeInteger(input.actorUserId) || input.actorUserId <= 0 ||
      (input.action !== "propose" &&
       (!Number.isSafeInteger(input.makerUserId) || (input.makerUserId ?? 0) <= 0))) return false;
  if (GROUP_ENTITY_ROLES.has(input.role)) return false;
  const makers = ["owner", "admin", "bookkeeper", "hr"];
  const checkers = ["owner", "admin", "bookkeeper"];
  const allowedRoles = input.action === "propose" ? makers : checkers;
  if (!allowedRoles.includes(input.role)) return false;
  if (!Number.isSafeInteger(input.sourceEntityId) ||
      !Number.isSafeInteger(input.targetEntityId) ||
      input.sourceEntityId <= 0 || input.targetEntityId <= 0 ||
      input.sourceEntityId === input.targetEntityId) return false;
  if (input.selectedEntityId !== input.sourceEntityId) return false;
  if (!input.grantedEntityIds.includes(input.sourceEntityId) ||
      !input.grantedEntityIds.includes(input.targetEntityId)) return false;
  // A maker cannot approve, reject, or apply their own request. The route
  // also rechecks this in the same DB transaction as the state mutation.
  if (input.action !== "propose" &&
      (!Number.isSafeInteger(input.makerUserId) ||
       input.makerUserId === input.actorUserId)) return false;
  return true;
}


/**
 * Public transfer metadata only. Transfer DB rows contain sensitive leave and
 * full payroll/13th-month snapshots that must NEVER be serialized to clients.
 * Keep this whitelist shared by list, create and decision endpoints.
 */
export function summarizeEntityTransfer(row: {
  id: number;
  employeeId: number;
  fromLegalEntityId: number;
  toLegalEntityId: number;
  effectiveDate: string;
  status: string;
  requestedByUserId: number;
}) {
  return {
    id: row.id,
    employeeId: row.employeeId,
    fromLegalEntityId: row.fromLegalEntityId,
    toLegalEntityId: row.toLegalEntityId,
    effectiveDate: row.effectiveDate,
    status: row.status,
    requestedByUserId: row.requestedByUserId,
  };
}
