/**
 * Navigation-only HRIS entry points. This list does not grant permissions:
 * callers must intersect it with the workspace's actual role/plan/pilot menu.
 * Every destination is an existing source-owned workspace page.
 */
export type HrisHomeShortcut = {
  id: string;
  title: string;
  description: string;
  group: "People" | "Operations" | "Talent";
  icon: "people" | "hire" | "leave" | "time" | "documents" | "approvals" | "performance" | "reports";
  page: string;
};

export const HRIS_HOME_SHORTCUTS: readonly HrisHomeShortcut[] = [
  { id: "directory", title: "Employee directory", description: "Find employees and view their authorized records", group: "People", icon: "people", page: "People" },
  { id: "hiring", title: "Hire & onboard", description: "Review candidates, hires and recorded onboarding steps", group: "People", icon: "hire", page: "Recruitment" },
  { id: "documents", title: "Employee documents", description: "Required files and policy acknowledgements", group: "People", icon: "documents", page: "Documents" },
  { id: "leave", title: "Leave requests", description: "Requests, balances and team leave", group: "Operations", icon: "leave", page: "Leave" },
  { id: "attendance", title: "Time & attendance", description: "Time records and exceptions", group: "Operations", icon: "time", page: "Time & attendance" },
  { id: "approvals", title: "Approvals", description: "See pending requests; review and decisions stay in Approvals", group: "Operations", icon: "approvals", page: "Approvals" },
  { id: "performance", title: "Performance", description: "Employee goals and review cycles", group: "Talent", icon: "performance", page: "Performance" },
  { id: "reports", title: "People reports", description: "Headcount, turnover and workforce analysis", group: "Talent", icon: "reports", page: "Analytics" },
];

/**
 * Three HR administration roles receive the hub. Never display a shortcut to
 * a page filtered out by role access, freelancer status, or pilot navigation.
 */
export function hrisHomeShortcutsForRole(
  role: string | null | undefined,
  availablePages: readonly string[],
): HrisHomeShortcut[] {
  if (role !== "owner" && role !== "admin" && role !== "hr") return [];
  const allowed = new Set(availablePages);
  return HRIS_HOME_SHORTCUTS.filter((action) => allowed.has(action.page));
}
