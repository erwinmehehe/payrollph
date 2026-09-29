export const DEMO_ROLE_IDS = [
  "owner",
  "hr",
  "payroll",
  "checker",
  "employee",
] as const;

export type DemoRoleId = (typeof DEMO_ROLE_IDS)[number];

export type DemoRoleInfo = {
  id: DemoRoleId;
  label: string;
  shortLabel: string;
  person: string;
  description: string;
  access: string[];
  actions: string[];
  landingPage: string;
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
  },
  {
    id: "hr",
    label: "HR Admin",
    shortLabel: "HR Admin",
    person: "Aira Villanueva",
    description: "Manage employee records, attendance, leave, benefits and lifecycle work from the populated sample company.",
    access: ["People records", "Time and leave", "HR operations and benefits"],
    actions: ["Open an employee record", "Review leave and attendance", "Work through lifecycle tasks"],
    landingPage: "People",
  },
  {
    id: "payroll",
    label: "Payroll Officer",
    shortLabel: "Payroll",
    person: "Paolo Cruz",
    description: "Prepare payroll, resolve cutoff inputs, recalculate and submit the run to an independent checker.",
    access: ["Payroll runs", "Time exceptions", "Exports and compliance"],
    actions: ["Inspect the live register", "Recalculate the run", "Submit payroll for checker review"],
    landingPage: "Payroll",
  },
  {
    id: "checker",
    label: "Checker",
    shortLabel: "Checker",
    person: "Mariel Santos",
    description: "Review assigned payroll and approval items independently from the payroll maker.",
    access: ["Assigned approvals", "Payroll review context", "Compliance checks"],
    actions: ["Open an assigned review", "Approve or decline it", "Confirm the audit trail"],
    landingPage: "Approvals",
  },
  {
    id: "employee",
    label: "Employee",
    shortLabel: "Employee",
    person: "Jonas Reyes",
    description: "Use employee self-service for personal pay history, released payslips and attendance punches.",
    access: ["Own payslips", "Own year-to-date pay", "Clock in / out"],
    actions: ["Open a released payslip", "Download the payslip", "Record a demo attendance punch"],
    landingPage: "My pay",
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
    "Migration",
    "Time & attendance",
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
    "Discipline",
    "Separation",
    "Contractors",
    "Assets",
    "Integrations",
    "Developer",
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
    "Audit trail",
  ],
  hr: [
    "People",
    "Time & attendance",
    "Leave",
    "Approvals",
    "Analytics",
    "Benefits",
    "Expenses",
    "Recruitment",
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
};

export function demoRolePages(role: DemoRoleId | null | undefined) {
  if (!role) return null;
  return DEMO_ROLE_PAGES[role] ?? null;
}
