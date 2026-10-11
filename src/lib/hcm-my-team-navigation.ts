/**
 * Original My Team workflow links. A link is not authorization: the destination
 * workspace and every action endpoint retain their own role, unit and maker/
 * checker gates.
 */
export const MY_TEAM_WORKFLOW_PAGES = [
  "Leave", "Time & attendance", "Workforce", "Approvals",
] as const;

export type MyTeamWorkflowPage = (typeof MY_TEAM_WORKFLOW_PAGES)[number];

export function myTeamWorkflowHref(
  organizationId: number,
  page: MyTeamWorkflowPage,
): string | null {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
      !(MY_TEAM_WORKFLOW_PAGES as readonly string[]).includes(page)) return null;
  return "/app?organizationId=" + organizationId +
    "&workspacePage=" + encodeURIComponent(page);
}

/** Permit only four source workspaces from My Team, never arbitrary deep links. */
export function requestedMyTeamWorkspacePage(input: {
  requestedPage: string | null;
  role: string | null | undefined;
  companyWide: boolean | null | undefined;
  accountType: string;
  rolePages: readonly string[] | null;
  pilotFocusEnabled: boolean;
  demoMode: boolean;
}): MyTeamWorkflowPage | null {
  const { requestedPage, role, companyWide, accountType, rolePages,
    pilotFocusEnabled, demoMode } = input;
  if (demoMode || accountType === "freelancer" ||
      !["owner", "admin", "hr", "manager"].includes(role ?? "") ||
      (role === "manager" && companyWide !== false) ||
      !MY_TEAM_WORKFLOW_PAGES.some((page) => page === requestedPage) ||
      (rolePages && !rolePages.includes(requestedPage!)) ||
      (pilotFocusEnabled && requestedPage === "Workforce")) return null;

  return requestedPage as MyTeamWorkflowPage;
}
