export const DEMO_ROLE_IDS = [
  "owner",
  "bookkeeper",
  "payroll",
  "hr",
  "manager",
  "employee",
  "freelancer",
] as const;

export type DemoRoleId = (typeof DEMO_ROLE_IDS)[number];

export type DemoRoleInfo = {
  id: DemoRoleId;
  label: string;
  shortLabel: string;
  person: string;
  description: string;
  access: string[];
  landingPage: string;
};

export const DEMO_ROLES: DemoRoleInfo[] = [
  {
    id: "owner",
    label: "Company owner / admin",
    shortLabel: "Owner",
    person: "Andrea Lim",
    description: "See the company-wide view, settings, payroll, people, compliance and reporting.",
    access: ["Company-wide overview", "Payroll and people", "Settings and audit"],
    landingPage: "Overview",
  },
  {
    id: "bookkeeper",
    label: "Bookkeeper / accountant",
    shortLabel: "Bookkeeper",
    person: "Celine Yao",
    description: "Work across multiple client companies from one payroll workspace.",
    access: ["Multi-client switcher", "Payroll and exports", "Approvals and reporting"],
    landingPage: "Overview",
  },
  {
    id: "payroll",
    label: "Payroll administrator",
    shortLabel: "Payroll",
    person: "Paolo Cruz",
    description: "Focus on cutoff inputs, calculation, exceptions, approvals, release and exports.",
    access: ["Payroll runs", "Time exceptions", "Exports and compliance"],
    landingPage: "Payroll",
  },
  {
    id: "hr",
    label: "HR administrator",
    shortLabel: "HR",
    person: "Aira Villanueva",
    description: "Manage people, attendance, leave, benefits and employee lifecycle work.",
    access: ["People records", "Time and leave", "HR operations"],
    landingPage: "People",
  },
  {
    id: "manager",
    label: "Manager / approver",
    shortLabel: "Manager",
    person: "Mariel Santos",
    description: "Review the team and handle the decisions assigned to a department manager.",
    access: ["Team people view", "Team attendance", "Approvals"],
    landingPage: "Approvals",
  },
  {
    id: "employee",
    label: "Employee self-service",
    shortLabel: "Employee",
    person: "Jonas Reyes",
    description: "Open the employee experience for personal payslips, pay history and time punches.",
    access: ["Own payslips", "Own pay history", "Clock in / out"],
    landingPage: "My pay",
  },
  {
    id: "freelancer",
    label: "Freelancer / self-employed",
    shortLabel: "Freelancer",
    person: "Mika Ramos",
    description: "See the simpler solo workspace for self-employed income and tax planning.",
    access: ["Solo workspace", "Tax planning", "Personal reporting"],
    landingPage: "Freelancer hub",
  },
];

export function isDemoRole(value: string): value is DemoRoleId {
  return (DEMO_ROLE_IDS as readonly string[]).includes(value);
}

export function demoRoleInfo(role: string | null | undefined) {
  return DEMO_ROLES.find((item) => item.id === role);
}


export const DEMO_ROLE_PAGES: Partial<Record<DemoRoleId, readonly string[]>> = {
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
  manager: [
    "People",
    "Time & attendance",
    "Leave",
    "Approvals",
  ],
};

export function demoRolePages(role: DemoRoleId | null | undefined) {
  if (!role) return null;
  return DEMO_ROLE_PAGES[role] ?? null;
}
