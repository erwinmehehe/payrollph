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
  // A scoped user must not quietly receive group-wide reads, even if an
  // administrator accidentally granted them more than one employer.
  if (allowed.size !== 1) return { ok: false, code: "ENTITY_SELECTION_REQUIRED" };
  return { ok: true, group, selectedEntityId: [...allowed][0], allowedEntityIds: [...allowed] };
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
