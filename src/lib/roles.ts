export const INVITABLE_ROLES = [
  { id: "owner", label: "Owner" },
  { id: "admin", label: "Administrator" },
  { id: "hr", label: "HR Admin" },
  { id: "bookkeeper", label: "Bookkeeper" },
  { id: "payroll", label: "Payroll Officer" },
  { id: "checker", label: "Checker" },
  { id: "employee", label: "Employee" },
] as const;

export type InvitableRoleId = (typeof INVITABLE_ROLES)[number]["id"];

const INVITABLE_ROLE_IDS = new Set<string>(INVITABLE_ROLES.map((role) => role.id));

export function isInvitableRole(value: string): value is InvitableRoleId {
  return INVITABLE_ROLE_IDS.has(value);
}

export function invitableRoleLabel(value: string) {
  return INVITABLE_ROLES.find((role) => role.id === value)?.label ?? value;
}
