import {
  AlertCircle,
  Banknote,
  CalendarDays,
  Calculator,
  ClipboardCheck,
  Clock3,
  CloudCog,
  CreditCard,
  FileBarChart2,
  Globe,
  HandCoins,
  LayoutDashboard,
  Package,
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
  type LucideIcon,
} from "lucide-react";

export type NavTone = "green" | "blue" | "amber" | "red" | "purple" | "cyan" | "teal" | "pink" | "slate";

export type NavItem = {
  name: string;
  icon: LucideIcon;
  hint: string;
  tone: NavTone;
  badge?: "approvals" | "people" | "runs" | "api";
};

export type NavGroup = { label: string; items: NavItem[] };

export const PRIMARY_NAVIGATION: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { name: "Overview", icon: LayoutDashboard, hint: "Payroll status, blockers and next actions", tone: "blue" },
      { name: "People", icon: UsersRound, hint: "Employee records, payout details and structure", tone: "purple", badge: "people" },
      { name: "Payroll", icon: WalletCards, hint: "Prepare, approve, release and recover payroll", tone: "green", badge: "runs" },
      { name: "Time & attendance", icon: Clock3, hint: "Punches, exceptions and derived hours", tone: "cyan" },
      { name: "Approvals", icon: ClipboardCheck, hint: "Payroll decisions assigned to you or your delegates", tone: "amber", badge: "approvals" },
      { name: "Analytics", icon: FileBarChart2, hint: "Payroll, headcount and exception reports", tone: "blue" },
      { name: "Settings", icon: Settings2, hint: "Organization, team access and security", tone: "slate" },
    ],
  },
];

export const SECONDARY_NAVIGATION: NavGroup[] = [
  {
    label: "Payroll tools",
    items: [
      { name: "Migration", icon: RefreshCcw, hint: "Switch from another payroll or HRIS with validated imports", tone: "teal" },
      { name: "Leave", icon: CalendarDays, hint: "Leave requests and balances", tone: "pink" },
      { name: "Exports", icon: UploadCloud, hint: "Bank files, journals and government worksheets", tone: "teal" },
      { name: "Compliance", icon: ShieldCheck, hint: "Statutory rulebook, advisories and year-end", tone: "green" },
      { name: "Loans", icon: Banknote, hint: "Salary loans and amortisation", tone: "amber" },
      { name: "Benefits", icon: HandCoins, hint: "Plans and enrolments that deduct on payroll", tone: "pink" },
      { name: "De minimis", icon: Sparkles, hint: "Tax-exempt allowances and ceilings", tone: "purple" },
      { name: "Expenses", icon: ReceiptText, hint: "Reimbursement claims", tone: "cyan" },
      { name: "Earned wage", icon: CircleDollarSign, hint: "Earned-wage advances", tone: "green" },
    ],
  },
  {
    label: "People tools",
    items: [
      { name: "Recruitment", icon: UserPlus, hint: "Pipeline and offers", tone: "blue" },
      { name: "Discipline", icon: AlertCircle, hint: "Disciplinary cases", tone: "red" },
      { name: "Separation", icon: UserX, hint: "Offboarding and final pay", tone: "red" },
      { name: "Contractors", icon: Globe, hint: "Non-employee engagements", tone: "teal" },
      { name: "Assets", icon: Package, hint: "Issued equipment", tone: "amber" },
      { name: "Freelancer hub", icon: Calculator, hint: "8% flat vs graduated tax planner", tone: "purple" },
    ],
  },
  {
    label: "Administration",
    items: [
      { name: "Integrations", icon: CloudCog, hint: "Email provider, accounting and bank connections", tone: "cyan" },
      { name: "Developer", icon: Webhook, hint: "API keys, webhooks and delivery log", tone: "slate", badge: "api" },
      { name: "Pricing", icon: CreditCard, hint: "Plans, seats and invoices", tone: "green" },
      { name: "Audit trail", icon: ReceiptText, hint: "Every recorded action, exportable", tone: "slate" },
    ],
  },
];

export const NAVIGATION: NavGroup[] = [...PRIMARY_NAVIGATION, ...SECONDARY_NAVIGATION];

export const FREELANCER_HIDDEN = new Set([
  "People",
  "Migration",
  "Payroll",
  "Time & attendance",
  "Leave",
  "Approvals",
  "Developer",
  "Benefits",
  "Loans",
  "Discipline",
  "Recruitment",
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
