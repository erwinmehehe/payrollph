import { canOpenPeopleHome } from "@/lib/hcm-people-home-scope";
import { roleCanManagePeople, roleHasPeopleWorkspace } from "@/lib/workspace-role-ui";

/** Canonical, positive, safe IDs only. Never infer an employer or worker. */
function positiveId(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * A People Home source link is navigation, not permission to read or update
 * an employee. The selected-employer workspace and source APIs enforce RBAC.
 */
export function peopleEmployeeFocusHref(
  organizationId: number, employeeId: number,
): string | null {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
      !Number.isSafeInteger(employeeId) || employeeId <= 0) return null;
  return "/app?organizationId=" + organizationId +
    "&workspacePage=People&focusEmployeeId=" + employeeId;
}

/**
 * Resolve a handoff only from the currently authorized employer snapshot.
 * Reject stale employer links even if two tenants have the same worker number.
 * No employee discovery or lookup is performed from an untrusted URL.
 */
export function resolvePeopleEmployeeFocus(input: {
  requestedPage: string | null;
  requestedOrganizationId: string | null;
  requestedEmployeeId: string | null;
  selectedOrganizationId: number;
  access: { role: string; companyWide: boolean } | null | undefined;
  authorizedEmployees: readonly { id: number }[];
  demoMode: boolean;
}): number | null {
  if (input.demoMode || input.requestedPage !== "People") return null;
  if (!canOpenPeopleHome(input.access) ||
      !roleCanManagePeople(input.access?.role) ||
      !roleHasPeopleWorkspace(input.access?.role)) return null;

  const tenantId = positiveId(input.requestedOrganizationId);
  const employeeId = positiveId(input.requestedEmployeeId);
  if (tenantId === null || tenantId !== input.selectedOrganizationId ||
      employeeId === null) return null;

  return input.authorizedEmployees.some((person) =>
    person.id === employeeId && Number.isSafeInteger(person.id) && person.id > 0)
    ? employeeId : null;
}
