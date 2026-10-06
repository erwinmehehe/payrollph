export const DEMO_ROLE_IDS = [
  "owner",
  "hr",
  "payroll",
  "checker",
  "bookkeeper",
  "employee",
] as const;

export type DemoRoleId = (typeof DEMO_ROLE_IDS)[number];

const DEMO_ROLE_PATHS: Record<DemoRoleId, string> = {
  owner: "/app?demoRole=owner",
  hr: "/app?demoRole=hr",
  payroll: "/app?demoRole=payroll",
  checker: "/app?demoRole=checker",
  bookkeeper: "/app?demoRole=bookkeeper",
  employee: "/app?demoRole=employee",
};

export function demoRolePath(role: DemoRoleId) {
  return DEMO_ROLE_PATHS[role];
}

export type DemoRoleInfo = {
  id: DemoRoleId;
  label: string;
  shortLabel: string;
  person: string;
  description: string;
  access: string[];
  actions: string[];
  landingPage: string;
  tasks: Array<{ id: string; label: string; detail: string; page: string; cta: string }>;
};

export const DEMO_ROLES: DemoRoleInfo[] = [
  {
    id: "owner",
    label: "Owner",
    shortLabel: "Owner",
    person: "Andrea Lim",
    description: "Run the company workspace with visibility across payroll, people, compliance, reporting and settings.",
    access: ["Company-wide overview", "Payroll and people", "Compliance, settings and audit"],
    actions: ["Create a payroll run", "Review company exceptions", "Release an approved payroll"],
    landingPage: "Overview",
    tasks: [
      { id: "owner-review", label: "Review the company", detail: "Open payroll status, exceptions and pending approvals.", page: "Overview", cta: "Open overview" },
      { id: "owner-release", label: "Release approved payroll", detail: "Open the payroll run and release it only after checker approval.", page: "Payroll", cta: "Open payroll" },
      { id: "owner-audit", label: "Verify the audit trail", detail: "Confirm approval and release events were recorded.", page: "Audit trail", cta: "Open audit trail" },
    ],
  },
  {
    id: "hr",
    label: "HR Admin",
    shortLabel: "HR Admin",
    person: "Aira Villanueva",
    description: "Manage employee records, attendance, leave, benefits and payroll-impacting people inputs from the populated sample company.",
    access: ["People records and company overview", "Time, leave and lifecycle work", "Benefits, loans and compliance context"],
    actions: ["Open an employee record", "Review leave and attendance", "Work through lifecycle tasks"],
    landingPage: "Overview",
    tasks: [
      { id: "hr-person", label: "Review an employee 201 file", detail: "Open a populated employee record with statutory and employment details.", page: "People", cta: "Open people" },
      { id: "hr-leave", label: "Review leave", detail: "Inspect the pending leave request and balance context.", page: "Leave", cta: "Open leave" },
      { id: "hr-time", label: "Resolve attendance context", detail: "Inspect punches and exceptions before payroll.", page: "Time & attendance", cta: "Open attendance" },
    ],
  },
  {
    id: "payroll",
    label: "Payroll Officer",
    shortLabel: "Payroll",
    person: "Paolo Cruz",
    description: "Prepare payroll, resolve cutoff inputs and payroll-impacting deductions, then submit the run to an independent checker.",
    access: ["Payroll runs and people context", "Time, benefits, loans and payroll inputs", "Exports, compliance and audit"],
    actions: ["Inspect the live register", "Recalculate the run", "Submit payroll for checker review"],
    landingPage: "Overview",
    tasks: [
      { id: "payroll-register", label: "Inspect the live register", detail: "Open the populated payroll run and review totals and exceptions.", page: "Payroll", cta: "Open payroll" },
      { id: "payroll-recalc", label: "Recalculate safely", detail: "Use the real recalculation action and verify the register refreshes.", page: "Payroll", cta: "Open calculation" },
      { id: "payroll-submit", label: "Send to checker", detail: "Submit the run for independent review. You cannot approve your own run.", page: "Payroll", cta: "Open review step" },
    ],
  },
  {
    id: "checker",
    label: "Checker",
    shortLabel: "Checker",
    person: "Mariel Santos",
    description: "Review assigned payroll and approval items independently from the payroll maker.",
    access: ["Assigned approvals", "Payroll review context", "Compliance checks"],
    actions: ["Open an assigned review", "Approve or decline it", "Confirm the audit trail"],
    landingPage: "Overview",
    tasks: [
      { id: "checker-open", label: "Open assigned payroll review", detail: "Review the maker's submitted payroll and assurance context.", page: "Approvals", cta: "Open approvals" },
      { id: "checker-decide", label: "Approve or decline", detail: "Record an independent decision using the real approval endpoint.", page: "Approvals", cta: "Review decision" },
      { id: "checker-compliance", label: "Check compliance context", detail: "Inspect statutory and year-end controls before approval.", page: "Compliance", cta: "Open compliance" },
    ],
  },
  {
    id: "bookkeeper",
    label: "Bookkeeper",
    shortLabel: "Bookkeeper",
    person: "Bea Navarro",
    description: "Reconcile released payroll, accounting exports, payout evidence and statutory close controls from one finance-focused workspace.",
    access: ["Payroll close and accounting exports", "Payout and reconciliation evidence", "Compliance and statutory reporting context"],
    actions: ["Review payroll close status", "Export the accounting journal", "Inspect statutory liabilities and filing evidence"],
    landingPage: "Overview",
    tasks: [
      { id: "bookkeeper-close", label: "Review payroll close", detail: "Open the accounting workspace and inspect payout, journal and statutory close evidence.", page: "Exports", cta: "Open accounting" },
      { id: "bookkeeper-journal", label: "Export the journal", detail: "Use the real journal export tied to the released payroll run.", page: "Exports", cta: "Open exports" },
      { id: "bookkeeper-compliance", label: "Review filing evidence", detail: "Inspect compliance and filing context without treating prepared output as agency acceptance.", page: "Compliance", cta: "Open compliance" },
    ],
  },
  {
    id: "employee",
    label: "Employee",
    shortLabel: "Employee",
    person: "Jonas Reyes",
    description: "Use employee self-service to follow the upcoming pay stage, view released payslips and record attendance.",
    access: ["Own upcoming pay stage", "Own released payslips and year-to-date pay", "Clock in / out"],
    actions: ["Open a released payslip", "Download the payslip", "Record a demo attendance punch"],
    landingPage: "My pay",
    tasks: [
      { id: "employee-payslip", label: "Open a released payslip", detail: "Expand a real released payslip from your own employee record.", page: "My pay", cta: "Open payslip" },
      { id: "employee-download", label: "Download your payslip", detail: "Use the real self-service payslip PDF endpoint.", page: "My pay", cta: "View pay history" },
      { id: "employee-punch", label: "Record attendance", detail: "Open Web Bundy and submit a demo clock punch.", page: "My pay", cta: "Open Web Bundy" },
    ],
  },
];

export function isDemoRole(value: string): value is DemoRoleId {
  return (DEMO_ROLE_IDS as readonly string[]).includes(value);
}

export function demoRoleInfo(role: string | null | undefined) {
  return DEMO_ROLES.find((item) => item.id === role);
}

export const DEMO_ROLE_PAGES: Partial<Record<DemoRoleId, readonly string[]>> = {
  owner: [
    "Overview",
    "Payroll",
    "People",
    "Planning",
    "Compensation",
    "Migration",
    "Time & attendance",
    "Workforce",
    "Leave",
    "Approvals",
    "Analytics",
    "Exports",
    "Compliance",
    "Loans",
    "Benefits",
    "De minimis",
    "Expenses",
    "Earned wage",
    "Recruitment",
    "Performance",
    "Discipline",
    "Separation",
    "Contractors",
    "Assets",
    "Integrations",
    "Developer",
    "Enterprise",
    "Readiness",
    "Audit trail",
    "Settings",
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
    "De minimis",
    "Expenses",
    "Recruitment",
    "Performance",
    "Discipline",
    "Separation",
    "Assets",
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
    "Readiness",
    "Audit trail",
    "Enterprise",
  ],
};

export function demoRolePages(role: DemoRoleId | null | undefined) {
  if (!role) return null;
  return DEMO_ROLE_PAGES[role] ?? null;
}
