export const ROLE_PRIMARY_PAGES: Partial<Record<string, readonly string[]>> = {
  owner: ["Overview", "Payroll", "People", "Time & attendance", "Leave", "Approvals", "Analytics"],
  admin: ["Overview", "Payroll", "People", "Time & attendance", "Leave", "Approvals", "Analytics"],
  bookkeeper: ["Overview", "Payroll", "Exports", "Compliance", "Analytics", "Audit trail"],
  hr: ["Overview", "People", "Time & attendance", "Leave", "Approvals", "Analytics"],
  payroll: ["Overview", "Payroll", "People", "Time & attendance", "Approvals", "Analytics"],
  checker: ["Overview", "Approvals", "Audit trail"],
  manager: ["Overview", "Approvals", "Planning", "Performance", "Analytics"],
  group_hr: ["Overview", "People", "Analytics"],
};

export const REAL_ROLE_PAGE_ACCESS: Partial<Record<string, readonly string[]>> = {
  group_hr: ["Overview", "People", "Analytics", "Entities"],
  hr: [
    "Overview",
    "People",
    "Planning",
    "Compensation",
    "Time & attendance",
    "Workforce",
    "Leave",
    "Approvals",
    "Analytics",
    "Compliance",
    "Loans",
    "Benefits",
    "Documents",
    "De minimis",
    "Expenses",
    "Recruitment",
    "Performance",
    "Discipline",
    "Separation",
    "Assets",
  ],
  payroll: [
    "Overview",
    "Payroll",
    "People",
    "Time & attendance",
    "Approvals",
    "Analytics",
    "Exports",
    "Compliance",
    "Loans",
    "Benefits",
    "De minimis",
    "Expenses",
    "Audit trail",
  ],
  checker: [
    "Overview",
    "Approvals",
    "Compliance",
    "Audit trail",
  ],
  bookkeeper: [
    "Overview",
    "Payroll",
    "Planning",
    "Workforce",
    "Exports",
    "Compliance",
    "Analytics",
    "Readiness",
    "Audit trail",
    "Enterprise",
    "Automation",
    "Documents",
  ],
};

const PAYROLL_OPERATOR_UI_ROLES = new Set(["owner", "admin", "bookkeeper", "payroll"]);
const PEOPLE_ADMIN_UI_ROLES = new Set(["owner", "admin", "bookkeeper", "hr"]);
const TIME_ADMIN_UI_ROLES = new Set(["owner", "admin", "bookkeeper", "hr"]);
const APPROVAL_DECISION_UI_ROLES = new Set(["owner", "admin", "bookkeeper", "hr", "manager", "checker"]);
const DELEGATION_UI_ROLES = new Set(["owner", "admin", "manager", "checker"]);

export function workspacePagesForRole(role: string | null | undefined) {
  if (!role) return null;
  return REAL_ROLE_PAGE_ACCESS[role] ?? null;
}

export function workspacePrimaryPagesForRole(role: string | null | undefined) {
  if (!role) return null;
  return ROLE_PRIMARY_PAGES[role] ?? null;
}

/** Match People workspace links to the sidebar's role page entitlement.
 * Read/write endpoints must still enforce their own source permissions.
 */
export function roleHasPeopleWorkspace(role: string | null | undefined): boolean {
  if (!role) return false;
  const pages = workspacePagesForRole(role);
  return pages ? pages.includes("People") : role === "owner" || role === "admin";
}

export function roleCanManagePayroll(role: string | null | undefined) {
  return Boolean(role && PAYROLL_OPERATOR_UI_ROLES.has(role));
}

export function roleCanManagePeople(role: string | null | undefined) {
  return Boolean(role && PEOPLE_ADMIN_UI_ROLES.has(role));
}

export function roleCanManageTime(role: string | null | undefined) {
  return Boolean(role && TIME_ADMIN_UI_ROLES.has(role));
}

export function roleCanDecideApprovals(role: string | null | undefined) {
  return Boolean(role && APPROVAL_DECISION_UI_ROLES.has(role));
}

export function roleCanManageDelegations(role: string | null | undefined) {
  return Boolean(role && DELEGATION_UI_ROLES.has(role));
}
