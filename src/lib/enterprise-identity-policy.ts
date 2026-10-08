/**
 * Enterprise provisioning rules shared by SCIM create/patch operations.
 * SCIM is allowed to assign only tenant-scoped base roles and may NEVER
 * manufacture company-wide access by omitting an org-unit attribute.
 */
export const SCIM_MEMBER_ROLES = ["employee", "manager", "hr", "payroll", "checker"] as const;
export type ScimMemberRole = (typeof SCIM_MEMBER_ROLES)[number];

export class EnterpriseProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnterpriseProvisioningError";
  }
}

export function parseScimActive(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new EnterpriseProvisioningError("SCIM active must be a JSON boolean (true or false).");
  }
  return value;
}

export function parseScimMemberRole(value: unknown): ScimMemberRole {
  const raw = Array.isArray(value)
    ? (value[0] && typeof value[0] === "object" ? (value[0] as { value?: unknown }).value : undefined)
    : value;
  if (typeof raw !== "string") {
    throw new EnterpriseProvisioningError("SCIM roles must contain an allowed role value.");
  }
  const role = raw.trim().toLowerCase();
  if (!SCIM_MEMBER_ROLES.includes(role as ScimMemberRole)) {
    throw new EnterpriseProvisioningError("SCIM may not provision a privileged or unknown organization role.");
  }
  return role as ScimMemberRole;
}

/**
 * An IdP cannot create a company-wide membership by leaving department blank.
 * Existing company-wide scope can only be retained for an already authorized
 * member whose role stays unchanged; raising privileges requires an admin.
 */
export function scimProvisioningOrgUnit(input: {
  requestedUnitId: number | null;
  requestedRole: ScimMemberRole;
  existingMembership: { role: string; orgUnitId: number | null } | null;
}): number | null {
  if (input.requestedUnitId != null) {
    if (!Number.isSafeInteger(input.requestedUnitId) || input.requestedUnitId <= 0) {
      throw new EnterpriseProvisioningError("SCIM department must map to a valid organization unit.");
    }
    return input.requestedUnitId;
  }
  const existing = input.existingMembership;
  if (existing?.orgUnitId != null) return existing.orgUnitId;
  if (existing && existing.role === input.requestedRole) return null;
  throw new EnterpriseProvisioningError(
    "SCIM cannot grant company-wide scope. Map a department or have an administrator pre-authorize the membership.",
  );
}

/**
 * A global Linaw account may belong to multiple employers. One employer's
 * SCIM connector must not rewrite the account-wide email/name/ESS identity
 * that another employer depends on.
 */
export function assertScimGlobalIdentityChange(input: {
  sharedAcrossOrganizations: boolean;
  emailChanged: boolean;
  nameChanged: boolean;
  employeeLinkChanged: boolean;
}): void {
  if (input.sharedAcrossOrganizations &&
    (input.emailChanged || input.nameChanged || input.employeeLinkChanged)) {
    throw new EnterpriseProvisioningError(
      "This user belongs to another workspace. Change only this workspace's SCIM role, department or active status; global account changes require account administration.",
    );
  }
}

export function shouldRevokeScimSessions(input: {
  activeChanged: boolean;
  roleChanged: boolean;
  orgUnitChanged: boolean;
  workerLinkChanged: boolean;
  emailChanged: boolean;
  nameChanged: boolean;
}): boolean {
  // Rename alone is not authorization; do not log everyone out for a display
  // name correction. Identity, role, scope and worker binding changes are.
  return input.activeChanged || input.roleChanged || input.orgUnitChanged
    || input.workerLinkChanged || input.emailChanged;
}
