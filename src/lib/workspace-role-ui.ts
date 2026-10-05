export const ROLE_PRIMARY_PAGES: Partial<Record<string, readonly string[]>> = {
  owner: ["Overview", "Payroll", "Analytics", "People", "Settings"],
  admin: ["Overview", "Payroll", "Exports", "Compliance", "Analytics", "Settings"],
  bookkeeper: ["Overview", "Exports", "Compliance", "Analytics"],
  hr: ["Overview", "People", "Workforce", "Time & attendance", "Leave", "Recruitment", "Performance"],
  payroll: ["Overview", "Payroll", "Time & attendance", "People"],
  checker: ["Overview", "Audit trail"],
  manager: ["Overview", "Approvals", "Analytics"],
};

export const REAL_ROLE_PAGE_ACCESS: Partial<Record<string, readonly string[]>> = {
  hr: [
    "Overview",
    "People",
    "Time & attendance",
    "Workforce",
    "Leave",
    "Approvals",
    "Analytics",
    "Compliance",
    "Loans",
    "Benefits",
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
    "Workforce",
    "Exports",
    "Compliance",
    "Analytics",
    "Audit trail",
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
