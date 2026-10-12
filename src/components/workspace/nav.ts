import {
  AlertCircle,
  BadgeDollarSign,
  Banknote,
  BriefcaseBusiness,
  CalendarDays,
  Calculator,
  ClipboardCheck,
  Clock3,
  CloudCog,
  CreditCard,
  FileBarChart2,
  FileText,
  Globe,
  Gauge,
  HandCoins,
  LayoutDashboard,
  Package,
  Trophy,
  ReceiptText,
  RefreshCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  CircleDollarSign,
  UploadCloud,
  UserPlus,
  UsersRound,
  UserX,
  WalletCards,
  Webhook,
  Workflow,
  type LucideIcon,
} from "lucide-react";

/** Icon hues. Each maps to a `.t-*` class in the stylesheet. */
export type NavTone = "green" | "blue" | "amber" | "red" | "purple" | "cyan" | "teal" | "pink" | "slate";

export type NavItem = {
  /** Stable page key, also the label shown in the sidebar and breadcrumb. */
  name: string;
  icon: LucideIcon;
  /** Short line used by the command palette. */
  hint: string;
  /** Icon colour, so a destination is recognisable before the label is read. */
  tone: NavTone;
  /** Live badge source, resolved by the shell against real data. */
  badge?: "approvals" | "people" | "runs" | "api";
};

export type NavGroup = { label: string; items: NavItem[] };

/**
 * The workspace information architecture. Order and grouping are the
 * navigation contract, the command palette, breadcrumbs and the mobile drawer
 * all read this same list so they can never disagree with the sidebar.
 */
export const NAVIGATION: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { name: "Overview", icon: LayoutDashboard, hint: "Payroll status, approvals and cost at a glance", tone: "blue" },
      { name: "Payroll", icon: WalletCards, hint: "Prepare, approve, release and export a run", tone: "green", badge: "runs" },
      { name: "People", icon: UsersRound, hint: "Employee directory, import and structure", tone: "purple", badge: "people" },
      { name: "Migration", icon: RefreshCcw, hint: "Switch from another payroll or HRIS with validated imports", tone: "teal" },
      { name: "Time & attendance", icon: Clock3, hint: "Punches, exceptions and derived hours", tone: "cyan" },
      { name: "Workforce", icon: CalendarDays, hint: "Rotations, roster assignments and rest-day overrides", tone: "teal" },
      { name: "Planning", icon: BriefcaseBusiness, hint: "Job architecture, positions, headcount plans and incumbents", tone: "purple" },
      { name: "Compensation", icon: BadgeDollarSign, hint: "Salary bands, review budgets and governed pay changes", tone: "green" },
      { name: "Leave", icon: CalendarDays, hint: "Leave requests and balances", tone: "pink" },
      { name: "Approvals", icon: ClipboardCheck, hint: "Decisions assigned to you or your delegates", tone: "amber", badge: "approvals" },
    ],
  },
  {
    label: "Operate",
    items: [
      { name: "Analytics", icon: FileBarChart2, hint: "Headcount, cost, turnover and exception reports", tone: "blue" },
      { name: "Exports", icon: UploadCloud, hint: "Bank files, journals and government worksheets", tone: "teal" },
      { name: "Compliance", icon: ShieldCheck, hint: "Statutory rulebook, advisories and year-end", tone: "green" },
      { name: "Loans", icon: Banknote, hint: "Salary loans and amortisation", tone: "amber" },
      { name: "Benefits", icon: HandCoins, hint: "Plans and enrolments that deduct on the next run", tone: "pink" },
      { name: "Documents", icon: FileText, hint: "Policy versions, acknowledgements and employee document compliance", tone: "purple" },
      { name: "De minimis", icon: Sparkles, hint: "Tax-exempt allowances and ceilings", tone: "purple" },
      { name: "Expenses", icon: ReceiptText, hint: "Reimbursement claims", tone: "cyan" },
      { name: "Earned wage", icon: CircleDollarSign, hint: "Earned-wage advances", tone: "green" },
      { name: "Recruitment", icon: UserPlus, hint: "Pipeline and offers", tone: "blue" },
      { name: "Performance", icon: Trophy, hint: "Review cycles, employee goals and manager assessments", tone: "purple" },
      { name: "Discipline", icon: AlertCircle, hint: "Disciplinary cases", tone: "red" },
      { name: "Separation", icon: UserX, hint: "Offboarding and final pay", tone: "red" },
      { name: "Contractors", icon: Globe, hint: "Non-employee engagements", tone: "teal" },
      { name: "Assets", icon: Package, hint: "Issued equipment", tone: "amber" },
      { name: "Freelancer hub", icon: Calculator, hint: "8% flat vs graduated tax planner", tone: "purple" },
    ],
  },
  {
    label: "Manage",
    items: [
      { name: "Integrations", icon: CloudCog, hint: "Email provider, accounting and bank connections", tone: "cyan" },
      { name: "Developer", icon: Webhook, hint: "API keys, webhooks and delivery log", tone: "slate", badge: "api" },
      { name: "Automation", icon: Workflow, hint: "Build governed WHEN / IF / THEN workflows across HCM, workforce and payroll", tone: "purple" },
      { name: "Enterprise", icon: ShieldCheck, hint: "Legal employers, SSO, SCIM, permissions and session policy", tone: "purple" },
      { name: "Readiness", icon: Gauge, hint: "Launch evidence, external proof and scale gates", tone: "amber" },
      { name: "Pricing", icon: CreditCard, hint: "Plans, seats and invoices", tone: "green" },
      { name: "Audit trail", icon: ReceiptText, hint: "Every recorded action, exportable", tone: "slate" },
      { name: "Settings", icon: Settings2, hint: "Organization, security and privacy", tone: "slate" },
    ],
  },
];

/** Pages a freelancer (solo) workspace does not have. Mirrors the server's capability flags. */
export const FREELANCER_HIDDEN = new Set([
  "People",
  "Migration",
  "Payroll",
  "Time & attendance",
  "Workforce",
  "Planning",
  "Leave",
  "Approvals",
  "Developer",
  "Enterprise",
  "Automation",
  "Readiness",
  "Benefits",
  "Documents",
  "Loans",
  "Discipline",
  "Recruitment",
  "Performance",
  "Separation",
  "Contractors",
  "Assets",
  "Exports",
]);

export const ALL_ITEMS: NavItem[] = NAVIGATION.flatMap((group) => group.items);

export function groupOf(page: string) {
  return NAVIGATION.find((group) => group.items.some((item) => item.name === page))?.label ?? "Workspace";
}

export function itemOf(page: string) {
  return ALL_ITEMS.find((item) => item.name === page);
}
