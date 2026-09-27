"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  Calculator,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  CloudCog,
  CreditCard,
  Download,
  Eye,
  FileBarChart2,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Gauge,
  HandCoins,
  HeartPulse,
  HelpCircle,
  Layers3,
  LayoutDashboard,
  LifeBuoy,
  LockKeyhole,
  LogOut,
  Mail,
  MoreHorizontal,
  PanelLeftClose,
  PiggyBank,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  UserCheck,
  UsersRound,
  WalletCards,
  Webhook,
  X,
  Package,
  Globe,
  AlertCircle,
  Banknote,
  Clock,
  UserPlus,
  UserX,
} from "lucide-react";
import { ImportPanel } from "@/components/import-panel";
import { BenefitsPanel } from "@/components/benefits-panel";
import { ContractorsPanel } from "@/components/contractors-panel";
import { AssetsPanel } from "@/components/assets-panel";
import { ExpensesPanel, EwaPanel } from "@/components/wallet-panel";
import { NewHireModal } from "@/components/new-hire-modal";
import { AccountPanel } from "@/components/account-panel";
import { DeMinimisPanel } from "@/components/de-minimis-panel";
import { WebBundyModal } from "@/components/web-bundy-modal";
import { LoansPanel } from "@/components/loans-panel";
import { DisciplinePanel } from "@/components/discipline-panel";
import { RecruitmentPanel } from "@/components/recruitment-panel";
import { SeparationPanel } from "@/components/separation-panel";

type Organization = { id: number; name: string; legalName: string; accountType: string; plan: string; payrollServiceMode?: string; payrollAnnualDivisor: string; statutoryDeductionMode?: string; employeeCount: number; color: string };
type Employee = { id: number; employeeNo: string; firstName: string; lastName: string; title: string; employmentType: string; status: string; avatarInitials: string; basicRate: string; mwe: boolean; region?: string };
type PayrollRun = { id: number; periodLabel: string; periodStart?: string; periodEnd?: string; scopeLabel: string; scopeOrgUnitId?: number | null; calculationMode?: string; serviceMode?: string; reviewStage?: string; status: string; payDate: string; employeeCount: number; grossPay: string; netPay: string; exceptions: number; ruleVersion: string; processedChunks?: number; totalChunks?: number };
type PayrollEntry = { id: number; employeeId: number; grossPay: string; deductions: string; netPay: string; status: string; trace: any; lineItems?: any };
type Task = { id: number; title: string; detail: string; approver: string; dueLabel: string; priority: string; status: string };
type AuditEvent = { id: number; actor: string; action: string; resource: string; metadata: any; createdAt: Date };
type PricingPlan = { id: number; name: string; monthlyBase: string; perEmployee: string; modules: any; version: string };
type Advisory = { id: number; advisoryNumber: string; policy: string; startDate: string; endDate: string; affectedUnit: string; active: boolean; premiumPercent?: number };
type BankTemplate = { id: number; name: string; version: string; format: string };
type Punch = { id: number; employeeId: number; workDate: string; status: string; timeIn: Date | string | null; timeOut: Date | string | null };
type Delegation = { id: number; fromApprover: string; toApprover: string; reason: string; startsOn: string; endsOn: string; active: boolean };
type User = { id: number; email: string; name: string; role: string; totpEnabled: boolean };
type Freelancer = { monthlyIncome: string; annualExpenses: string; filingMethod: string; nextDueDate: string } | null;
type DashboardData = {
  user: User | null;
  organizations: Organization[];
  selectedOrganization: Organization;
  employees: Employee[];
  payrollRuns: PayrollRun[];
  payrollEntries: PayrollEntry[];
  payrollJobs?: Array<{ id: number; status: string; chunkIndex: number }>;
  tasks: Task[];
  auditEvents: AuditEvent[];
  plans: PricingPlan[];
  templates: BankTemplate[];
  advisories: Advisory[];
  punches?: Punch[];
  delegations?: Delegation[];
  leaveRequests?: Array<{ id: number; employeeId: number; leaveType: string; startDate: string; endDate: string; days: string; status: string }>;
  orgUnits?: Array<{ id: number; name: string; type: string }>;
  access?: { companyWide: boolean; orgUnitName: string | null; role: string } | null;
  capabilities?: { orgStructure: boolean; payroll: boolean; approvals: boolean; multiBranch: boolean; developer: boolean };
  provisioning?: Array<{ id: number; employeeId: number; kind: string; title: string; owner: string; done: boolean }>;
  freelancer: Freelancer;
  security?: {
    passwordAuth: boolean;
    totp: string;
    totpMandatory: boolean;
    sessions: string;
    rateLimit: string;
    sso: string;
  };
};

const pesos = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
const compactPesos = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", notation: "compact", maximumFractionDigits: 1 });
const money = (value: number | string) => pesos.format(Number(value));
const shortMoney = (value: number | string) => compactPesos.format(Number(value));

const navigation = [
  {
    label: "WORKSPACE",
    items: [
      { name: "Overview", icon: LayoutDashboard },
      { name: "People", icon: UsersRound, badge: "8" },
      { name: "Payroll", icon: WalletCards, badge: "2" },
      { name: "Time & attendance", icon: Clock3 },
      { name: "Leave", icon: CalendarDays },
    ],
  },
  {
    label: "OPERATE",
    items: [
      { name: "Approvals", icon: ClipboardCheck, badge: "3" },
      { name: "Loans", icon: Banknote },
      { name: "Discipline", icon: AlertCircle },
      { name: "Recruitment", icon: UserPlus },
      { name: "Separation", icon: UserX },
      { name: "Compliance", icon: ShieldCheck },
      { name: "De minimis", icon: Sparkles },
      { name: "Benefits", icon: HandCoins },
      { name: "Contractors", icon: Globe },
      { name: "Assets", icon: Package },
      { name: "Expenses", icon: ReceiptText },
      { name: "Earned wage", icon: CircleDollarSign },
      { name: "Freelancer hub", icon: Calculator },
      { name: "Reports", icon: FileBarChart2 },
    ],
  },
  {
    label: "MANAGE",
    items: [
      { name: "Integrations", icon: CloudCog },
      { name: "Developer", icon: Webhook, badge: "API" },
      { name: "Pricing", icon: CreditCard },
      { name: "Audit trail", icon: ReceiptText },
      { name: "Settings", icon: Settings2 },
    ],
  },
];

export function LinawWorkspace({ initialData, demoMode = false }: { initialData: DashboardData; demoMode?: boolean }) {
  const [data, setData] = useState(initialData);
  const [page, setPage] = useState("Overview");
  const [organizationOpen, setOrganizationOpen] = useState(false);
  const [roleSwitcherOpen, setRoleSwitcherOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(true);
  const [newPayrollOpen, setNewPayrollOpen] = useState(false);
  const [outboxOpen, setOutboxOpen] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<PricingPlan | null>(null);
  const [inspectEntry, setInspectEntry] = useState<PayrollEntry | null>(null);
  const [govModalOpen, setGovModalOpen] = useState(false);
  const [newHireOpen, setNewHireOpen] = useState(false);
  const [webBundyOpen, setWebBundyOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const currentRun = data.payrollRuns.find((run) => !["Released"].includes(run.status)) ?? data.payrollRuns[0];
  const openTasks = data.tasks.filter((task) => task.status === "Pending");
  const userName = data.user?.name ?? "Celine Yao";
  const initials = userName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  async function refresh(organizationId = data.selectedOrganization.id) {
    const response = await fetch(`/api/dashboard?organizationId=${organizationId}`, { cache: "no-store" });
    if (!response.ok) throw new Error("refresh failed");
    setData((await response.json()) as DashboardData);
  }

  async function changeOrganization(id: number) {
    setOrganizationOpen(false);
    try {
      await refresh(id);
      setPage("Overview");
      setNotice("Company context updated from the shared bookkeeper portfolio.");
    } catch {
      setNotice("Could not switch company. Please try again.");
    }
  }

  async function switchDemoRole(role: "bookkeeper" | "employee" | "freelancer") {
    setRoleSwitcherOpen(false);
    try {
      const response = await fetch("/api/auth/demo-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (response.ok) {
        window.location.href = "/";
      }
    } catch {
      setNotice("Role switch failed.");
    }
  }

  async function decideTask(id: number, status: "Approved" | "Declined") {
    const response = await fetch(`/api/approvals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "That decision could not be saved.");
      return;
    }
    setData((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === id ? { ...task, status } : task) }));
    setNotice(payload.decidedOnBehalfOf
      ? `Approval ${status.toLowerCase()} on behalf of ${payload.decidedOnBehalfOf} — delegation recorded in audit trail.`
      : `Approval ${status.toLowerCase()} and recorded in audit trail.`);
  }

  async function createPayroll(input: { periodStart: string; periodEnd: string; payDate: string; scopeOrgUnitId: number | null; calculationMode: "fixed_salary" | "timekeeping" }) {
    setBusy(true);
    try {
      const response = await fetch("/api/payroll-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, organizationId: data.selectedOrganization.id, processNow: true }),
      });
      if (!response.ok) {
        setNotice("Payroll could not be created.");
        return;
      }
      await refresh();
      setNewPayrollOpen(false);
      setPage("Payroll");
      setNotice("Payroll draft queued and processed through the SKIP LOCKED background queue.");
    } finally {
      setBusy(false);
    }
  }

  async function processRun(runId: number) {
    setBusy(true);
    try {
      const response = await fetch(`/api/payroll-runs/${runId}/process`, { method: "POST" });
      if (!response.ok) {
        setNotice("Payroll processing failed.");
        return;
      }
      await refresh();
      setNotice("Payroll chunk worker finished. Register and payslips updated.");
    } finally {
      setBusy(false);
    }
  }

  async function approveRun(runId: number) {
    setBusy(true);
    try {
      const response = await fetch(`/api/payroll-runs/${runId}/approve`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return setNotice(payload.error ?? "Approval failed.");
      await refresh();
      setNotice(payload.run?.serviceMode === "managed" ? "Client approval recorded. Payroll is now eligible for authorized release." : "Payroll approved.");
    } finally { setBusy(false); }
  }

  async function releaseRun(runId: number) {
    const run = data.payrollRuns.find((item) => item.id === runId);
    let acknowledgeExceptions = false;
    if ((run?.exceptions ?? 0) > 0) {
      if (!window.confirm(`This payroll still has ${run?.exceptions ?? 0} exception(s). Releasing it will finalize payroll despite those exceptions. Continue?`)) return;
      acknowledgeExceptions = true;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/payroll-runs/${runId}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledgeExceptions }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setNotice(payload.error ?? "Release failed.");
        return;
      }
      await refresh();
      setNotice(`Payroll officially released. ${payload.employeesNotified ?? 0} payslip-ready email notifications queued in outbox.`);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <div className={`app-shell ${sideOpen ? "" : "app-shell-collapsed"}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark"><span>sa</span></div>
          <div><strong>linaw</strong><span className="brand-subtitle">people, paid right</span></div>
          <button className="sidebar-collapse" onClick={() => setSideOpen(false)} aria-label="Collapse sidebar"><PanelLeftClose size={16} /></button>
        </div>
        <div className="workspace-label"><span className="pulse-dot" />BOOKKEEPER WORKSPACE</div>
        <nav className="side-navigation" aria-label="Main navigation">
          {navigation.map((group) => {
            const hidden = new Set<string>();
            if (data.selectedOrganization.accountType === "freelancer") {
              ["People", "Payroll", "Time & attendance", "Leave", "Approvals", "Developer", "Benefits"].forEach((name) => hidden.add(name));
            }
            const items = group.items.filter((item) => !hidden.has(item.name));
            if (!items.length) return null;
            return (
              <div className="nav-group" key={group.label}>
                <p>{group.label}</p>
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = page === item.name;
                  return (
                    <button key={item.name} onClick={() => setPage(item.name)} className={`nav-item ${active ? "active" : ""}`}>
                      <Icon size={17} strokeWidth={active ? 2.3 : 1.8} />
                      <span>{item.name}</span>
                      {item.badge && <b>{item.name === "Approvals" ? openTasks.length : item.badge}</b>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={logout}><LogOut size={17} /><span>Sign out</span></button>
          <div className="side-profile">
            <div className="avatar avatar-mint">{initials}</div>
            <div><strong>{userName}</strong><span>{data.user?.role ?? "bookkeeper"}</span></div>
            <MoreHorizontal size={17} />
          </div>
        </div>
      </aside>

      <div className="app-main">
        {demoMode && (
          <div className="demo-workspace-banner" role="status">
            <div>
              <strong>Public demo workspace</strong>
              <span>Sample data only. Real payouts, invitations, API keys, webhooks, billing, and account changes are disabled.</span>
            </div>
            <div className="demo-workspace-actions">
              <a href="/welcome" className="secondary-button">Back to website</a>
              <a href="/book-demo" className="secondary-button">Book demo</a>
              <a href="/signup" className="primary-button">Create account</a>
            </div>
          </div>
        )}
        <header className="topbar">
          {!sideOpen && <button className="icon-button mobile-menu" onClick={() => setSideOpen(true)} aria-label="Open navigation"><Layers3 size={18} /></button>}
          
          <div className="company-switcher-wrap">
            <button className="company-switcher" onClick={() => setOrganizationOpen(!organizationOpen)}>
              <span className="company-logo" style={{ backgroundColor: data.selectedOrganization.color }}>{data.selectedOrganization.name.slice(0, 1)}</span>
              <span><strong>{data.selectedOrganization.name}</strong><small>{data.selectedOrganization.plan} Plan · {data.selectedOrganization.accountType === "freelancer" ? "Solo" : `${data.employees.length} people`}</small></span>
              <ChevronDown size={15} />
            </button>
            {organizationOpen && (
              <div className="company-popover">
                <p>CLIENT PORTFOLIO <span>{data.organizations.length} accounts</span></p>
                {data.organizations.map((organization) => (
                  <button key={organization.id} onClick={() => changeOrganization(organization.id)} className={organization.id === data.selectedOrganization.id ? "selected" : ""}>
                    <span className="company-logo small" style={{ backgroundColor: organization.color }}>{organization.name.slice(0, 1)}</span>
                    <span><strong>{organization.name}</strong><small>{organization.accountType === "freelancer" ? "Self-employed" : `${organization.employeeCount} people · ${organization.plan}`}</small></span>
                    {organization.id === data.selectedOrganization.id && <Check size={16} />}
                  </button>
                ))}
                <div className="popover-footer" onClick={() => setPage("Settings")}><Building2 size={15} /> Manage client permissions</div>
              </div>
            )}
          </div>

          <div className="topbar-actions">
            {/* Instant Role Switcher is available only inside the public sandbox. */}
            {demoMode && (
              <div className="company-switcher-wrap">
                <button className="role-pill-btn" onClick={() => setRoleSwitcherOpen(!roleSwitcherOpen)}>
                  <UserCheck size={14} style={{ color: "var(--green)" }} />
                  <span>Demo role: <strong>{data.user?.role === "employee" ? "Employee" : data.selectedOrganization.accountType === "freelancer" ? "Freelancer" : "Bookkeeper"}</strong></span>
                  <ChevronDown size={13} />
                </button>
                {roleSwitcherOpen && (
                  <div className="company-popover" style={{ width: 280, right: 0, left: "auto" }}>
                    <p>INSTANT DEMO SWITCHER <span>sample data</span></p>
                    <button onClick={() => switchDemoRole("bookkeeper")}>
                      <span className="avatar avatar-mint">CY</span>
                      <span><strong>Principal Bookkeeper (Celine)</strong><small>Multi-client workspace & payroll admin</small></span>
                    </button>
                    <button onClick={() => switchDemoRole("employee")}>
                      <span className="avatar avatar-3">JR</span>
                      <span><strong>Employee Self-Service (Jonas)</strong><small>View personal payslips & time records</small></span>
                    </button>
                    <button onClick={() => switchDemoRole("freelancer")}>
                      <span className="avatar avatar-1">MR</span>
                      <span><strong>Solo Freelancer (Mika)</strong><small>Tax planner and freelancer workspace</small></span>
                    </button>
                  </div>
                )}
              </div>
            )}

            <button className="topbar-link" onClick={() => setGovModalOpen(true)}>
              <ShieldCheck size={14} style={{ color: "var(--green)" }} /> Gov Validation Seal
            </button>
            <button className="topbar-link" onClick={() => setCheckoutPlan(data.plans.find((p) => p.name === "Scale") ?? data.plans[0])}>
              <Sparkles size={14} style={{ color: "var(--green)" }} /> Upgrade Plan
            </button>
            <button className="primary-button" style={{ height: 32, fontSize: 11, background: "var(--deep)", borderColor: "var(--green)" }} onClick={() => setWebBundyOpen(true)}>
              <Clock size={14} /> Web Bundy
            </button>
            <button className="icon-button relative" onClick={() => setOutboxOpen(true)} title="Outbox & Email Notification Center" aria-label="Notifications">
              <Bell size={18} />
              <span className="notification-dot" />
            </button>
            <button className="top-avatar" onClick={() => setPage("Settings")} title="Account Settings">{initials}</button>
          </div>
        </header>

        <main className="content-area">
          {notice && (
            <div className="toast">
              <Check size={16} />
              <span>{notice}</span>
              <button onClick={() => setNotice("")}><X size={15} /></button>
            </div>
          )}

          {page === "Overview" && (
            <Overview
              data={data}
              currentRun={currentRun}
              openTasks={openTasks}
              onPayroll={() => setNewPayrollOpen(true)}
              onPage={setPage}
              onDecide={decideTask}
              userName={userName}
              onInspectPayslip={(e) => setInspectEntry(e)}
            />
          )}
          {page === "People" && <PeoplePage data={data} onPage={setPage} onRefresh={async () => { await refresh(); }} onAddEmployee={() => setNewHireOpen(true)} />}
          {page === "Payroll" && (
            <PayrollPage
              data={data}
              onPayroll={() => setNewPayrollOpen(true)}
              onProcess={processRun}
              onApprove={approveRun}
              onRelease={releaseRun}
              busy={busy}
              onInspectPayslip={(e) => setInspectEntry(e)}
            />
          )}
          {page === "Time & attendance" && <TimePage data={data} />}
          {page === "Leave" && <LeavePage data={data} setNotice={setNotice} onRefresh={async () => { await refresh(); }} />}
          {page === "Approvals" && <ApprovalsPage data={data} tasks={data.tasks} onDecide={decideTask} setNotice={setNotice} onRefresh={async () => { await refresh(); }} />}
          {page === "Loans" && <LoansPanel organizationId={data.selectedOrganization.id} setNotice={setNotice} />}
          {page === "Discipline" && <DisciplinePanel organizationId={data.selectedOrganization.id} setNotice={setNotice} />}
          {page === "Recruitment" && <RecruitmentPanel organizationId={data.selectedOrganization.id} setNotice={setNotice} />}
          {page === "Separation" && <SeparationPanel organizationId={data.selectedOrganization.id} setNotice={setNotice} />}
          {page === "Compliance" && <CompliancePage data={data} setNotice={setNotice} onOpenGovModal={() => setGovModalOpen(true)} />}
          {page === "Benefits" && <BenefitsPanel organizationId={data.selectedOrganization.id} setNotice={setNotice} />}
          {page === "Expenses" && <ExpensesPanel organizationId={data.selectedOrganization.id} setNotice={setNotice} />}
          {page === "Earned wage" && <EwaPanel organizationId={data.selectedOrganization.id} setNotice={setNotice} />}
          {page === "Contractors" && <ContractorsPanel organizationId={data.selectedOrganization.id} />}
          {page === "Assets" && <AssetsPanel organizationId={data.selectedOrganization.id} />}
          {page === "Freelancer hub" && <FreelancerPage data={data} setNotice={setNotice} />}
          {page === "Reports" && <ReportsPage data={data} />}
          {page === "Integrations" && <IntegrationsPage onOpenOutbox={() => setOutboxOpen(true)} />}
          {page === "Developer" && <DeveloperPage organizationId={data.selectedOrganization.id} setNotice={setNotice} />}
          {page === "Pricing" && <PricingPage plans={data.plans} onSelectPlan={(p) => setCheckoutPlan(p)} />}
          {page === "Audit trail" && <AuditPage events={data.auditEvents} organizationId={data.selectedOrganization.id} />}
          {page === "Settings" && <SettingsPage data={data} setNotice={setNotice} />}
        </main>
      </div>

      {newPayrollOpen && <NewPayrollModal onClose={() => setNewPayrollOpen(false)} onCreate={createPayroll} busy={busy} data={data} />}
      {outboxOpen && <OutboxModal organizationId={data.selectedOrganization.id} onClose={() => setOutboxOpen(false)} setNotice={setNotice} />}
      {checkoutPlan && <CheckoutModal organizationId={data.selectedOrganization.id} plan={checkoutPlan} onClose={() => setCheckoutPlan(null)} onUpgraded={async () => { await refresh(); setNotice(`Plan upgraded to ${checkoutPlan.name}!`); setCheckoutPlan(null); }} />}
      {inspectEntry && <PayslipInspectModal entry={inspectEntry} employee={data.employees.find((e) => e.id === inspectEntry.employeeId)} run={currentRun} onClose={() => setInspectEntry(null)} />}
      {govModalOpen && <GovValidationModal organizationId={data.selectedOrganization.id} onClose={() => setGovModalOpen(false)} setNotice={setNotice} />}
      {newHireOpen && <NewHireModal organizationId={data.selectedOrganization.id} onClose={() => setNewHireOpen(false)} onCreated={async () => { await refresh(); setNotice("Employee created with onboarding checklist."); }} />}
      {webBundyOpen && (
        <WebBundyModal
          organizationId={data.selectedOrganization.id}
          employeeName={userName}
          onClose={() => setWebBundyOpen(false)}
          onPunchSuccess={() => { refresh(); setNotice("Attendance punch recorded via Web Bundy."); }}
        />
      )}
    </div>
  );
}

function PageHeading({ eyebrow, title, copy, actions }: { eyebrow: string; title: string; copy?: string; actions?: React.ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {copy && <p className="heading-copy">{copy}</p>}
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}

function Overview({
  data,
  currentRun,
  openTasks,
  onPayroll,
  onPage,
  onDecide,
  userName,
  onInspectPayslip,
}: {
  data: DashboardData;
  currentRun?: PayrollRun;
  openTasks: Task[];
  onPayroll: () => void;
  onPage: (page: string) => void;
  onDecide: (id: number, status: "Approved" | "Declined") => void;
  userName: string;
  onInspectPayslip: (entry: PayrollEntry) => void;
}) {
  const payrollProgress = currentRun
    ? currentRun.totalChunks
      ? Math.round(((currentRun.processedChunks ?? 0) / Math.max(currentRun.totalChunks, 1)) * 100)
      : currentRun.status === "Needs review" ? 68 : currentRun.status === "Released" ? 100 : 28
    : 0;
  const peopleReady = data.employees.filter((employee) => employee.status === "Active").length;

  return (
    <>
      <PageHeading
        eyebrow="Monday, 16 March"
        title={`Good morning, ${userName.split(" ")[0]}.`}
        copy={`Here’s what needs your attention across ${data.selectedOrganization.name}.`}
        actions={
          <>
            <button className="secondary-button" onClick={() => onPage("Reports")}><FileBarChart2 size={16} /> Reports</button>
            <button className="primary-button" onClick={onPayroll}><Plus size={17} /> New payroll</button>
          </>
        }
      />

      <section className="welcome-strip">
        <div>
          <span className="sun-icon">✦</span>
          <strong>Semi-monthly payroll cut-off is in 2 days</strong>
          <p>March 1–15 timesheets close on Wednesday at 5:00 PM. Incomplete punches will flag for reviewer sign-off.</p>
        </div>
        <button onClick={() => onPage("Time & attendance")}>Review time <ArrowUpRight size={15} /></button>
      </section>

      <section className="stats-grid">
        <Metric label="ACTIVE PEOPLE" value={String(peopleReady)} hint={`of ${data.employees.length} on this client`} icon={<UsersRound size={19} />} tone="mint" />
        <Metric label="NEXT PAYROLL" value={currentRun?.periodLabel ?? "No active run"} hint={currentRun ? `${currentRun.employeeCount} employees · pay date ${formatDate(currentRun.payDate)}` : "Start a payroll draft"} icon={<WalletCards size={19} />} tone="purple" compact />
        <Metric label="EST. NET PAY" value={currentRun ? shortMoney(currentRun.netPay) : "—"} hint={currentRun ? `${shortMoney(currentRun.grossPay)} gross · PH-2026.09` : "No payroll data"} icon={<CircleDollarSign size={19} />} tone="orange" />
        <Metric label="OPEN APPROVALS" value={String(openTasks.length)} hint={openTasks.length ? "1 requires action today" : "Everything is reviewed"} icon={<ClipboardCheck size={19} />} tone="blue" />
      </section>

      <section className="overview-grid">
        <article className="card payroll-card">
          <div className="card-header">
            <div>
              <div className="card-kicker">IN PROGRESS · QUEUED RUN</div>
              <h2>{currentRun?.periodLabel ?? "No payroll in progress"}</h2>
              <p>{currentRun?.scopeLabel ?? "Create a scoped payroll run when ready"}</p>
            </div>
            <Status value={currentRun?.status ?? "Ready"} />
          </div>
          {currentRun && (
            <>
              <div className="payroll-summary">
                <div><span>Estimated net pay</span><strong>{money(currentRun.netPay)}</strong></div>
                <div><span>Pay date</span><strong>{formatDate(currentRun.payDate)}</strong></div>
                <div><span>Exceptions</span><strong className={currentRun.exceptions ? "text-amber" : ""}>{currentRun.exceptions}</strong></div>
              </div>
              <div className="progress-label"><span>Run progress</span><strong>{payrollProgress}%</strong></div>
              <div className="progress-track"><span style={{ width: `${payrollProgress}%` }} /></div>
              <div className="stepper">
                <span className="complete"><i><Check size={12} /></i>Inputs checked</span>
                <span className="complete"><i><Check size={12} /></i>Calculate</span>
                <span className="current"><i>3</i>Review</span>
                <span><i>4</i>Release</span>
              </div>
              <button className="card-action" onClick={() => onPage("Payroll")}>Open payroll workspace <ArrowUpRight size={16} /></button>
            </>
          )}
        </article>

        <article className="card attention-card">
          <div className="card-header">
            <div><div className="card-kicker">ATTENTION QUEUE</div><h2>Your action items</h2><p>Items assigned to you or your delegates</p></div>
            <button className="link-button" onClick={() => onPage("Approvals")}>View all</button>
          </div>
          <div className="attention-list">
            {openTasks.length === 0 ? (
              <div className="empty-state small"><Check size={19} />Your approval queue is clear.</div>
            ) : (
              openTasks.slice(0, 3).map((task) => (
                <div className="attention-item" key={task.id}>
                  <div className={`attention-icon ${task.priority === "High" ? "urgent" : ""}`}><ClipboardCheck size={17} /></div>
                  <div>
                    <strong>{task.title}</strong>
                    <p>{task.detail}</p>
                    <span>{task.dueLabel}</span>
                  </div>
                  <button onClick={() => onDecide(task.id, "Approved")} className="approve-mini" aria-label={`Approve ${task.title}`} title="Quick Approve">
                    <Check size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="overview-grid lower-grid">
        <article className="card directory-card">
          <div className="card-header">
            <div><div className="card-kicker">TEAM DIRECTORY</div><h2>Recently active employees</h2></div>
            <button className="link-button" onClick={() => onPage("People")}>Directory <ArrowUpRight size={14} /></button>
          </div>
          <div className="mini-directory">
            {data.employees.slice(0, 5).map((employee) => (
              <div className="mini-person" key={employee.id}>
                <Avatar initials={employee.avatarInitials} index={employee.id} />
                <div><strong>{employee.firstName} {employee.lastName}</strong><span>{employee.title}</span></div>
                <Status value={employee.status} />
              </div>
            ))}
          </div>
        </article>

        <article className="card compliance-brief">
          <div className="card-header">
            <div><div className="card-kicker">COMPLIANCE WATCH</div><h2>Statutory rulebook snapshot</h2></div>
            <Status value="PH-2026.09" />
          </div>
          <div className="compliance-row">
            <span className="check-round"><Check size={14} /></span>
            <div><strong>SSS / PhilHealth / Pag-IBIG tables versioned</strong><p>Computed and unit-tested against Republic Acts 11199, 11223, and 9679.</p></div>
          </div>
          <div className="compliance-row amber">
            <span className="alert-round">!</span>
            <div><strong>Weather disruption pay policy is explicit</strong><p>No blanket statutory calamity premium is assumed. Employer policy/CBA incentives are applied only when configured.</p></div>
          </div>
          <button className="card-action" onClick={() => onPage("Compliance")}>Open compliance centre <ArrowUpRight size={16} /></button>
        </article>
      </section>
    </>
  );
}

function Metric({ label, value, hint, icon, tone, compact = false }: { label: string; value: string; hint: string; icon: React.ReactNode; tone: string; compact?: boolean }) {
  return (
    <article className={`stat-card ${compact ? "stat-compact" : ""}`}>
      <div className={`stat-icon ${tone}`}>{icon}</div>
      <p>{label}</p>
      <h3>{value}</h3>
      <span>{hint}</span>
    </article>
  );
}

function PeoplePage({ data, onPage, onRefresh, onAddEmployee }: { data: DashboardData; onPage: (page: string) => void; onRefresh: () => Promise<void>; onAddEmployee: () => void }) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => data.employees.filter((employee) => `${employee.firstName} ${employee.lastName} ${employee.title}`.toLowerCase().includes(query.toLowerCase())), [data.employees, query]);
  const openOffboarding = (data.provisioning ?? []).filter((item) => item.kind === "offboarding" && !item.done).length;

  return (
    <>
      <PageHeading eyebrow="PEOPLE DIRECTORY" title="Your people, in context." copy="Department and branch structure stay optional for small teams, ready for scale when you need it." actions={<button className="primary-button" onClick={onAddEmployee}><Plus size={17} /> Add employee</button>} />
      {data.access && !data.access.companyWide && <div className="notice notice-amber"><LockKeyhole size={16} /><span>Your role is scoped to <strong>{data.access.orgUnitName}</strong>. Employees outside that unit are not loaded.</span></div>}
      <ImportPanel organizationId={data.selectedOrganization.id} onImported={onRefresh} />
      {openOffboarding > 0 && <div className="notice notice-blue"><ShieldCheck size={16} /><span><strong>{openOffboarding} offboarding items</strong> are open. Completing them is recorded in the audit trail via /api/provisioning.</span></div>}
      
      <div className="tabs"><button className="tab active">All people <b>{data.employees.length}</b></button><button className="tab">Active</button><button className="tab">On leave</button><button className="tab">Separation</button></div>
      
      <section className="people-layout">
        <article className="card table-card">
          <div className="table-toolbar">
            <div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" /></div>
            <button className="filter-button">Department <ChevronDown size={15} /></button>
            <button className="filter-button">Status <ChevronDown size={15} /></button>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>PERSON</th><th>EMPLOYEE TYPE</th><th>STATUS</th><th>MONTHLY BASIC</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {rows.map((employee) => (
                  <tr key={employee.id}>
                    <td>
                      <div className="person-cell">
                        <Avatar initials={employee.avatarInitials} index={employee.id} />
                        <div><strong>{employee.firstName} {employee.lastName}</strong><span>{employee.employeeNo} · {employee.title}</span></div>
                      </div>
                    </td>
                    <td>{employee.employmentType}</td>
                    <td><Status value={employee.status} /></td>
                    <td><strong>{money(employee.basicRate)}</strong>{employee.mwe && <small className="mwe-tag">MWE</small>}</td>
                    <td><button className="row-more"><MoreHorizontal size={18} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <div className="empty-state">No people match that search.</div>}
          </div>
          <div className="pagination">
            <span>Showing {rows.length} of {data.employees.length} people</span>
            <div><button disabled>‹</button><button className="current">1</button><button disabled>›</button></div>
          </div>
        </article>
        
        <aside className="card org-card">
          <div className="card-header"><div><div className="card-kicker">STRUCTURE</div><h2>Organization map</h2></div><button className="row-more"><MoreHorizontal size={17} /></button></div>
          <div className="org-tree">
            <div className="tree-root"><Building2 size={16} /><span>{data.selectedOrganization.name}</span></div>
            <div className="tree-branch">
              <div><span className="tree-line" /><BriefcaseBusiness size={15} /><strong>Makati HQ</strong><b>5</b></div>
              <div className="tree-leaf">Operations</div>
              <div className="tree-leaf">Finance</div>
            </div>
            <div className="tree-branch">
              <div><span className="tree-line" /><BriefcaseBusiness size={15} /><strong>Cebu Hub</strong><b>3</b></div>
              <div className="tree-leaf">Customer Experience</div>
            </div>
          </div>
          <div className="notice notice-green"><ShieldCheck size={16} /><span>Department-scoped access is available in Scale plans.</span></div>
          <button className="card-action" onClick={() => onPage("Settings")}>Manage structure <ArrowUpRight size={16} /></button>
        </aside>
      </section>
    </>
  );
}

function PayrollPage({
  data,
  onPayroll,
  onProcess,
  onApprove,
  onRelease,
  busy,
  onInspectPayslip,
}: {
  data: DashboardData;
  onPayroll: () => void;
  onProcess: (runId: number) => void;
  onApprove: (runId: number) => void;
  onRelease: (runId: number) => void;
  busy: boolean;
  onInspectPayslip: (entry: PayrollEntry) => void;
}) {
  const [selectedRun, setSelectedRun] = useState(data.payrollRuns[0]?.id);
  const [bankExportOpen, setBankExportOpen] = useState(false);
  const activeRun = data.payrollRuns.find((run) => run.id === selectedRun) ?? data.payrollRuns[0];
  const isReleased = activeRun?.status === "Released";

  return (
    <>
      <PageHeading
        eyebrow="PAYROLL WORKSPACE"
        title="Pay confidently, every cycle."
        copy="Semi-monthly payroll scoped to your client, branch, department, or cost centre with resumable chunked queues."
        actions={
          <>
            <button className="secondary-button" onClick={() => setBankExportOpen(!bankExportOpen)}><FileSpreadsheet size={16} /> Bank Disbursement</button>
            <button className="primary-button" onClick={onPayroll}><Plus size={17} /> New payroll</button>
          </>
        }
      />

      <section className="payroll-workspace">
        <article className="card run-list">
          <div className="card-header"><div><div className="card-kicker">PAYROLL RUNS</div><h2>2026 Register</h2></div><button className="row-more"><MoreHorizontal size={18} /></button></div>
          {data.payrollRuns.map((run) => (
            <button key={run.id} className={`run-item ${run.id === activeRun?.id ? "selected" : ""}`} onClick={() => setSelectedRun(run.id)}>
              <span className="run-calendar"><small>MAR</small><b>{run.id % 2 ? "15" : "30"}</b></span>
              <span><strong>{run.periodLabel}</strong><small>{run.scopeLabel} · {run.employeeCount} people</small></span>
              <Status value={run.status} />
            </button>
          ))}
          <button className="new-run-line" onClick={onPayroll}><Plus size={16} /> Start another payroll</button>
        </article>

        <article className="card payroll-detail">
          {activeRun ? (
            <>
              <div className="card-header">
                <div>
                  <div className="card-kicker">{activeRun.scopeLabel.toUpperCase()} · PAYROLL RUN #{activeRun.id}</div>
                  <h2>{activeRun.periodLabel}</h2>
                  <p>Pay date: {formatDate(activeRun.payDate)} · Statutory Rule Engine {activeRun.ruleVersion}</p>
                </div>
                <Status value={activeRun.status} />
              </div>

              <div className="run-stats">
                <div><span>Gross compensation</span><strong>{money(activeRun.grossPay)}</strong></div>
                <div><span>Employee deductions</span><strong>{money(Number(activeRun.grossPay) - Number(activeRun.netPay))}</strong></div>
                <div><span>Estimated net pay</span><strong className="green-number">{money(activeRun.netPay)}</strong></div>
              </div>

              {activeRun.exceptions > 0 && (
                <div className="notice notice-amber">
                  <HelpCircle size={17} />
                  <div>
                    <strong>{activeRun.exceptions} timekeeping exceptions flagged</strong>
                    <span>Incomplete punches derive zero hours and require explicit sign-off before clean release.</span>
                  </div>
                  <button className="link-button" onClick={() => onProcess(activeRun.id)}>Re-process queue</button>
                </div>
              )}

              <div className="line-title">
                <strong>REGISTER ENTRIES & PAYSLIP BREAKDOWN</strong>
                <span>Click any row for arithmetic traceability</span>
              </div>

              <div className="register-preview">
                <div className="register-head">
                  <span>Employee</span>
                  <span>Gross</span>
                  <span>Deductions</span>
                  <span>Net pay</span>
                  <span>Action</span>
                </div>
                {data.payrollEntries.slice(0, 6).map((entry) => {
                  const employee = data.employees.find((item) => item.id === entry.employeeId);
                  return (
                    <div className="register-row" key={entry.id} style={{ cursor: "pointer" }} onClick={() => onInspectPayslip(entry)}>
                      <span>
                        {employee ? `${employee.firstName} ${employee.lastName}` : "Employee"}
                        <small>{employee?.employeeNo} · {employee?.title}</small>
                      </span>
                      <span>{money(entry.grossPay)}</span>
                      <span style={{ color: "var(--danger)" }}>-{money(entry.deductions)}</span>
                      <strong>{money(entry.netPay)}</strong>
                      <div>
                        <button className="secondary-button" style={{ height: 26, fontSize: 10, padding: "0 8px" }} onClick={(e) => { e.stopPropagation(); onInspectPayslip(entry); }}>
                          <Eye size={12} /> Inspect
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="run-actions">
                <button className="secondary-button" disabled={busy} onClick={() => onProcess(activeRun.id)}>
                  <RefreshCw size={15} /> {busy ? "Processing…" : "Re-calculate queue"}
                </button>
                {!isReleased ? (
                  <>
                    <button className="secondary-button" disabled={busy || activeRun.status === "Approved"} onClick={() => onApprove(activeRun.id)}><Check size={15} /> {activeRun.status === "Approved" ? "Approved" : activeRun.serviceMode === "managed" ? "Client Approve" : "Approve"}</button>
                    <button className="primary-button" disabled={busy} onClick={() => onRelease(activeRun.id)}><Send size={15} /> {busy ? "Releasing…" : "Release Payroll"}</button>
                  </>
                ) : (
                  <div className="status status-released" style={{ height: 34, padding: "0 14px", fontSize: 11 }}>
                    <Check size={14} style={{ marginRight: 6 }} /> Released & Payslips Dispatched
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">Choose a payroll run to view details.</div>
          )}
        </article>
      </section>

      <section className="module-grid three">
        <article className="card compact-card">
          <div className="inline-icon mint"><ReceiptText size={18} /></div>
          <div><h3>Government worksheets</h3><p>BIR 2316, 1601-C, SSS R-3, PhilHealth, Pag-IBIG</p></div>
          <Status value="Draft only" />
        </article>
        <article className="card compact-card">
          <div className="inline-icon blue"><Building2 size={18} /></div>
          <div><h3>Bank file generators</h3><p>BDO DAT, BPI, UnionBank, GCash CSV</p></div>
          <Status value="Versioned" />
        </article>
        <article className="card compact-card">
          <div className="inline-icon purple"><BookOpen size={18} /></div>
          <div><h3>Journal CSV exports</h3><p>Xero & QuickBooks Online ledger sync</p></div>
          <Status value="Ready" />
        </article>
      </section>
    </>
  );
}

function TimePage({ data }: { data: DashboardData }) {
  return (
    <>
      <PageHeading eyebrow="TIME & ATTENDANCE" title="Time that stands up to payroll." copy="Raw punches are auto-classified against scheduled shifts; tardiness, overtime, and night diff derive deterministically." actions={<button className="secondary-button"><Download size={16} /> Export punches</button>} />
      <section className="module-grid two">
        <article className="card time-summary">
          <div className="card-header"><div><div className="card-kicker">CURRENT PERIOD</div><h2>March 1–15 Punches</h2></div><Status value="2 exceptions" /></div>
          <div className="time-bars">
            <TimeBar label="Complete punch pairs" value="6 people" percent={75} color="green" />
            <TimeBar label="Awaiting correction" value="1 person" percent={13} color="amber" />
            <TimeBar label="Manager sign-off required" value="1 person" percent={13} color="purple" />
          </div>
          <div className="notice notice-amber"><Clock3 size={16} /><span>Missing IN/OUT pairs derive zero hours. No phantom time is ever manufactured.</span></div>
        </article>
        <article className="card shift-card">
          <div className="card-header"><div><div className="card-kicker">SHIFT POLICY</div><h2>Default office schedule</h2></div><Status value="Active" /></div>
          <div className="policy-lines">
            <span><b>09:00–18:00 Standard Shift</b><small>8 paid hours · 60-min break</small></span>
            <span><b>5-minute grace period</b><small>Tardiness calculation begins at 09:06 AM</small></span>
            <span><b>22:00–06:00 Night Differential</b><small>+10% hourly premium applied across midnight</small></span>
          </div>
          <button className="card-action">Open shift policies <ArrowUpRight size={16} /></button>
        </article>
      </section>
      <article className="card time-table">
        <div className="table-toolbar"><div><div className="card-kicker">PUNCH REVIEW</div><h2>Exception review queue</h2></div><button className="filter-button">This period <ChevronDown size={15} /></button></div>
        <div className="exception-row">
          <Avatar initials={data.employees[2]?.avatarInitials ?? "AV"} index={3} />
          <div><strong>Aira Villanueva</strong><span>Mar 12 · Missing clock-out punch</span></div>
          <Status value="Incomplete punch" />
          <button className="secondary-button">Sign-off</button>
        </div>
        <div className="exception-row">
          <Avatar initials={data.employees[5]?.avatarInitials ?? "RM"} index={6} />
          <div><strong>Rico Mendoza</strong><span>Mar 14 · 42 minutes undertime</span></div>
          <Status value="Manager check" />
          <button className="secondary-button">Sign-off</button>
        </div>
      </article>
    </>
  );
}

function TimeBar({ label, value, percent, color }: { label: string; value: string; percent: number; color: string }) {
  return (
    <div className="time-bar" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
        <span style={{ color: "var(--muted)" }}>{label}</span>
        <strong style={{ color: "var(--ink)" }}>{value}</strong>
      </div>
      <div className="progress-track"><span className={color} style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

function LeavePage({ data, setNotice, onRefresh }: { data: DashboardData; setNotice: (message: string) => void; onRefresh: () => Promise<void> }) {
  const requests = data.leaveRequests ?? [];
  const pending = requests.filter((row) => row.status === "Pending");
  const approvedDays = requests.filter((row) => row.status === "Approved").reduce((sum, row) => sum + Number(row.days), 0);
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(data.employees[0]?.id ?? 0);
  const [leaveType, setLeaveType] = useState("Annual leave");
  const [startDate, setStartDate] = useState("2026-03-24");
  const [endDate, setEndDate] = useState("2026-03-24");
  const [days, setDays] = useState(1);

  async function submit() {
    const response = await fetch("/api/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: data.selectedOrganization.id, employeeId, leaveType, startDate, endDate, days, reason: "Submitted in workspace" }),
    });
    const payload = await response.json();
    if (!response.ok) { setNotice(payload.error ?? "Could not submit leave."); return; }
    setOpen(false);
    await onRefresh();
    setNotice("Leave request submitted and queued for approval.");
  }

  return (
    <>
      <PageHeading eyebrow="LEAVE MANAGEMENT" title="Keep leave human and accountable." copy="Requests create a real approval task. Approving it updates the leave record and fires leave.approved webhooks." actions={<button className="primary-button" onClick={() => setOpen(!open)}><Plus size={17} /> New leave request</button>} />
      <section className="stats-grid">
        <Metric label="PENDING" value={String(pending.length)} hint="Needs manager review" icon={<CalendarDays size={19} />} tone="amber" />
        <Metric label="ON LEAVE" value={String(data.employees.filter((e) => e.status === "On leave").length)} hint="Across this client" icon={<UsersRound size={19} />} tone="purple" />
        <Metric label="APPROVED DAYS" value={String(approvedDays)} hint="On record" icon={<Gauge size={19} />} tone="mint" />
        <Metric label="POLICIES" value="3" hint="Annual, sick, emergency" icon={<BookOpen size={19} />} tone="blue" />
      </section>
      {open && (
        <article className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><div><div className="card-kicker">NEW LEAVE</div><h2>Submit leave application</h2></div></div>
          <div className="setting-form">
            <label>Employee<select value={employeeId} onChange={(event) => setEmployeeId(Number(event.target.value))}>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>
            <label>Leave Type<select value={leaveType} onChange={(event) => setLeaveType(event.target.value)}><option>Annual leave</option><option>Sick leave</option><option>Emergency leave</option></select></label>
            <label>Start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label>End date<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
            <label>Days<input type="number" min={0.5} step={0.5} value={days} onChange={(event) => setDays(Number(event.target.value))} /></label>
          </div>
          <div className="run-actions"><button className="secondary-button" onClick={() => setOpen(false)}>Cancel</button><button className="primary-button" onClick={submit}>Submit request</button></div>
        </article>
      )}
      <article className="card leave-board">
        <div className="card-header"><div><div className="card-kicker">REQUESTS</div><h2>Leave register</h2></div></div>
        {requests.length === 0 && <div className="empty-state">No leave requests yet.</div>}
        {requests.map((row) => {
          const employee = data.employees.find((item) => item.id === row.employeeId);
          const start = new Date(`${row.startDate}T12:00:00`);
          return (
            <div className="leave-request" key={row.id}>
              <span className="date-tile"><small>{start.toLocaleString("en-PH", { month: "short" }).toUpperCase()}</small><b>{start.getDate()}</b></span>
              <Avatar initials={employee?.avatarInitials ?? "NA"} index={row.employeeId} />
              <div><strong>{employee ? `${employee.firstName} ${employee.lastName}` : "Employee"}</strong><span>{row.leaveType} · {row.startDate}–{row.endDate} · {row.days} days</span></div>
              <Status value={row.status === "Pending" ? "Awaiting approval" : row.status} />
            </div>
          );
        })}
      </article>
    </>
  );
}

function ApprovalsPage({ data, tasks, onDecide, setNotice, onRefresh }: { data: DashboardData; tasks: Task[]; onDecide: (id: number, status: "Approved" | "Declined") => void; setNotice: (message: string) => void; onRefresh: () => Promise<void> }) {
  const delegations = data.delegations ?? [];
  const activeDelegations = delegations.filter((row) => row.active);
  const [showForm, setShowForm] = useState(false);
  const [from, setFrom] = useState("Mariel Santos");
  const [to, setTo] = useState(data.user?.name ?? "Celine Yao");

  async function createDelegation() {
    const response = await fetch("/api/delegations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: data.selectedOrganization.id, fromApprover: from, toApprover: to, reason: "Out of office", startsOn: "2026-01-01", endsOn: "2026-12-31" }),
    });
    const payload = await response.json();
    if (!response.ok) { setNotice(payload.error ?? "Could not create delegation."); return; }
    setShowForm(false);
    await onRefresh();
    setNotice(`Delegation active: ${from} → ${to}. Proxy decisions are now permitted and audited.`);
  }

  return (
    <>
      <PageHeading eyebrow="APPROVALS" title="Decisions, with a clear trail." copy="Decisions are permission-checked server-side against the assigned approver and any active delegation." actions={<button className="secondary-button" onClick={() => setShowForm(!showForm)}><Settings2 size={16} /> Delegation settings</button>} />
      {activeDelegations.length > 0 ? (
        <div className="notice notice-green"><ShieldCheck size={17} /><span><strong>Delegation enforced.</strong> {activeDelegations.map((row) => `${row.fromApprover} → ${row.toApprover}`).join(", ")}. The API rejects decisions from anyone outside this chain.</span></div>
      ) : (
        <div className="notice notice-amber"><ShieldCheck size={17} /><span><strong>No active delegation.</strong> Only the assigned approver can decide; others receive a 403.</span></div>
      )}
      {showForm && (
        <article className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><div><div className="card-kicker">NEW DELEGATION</div><h2>Assign a proxy approver</h2><p>Prevents an approval chain from becoming a single point of failure when out-of-office.</p></div></div>
          <div className="setting-form">
            <label>Delegate from<input value={from} onChange={(event) => setFrom(event.target.value)} /></label>
            <label>Delegate to<input value={to} onChange={(event) => setTo(event.target.value)} /></label>
          </div>
          <div className="run-actions"><button className="secondary-button" onClick={() => setShowForm(false)}>Cancel</button><button className="primary-button" onClick={createDelegation}>Activate delegation</button></div>
        </article>
      )}
      <section className="approval-list">
        {tasks.map((task) => (
          <article className={`card approval-card ${task.status !== "Pending" ? "resolved" : ""}`} key={task.id}>
            <div className="approval-symbol"><ClipboardCheck size={20} /></div>
            <div className="approval-content">
              <div>
                <div className="card-kicker">{task.priority === "High" ? "PRIORITY REVIEW" : "PENDING DECISION"}</div>
                <h2>{task.title}</h2>
                <p>{task.detail}</p>
              </div>
              <div className="approval-meta"><span>Approver <strong>{task.approver}</strong></span><span>{task.dueLabel}</span></div>
            </div>
            {task.status === "Pending" ? (
              <div className="approval-actions">
                <button className="decline-button" onClick={() => onDecide(task.id, "Declined")}>Decline</button>
                <button className="primary-button" onClick={() => onDecide(task.id, "Approved")}><Check size={16} /> Approve</button>
              </div>
            ) : (
              <Status value={task.status} />
            )}
          </article>
        ))}
      </section>
    </>
  );
}

function CompliancePage({ data, setNotice, onOpenGovModal }: { data: DashboardData; setNotice: (message: string) => void; onOpenGovModal: () => void }) {
  return (
    <>
      <PageHeading
        eyebrow="COMPLIANCE CENTRE"
        title="Rules visible, not mysterious."
        copy="Versioned statutory formulas, BIR TRAIN tax brackets, and official Philippine verification seals."
        actions={
          <button className="primary-button" onClick={onOpenGovModal}>
            <ShieldCheck size={16} /> Run Gov Validation Seal
          </button>
        }
      />
      <section className="module-grid three">
        <article className="card compliance-tile">
          <div className="inline-icon mint"><ShieldCheck size={19} /></div>
          <span>STATUTORY CONTRIBUTIONS</span>
          <h2>Versioned</h2>
          <p>SSS, PhilHealth & Pag-IBIG formulas are executable and unit-tested.</p>
          <Status value="Tested" />
        </article>
        <article className="card compliance-tile">
          <div className="inline-icon purple"><ReceiptText size={19} /></div>
          <span>WITHHOLDING TAX</span>
          <h2>TRAIN + MWE</h2>
          <p>Annual tax brackets and MWE full-exemption paths are modeled.</p>
          <Status value="Tested" />
        </article>
        <article className="card compliance-tile">
          <div className="inline-icon amber"><FileSpreadsheet size={19} /></div>
          <span>GOVERNMENT OUTPUTS</span>
          <h2>Draft Worksheets</h2>
          <p>2316, 1601-C, Alphalist, SSS R-3, PhilHealth RF-1, Pag-IBIG MCRF.</p>
          <Status value="Draft only" />
        </article>
      </section>

      {data.advisories.length > 0 && (
        <section className="card calamity-card" style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 20px", marginTop: 16 }}>
          <div className="calamity-badge" style={{ padding: "6px 10px", borderRadius: 6, background: "#fae7c5", color: "#874d12", fontSize: 9, fontWeight: 900 }}>ACTIVE COMPANY PAY POLICY</div>
          <div>
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>{data.advisories[0].advisoryNumber} · {data.advisories[0].policy}</h2>
            <p style={{ margin: "2px 0 0", color: "var(--muted)", fontSize: 11 }}>{data.advisories[0].affectedUnit} · {formatDate(data.advisories[0].startDate)}–{formatDate(data.advisories[0].endDate)}</p>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <span className="status status-verified">Employer-configured</span>
          </div>
        </section>
      )}

      <YearEndPanel organizationId={data.selectedOrganization.id} setNotice={setNotice} />
    </>
  );
}

function YearEndPanel({ organizationId, setNotice }: { organizationId: number; setNotice: (message: string) => void }) {
  const [taxYear, setTaxYear] = useState(2026);
  const [summary, setSummary] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function load(year: number) {
    const response = await fetch(`/api/year-end?organizationId=${organizationId}&taxYear=${year}`, { cache: "no-store" });
    if (response.ok) setSummary(await response.json());
  }

  async function runAnnualization() {
    setBusy(true);
    try {
      const response = await fetch("/api/year-end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, taxYear }),
      });
      const payload = await response.json();
      if (!response.ok) { setNotice(payload.error ?? "Annualization failed."); return; }
      if (payload.warning) setNotice(payload.warning);
      else setNotice(`Annualized ${payload.employees} employees: ${payload.refunds} refund(s), ${payload.collections} collection(s).`);
      await load(taxYear);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card" style={{ marginTop: 16 }}>
      <div className="card-header">
        <div><div className="card-kicker">YEAR-END ANNUALIZATION</div><h2>December tax adjustment (BIR 2316)</h2><p>Sums released runs for the year, applies the ₱90k 13th-month exemption, and reconciles tax due vs withheld.</p></div>
        <div className="heading-actions">
          <select value={taxYear} onChange={(event) => { setTaxYear(Number(event.target.value)); setSummary(null); }} style={{ height: 35, borderRadius: 8, border: "1px solid var(--line)", padding: "0 10px", fontSize: 12 }}>
            <option value={2026}>Tax year 2026</option>
            <option value={2025}>Tax year 2025</option>
          </select>
          <button className="primary-button" onClick={runAnnualization} disabled={busy}>{busy ? "Computing…" : "Run annualization"}</button>
        </div>
      </div>
      {summary?.rows?.length ? (
        <>
          <div className="run-stats">
            <div><span>Employees annualized</span><strong>{summary.count}</strong></div>
            <div><span>Total refunds</span><strong className="green-number">{money(summary.totalRefund)}</strong></div>
            <div><span>Total collections</span><strong>{money(summary.totalCollect)}</strong></div>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>EMPLOYEE</th><th>TAXABLE INCOME</th><th>TAX DUE</th><th>WITHHELD</th><th>ADJUSTMENT</th><th>2316</th></tr></thead>
              <tbody>
                {summary.rows.map((row: any) => (
                  <tr key={row.employeeId}>
                    <td><strong>{row.name}</strong>{row.mwe && <small className="mwe-tag">MWE</small>}</td>
                    <td>{money(row.taxableIncome)}</td>
                    <td>{money(row.taxDue)}</td>
                    <td>{money(row.taxWithheld)}</td>
                    <td><Status value={row.outcome === "refund" ? "Refund" : row.outcome === "collect" ? "Collect" : "Balanced"} /> {money(Math.abs(Number(row.adjustment)))}</td>
                    <td><a className="link-button" href={`/api/year-end?organizationId=${organizationId}&taxYear=${taxYear}&employeeId=${row.employeeId}&format=2316`}><Download size={13} style={{ display: "inline" }} /> Draft</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="run-actions">
            <a className="secondary-button" href={`/api/year-end?organizationId=${organizationId}&taxYear=${taxYear}&format=alphalist`}><FileSpreadsheet size={16} /> Alphalist 1604-C CSV</a>
          </div>
        </>
      ) : (
        <div className="empty-state">Run annualization to compute December tax adjustments and generate draft BIR 2316 certificates.</div>
      )}
    </article>
  );
}

function FreelancerPage({ data, setNotice }: { data: DashboardData; setNotice: (message: string) => void }) {
  const [income, setIncome] = useState(82000);
  const [expenses, setExpenses] = useState(180000);
  const annualGross = income * 12;
  const flat = Math.max(0, annualGross - 250000) * 0.08;
  const taxable = Math.max(0, annualGross - expenses);
  const graduated = taxable <= 250000 ? 0 : taxable <= 400000 ? (taxable - 250000) * 0.15 : 22500 + (taxable - 400000) * 0.2;
  const preferred = flat <= graduated ? "8% flat" : "Graduated";
  const soloOrg = data.organizations.find((organization) => organization.accountType === "freelancer");

  return (
    <>
      <PageHeading eyebrow="SELF-EMPLOYED HUB" title="A better solo finance routine." copy="Model voluntary contributions and compare tax approaches without the overhead of a company setup." actions={<button className="secondary-button" onClick={() => setNotice("Solo planner values are session-local in this build.")}><RefreshCw size={16} /> Save planner</button>} />
      <section className="solo-hero" style={{ padding: "28px 32px", borderRadius: 14, background: "linear-gradient(135deg, #0e2e28 0%, #154c41 100%)", color: "white" }}>
        <div className="solo-hero-copy">
          <span className="solo-chip">FOR FREELANCERS & SELF-EMPLOYED</span>
          <h2 style={{ fontSize: 24, margin: "10px 0 6px", fontWeight: 800 }}>Know what to set aside <em>before</em> deadline week.</h2>
          <p style={{ margin: 0, color: "#a5cec0", fontSize: 12.5 }}>Compare 8% Gross Income Tax vs Graduated Income Tax under the TRAIN Law.</p>
        </div>
        <div className="solo-stash" style={{ background: "rgba(255,255,255,0.08)", padding: 16, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)" }}>
          <span style={{ fontSize: 10, color: "#8ec4b2", textTransform: "uppercase", fontWeight: 800 }}>Suggested Monthly Tax Reserve</span>
          <strong style={{ display: "block", fontSize: 22, color: "#50d29d", margin: "4px 0" }}>{money((preferred === "8% flat" ? flat : graduated) / 12)}</strong>
          <small style={{ color: "#a5cec0", fontSize: 10 }}>Based on lower modeled option</small>
        </div>
      </section>

      <section className="solo-grid" style={{ marginTop: 18 }}>
        <article className="card planner-card">
          <div className="card-header"><div><div className="card-kicker">TAX COMPARISON</div><h2>Find your better path</h2></div><Status value="Planner" /></div>
          <label className="input-label" style={{ padding: "0 18px" }}>Average monthly gross income
            <div className="currency-input"><span>₱</span><input type="number" value={income} min="0" onChange={(event) => setIncome(Number(event.target.value))} /></div>
          </label>
          <label className="input-label" style={{ padding: "0 18px" }}>Annual deductible expenses
            <div className="currency-input"><span>₱</span><input type="number" value={expenses} min="0" onChange={(event) => setExpenses(Number(event.target.value))} /></div>
          </label>
          <div className="tax-compare" style={{ margin: "14px 18px 0" }}>
            <div className={preferred === "8% flat" ? "recommended" : ""}><span>8% flat option</span><strong>{money(flat)}</strong><small>{preferred === "8% flat" ? "Recommended" : "Annual estimate"}</small></div>
            <div className={preferred === "Graduated" ? "recommended" : ""}><span>Graduated option</span><strong>{money(graduated)}</strong><small>{preferred === "Graduated" ? "Recommended" : "Annual estimate"}</small></div>
          </div>
          <p className="disclaimer">Planning estimate only under TRAIN Law R.A. 10963.</p>
        </article>

        <article className="card contribution-card">
          <div className="card-header"><div><div className="card-kicker">VOLUNTARY SAFETY NETS</div><h2>Individual contributions</h2></div><Status value="PHP" /></div>
          <div className="contribution-list">
            <Contribution name="SSS Voluntary" value="₱1,750" note="Based on ₱35,000 MSC cap" />
            <Contribution name="PhilHealth Individual" value="₱2,050" note="Personal 5% premium base" />
            <Contribution name="Pag-IBIG MP1 Mandatory" value="₱100" note="Member contribution cap" />
            <Contribution name="Pag-IBIG MP2 Voluntary" value="₱2,000" note="Tax-free 7%+ dividend yield" />
          </div>
        </article>
      </section>
    </>
  );
}

function Contribution({ name, value, note }: { name: string; value: string; note: string }) {
  return (
    <div className="contribution" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", borderBottom: "1px solid #edf2ee" }}>
      <span className="contribution-mark" style={{ width: 28, height: 28, borderRadius: 7, background: "#e8f5f0", color: "var(--green)", display: "grid", placeItems: "center", fontWeight: 800 }}>₱</span>
      <div style={{ flex: 1 }}><strong>{name}</strong><small style={{ display: "block", color: "var(--muted)", fontSize: 10 }}>{note}</small></div>
      <b>{value}</b>
    </div>
  );
}

function ReportsPage({ data }: { data: DashboardData }) {
  const orgId = data.selectedOrganization.id;
  const exportBase = `/api/exports?organizationId=${orgId}`;
  const [active, setActive] = useState<string>("headcount");
  const [result, setResult] = useState<{ columns: string[]; rows: string[][] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 8;

  const REPORTS = [
    { key: "headcount", name: "Headcount movement", copy: "Active, leave, disciplinary and separating counts by type", tag: "People" },
    { key: "cost", name: "Payroll cost register", copy: "Gross, deductions, net pay and rule version per run", tag: "Payroll" },
    { key: "turnover", name: "Turnover & attrition risk", copy: "Workforce share by lifecycle status", tag: "Finance" },
    { key: "compliance", name: "Compliance exceptions", copy: "Punch exceptions and flagged payroll entries", tag: "Compliance" },
  ];

  async function run(key: string) {
    setActive(key);
    setLoading(true);
    setPage(0);
    try {
      const response = await fetch(`/api/reports?organizationId=${orgId}&key=${key}`, { cache: "no-store" });
      if (!response.ok) { setResult(null); return; }
      setResult(await response.json());
    } finally {
      setLoading(false);
    }
  }

  const rows = result?.rows ?? [];
  const pageRows = rows.slice(page * pageSize, page * pageSize + pageSize);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));

  return (
    <>
      <PageHeading eyebrow="REPORTING & PORTABILITY" title="Data, ready to travel." copy="Reports execute real aggregate queries against your scoped data, paginated and exportable to CSV/BI." actions={<a className="primary-button" href={`${exportBase}&kind=all`}><Download size={17} /> Export everything</a>} />
      <section className="report-hero" style={{ padding: "28px 32px", borderRadius: 14, background: "linear-gradient(135deg, #1f426e 0%, #173255 100%)", color: "white" }}>
        <div>
          <span className="solo-chip">BUILD YOUR VIEW</span>
          <h2 style={{ fontSize: 24, margin: "10px 0 6px", fontWeight: 800 }}>From a quick headcount to a finance-ready payroll register.</h2>
          <p style={{ margin: 0, color: "#b8d0ee", fontSize: 12.5 }}>Pick a foundation report, run it against live data, then export for Excel or your BI analysis tool.</p>
          <div className="report-filter-row" style={{ marginTop: 16 }}>
            <button>{data.selectedOrganization.name} <ChevronDown size={14} /></button>
            <button>All locations <ChevronDown size={14} /></button>
            <button className="primary-button" style={{ background: "white", color: "#173255", borderColor: "white" }} onClick={() => run(active)}>Run report <ArrowUpRight size={16} /></button>
          </div>
        </div>
      </section>

      <section className="report-grid">
        {REPORTS.map((report) => (
          <article className={`card report-card ${active === report.key && result ? "featured" : ""}`} key={report.key}>
            <div className="report-icon"><FileBarChart2 size={20} /></div>
            <span>{report.tag}</span>
            <h2>{report.name}</h2>
            <p>{report.copy}</p>
            <button className="card-action" onClick={() => run(report.key)}>{loading && active === report.key ? "Running…" : "Run report"} <ArrowUpRight size={16} /></button>
          </article>
        ))}
      </section>

      {result && (
        <article className="card table-card" style={{ marginTop: 16 }}>
          <div className="table-toolbar">
            <div><div className="card-kicker">REPORT RESULT</div><h2>{REPORTS.find((r) => r.key === active)?.name}</h2></div>
            <a className="secondary-button" href={`/api/reports?organizationId=${orgId}&key=${active}&format=csv`}><FileSpreadsheet size={16} /> Export CSV</a>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr>{result.columns.map((column) => <th key={column}>{column.toUpperCase()}</th>)}</tr></thead>
              <tbody>{pageRows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cellIndex === 0 ? <strong>{cell}</strong> : cell}</td>)}</tr>)}</tbody>
            </table>
            {rows.length === 0 && <div className="empty-state">This report returned no rows for the current scope.</div>}
          </div>
          <div className="pagination">
            <span>Showing {pageRows.length} of {rows.length} rows</span>
            <div><button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹</button><button className="current">{page + 1}</button><button disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>›</button></div>
          </div>
        </article>
      )}

      <section className="card export-card" style={{ padding: "18px 22px", marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
        <div>
          <div className="card-kicker">DATA PORTABILITY GUARANTEE</div>
          <h2 style={{ margin: "2px 0 4px", fontSize: 16, fontWeight: 800 }}>Your data is 100% yours. No vendor lock-in.</h2>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>Download employees or payroll registers as CSV, or take a full JSON archive. Every export is audit-logged.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="secondary-button" href={`${exportBase}&kind=employees`}><FileSpreadsheet size={16} /> Employee CSV</a>
          <a className="secondary-button" href={`${exportBase}&kind=payroll`}><FileSpreadsheet size={16} /> Payroll CSV</a>
          <a className="primary-button" href={`${exportBase}&kind=all`}><Download size={16} /> Full JSON Archive</a>
        </div>
      </section>
    </>
  );
}

function IntegrationsPage({ onOpenOutbox }: { onOpenOutbox: () => void }) {
  const entries = [
    ["Accounting", "Xero / QuickBooks Online", "Journal CSV mapping ready", "File based"],
    ["Banking", "BDO, BPI, UnionBank, GCash", "Versioned templates + byte generators", "Validated"],
    ["Outbox & Email", "Resend / Postmark / Outbox", "Transactional mail & SMS queue inspector", "Outbox Ready"],
    ["Identity", "SAML SSO", "Architecture reserved; no IdP connected", "Not configured"],
    ["Storage", "S3 / Cloudflare R2", "MIME magic-byte sniffing + SHA-256 storage", "Active"],
    ["Public API", "ERP & Webhook Engine", "Documented event surface + HMAC signing", "v1 Live"],
  ];

  return (
    <>
      <PageHeading eyebrow="INTEGRATIONS" title="Connect without pretending." copy="Integration cards clearly state their current mode—template, credential-required, or live." actions={<button className="primary-button" onClick={onOpenOutbox}><Mail size={16} /> View Email Outbox</button>} />
      <section className="integration-grid">
        {entries.map(([type, name, copy, state], index) => (
          <article className="card integration-card" key={name}>
            <div className={`integration-icon tone-${index % 4}`}><CloudCog size={20} /></div>
            <span>{type}</span>
            <h2>{name}</h2>
            <p>{copy}</p>
            <div>
              <Status value={state} />
              <button className="row-more" onClick={name.includes("Outbox") ? onOpenOutbox : undefined}><ArrowUpRight size={17} /></button>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}

function DeveloperPage({ organizationId, setNotice }: { organizationId: number; setNotice: (message: string) => void }) {
  const [state, setState] = useState<{ apiKeys: any[]; webhookEndpoints: any[]; deliveries: any[]; availableEvents: string[] } | null>(null);
  const [freshKey, setFreshKey] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("https://httpbin.org/status/200");
  const [loaded, setLoaded] = useState(false);

  const [nonce, setNonce] = useState(0);
  // Loaded from an effect (not during render) so state is never set in the
  // render phase; `alive` prevents a stale response overwriting a newer one.
  useEffect(() => {
    let alive = true;
    (async () => {
      const response = await fetch(`/api/developer?organizationId=${organizationId}`, { cache: "no-store" });
      const payload = response.ok ? await response.json() : null;
      if (!alive) return;
      if (payload) setState(payload);
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [organizationId, nonce]);

  function load() {
    setNonce((n) => n + 1);
  }

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/developer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, ...body }),
    });
    const payload = await response.json();
    if (!response.ok) { setNotice(payload.error ?? "Request failed."); return null; }
    await load();
    return payload;
  }

  return (
    <>
      <PageHeading eyebrow="DEVELOPER" title="Two-way integration, not just file exports." copy="Issue scoped API keys and subscribe to HMAC-signed webhook events. Delivery attempts are logged with real response codes and exponential backoff retry." actions={<a className="secondary-button" href="/api/v1"><BookOpen size={16} /> API reference</a>} />
      <section className="module-grid two">
        <article className="card">
          <div className="card-header"><div><div className="card-kicker">API KEYS</div><h2>Scoped access keys</h2><p>Keys are stored as SHA-256 hashes and shown once.</p></div><button className="primary-button" onClick={async () => { const created = await post({ action: "create-key", name: "ERP Sync Key" }); if (created?.key) { setFreshKey(created.key); setNotice("API key created. Copy it now — it is not retrievable later."); } }}><Plus size={16} /> New key</button></div>
          {freshKey && <div className="notice notice-green"><Check size={16} /><span><strong>Copy now:</strong> <code>{freshKey}</code></span></div>}
          <div className="worksheet-list">{(state?.apiKeys ?? []).length === 0 ? <div className="empty-state">No API keys yet.</div> : state?.apiKeys.map((key) => <div key={key.id}><LockKeyhole size={17} /><span>{key.name} · <code>{key.prefix}…</code> {key.revokedAt ? "(revoked)" : ""}</span>{!key.revokedAt && <button className="row-more" onClick={() => post({ action: "revoke-key", keyId: key.id })}><X size={16} /></button>}</div>)}</div>
        </article>

        <article className="card">
          <div className="card-header"><div><div className="card-kicker">WEBHOOKS</div><h2>Event subscriptions</h2><p>Signed with <code>Linaw-Signature</code>.</p></div><button className="secondary-button" onClick={() => post({ action: "test-webhook" }).then(() => setNotice("Test event dispatched. Check the delivery log for the real result."))}><Send size={15} /> Send test event</button></div>
          <label className="input-label" style={{ padding: "0 18px" }}>Endpoint URL<input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} /></label>
          <div style={{ padding: "0 18px 14px" }}><button className="primary-button full" onClick={async () => { const created = await post({ action: "create-webhook", url: webhookUrl, events: state?.availableEvents ?? [] }); if (created) setNotice("Webhook endpoint registered with a generated signing secret."); }}><Plus size={16} /> Register endpoint</button></div>
          <div className="worksheet-list">{(state?.webhookEndpoints ?? []).length === 0 ? <div className="empty-state">No endpoints registered.</div> : state?.webhookEndpoints.map((endpoint) => <div key={endpoint.id}><Webhook size={17} /><span>{endpoint.url}</span><Status value={endpoint.active ? "Active" : "Paused"} /></div>)}</div>
        </article>
      </section>

      <article className="card audit-card" style={{ marginTop: 16 }}>
        <div className="table-toolbar"><div><div className="card-kicker">DELIVERY LOG</div><h2>Real attempts, real outcomes</h2></div><Status value="Honest" /></div>
        <div className="audit-list">{(state?.deliveries ?? []).length === 0 ? <div className="empty-state">No deliveries attempted yet. Register an endpoint and send a test.</div> : state?.deliveries.map((delivery) => <div className="audit-row" key={delivery.id}><span className="audit-dot"><Webhook size={14} /></span><div><strong>{delivery.event}</strong><p>{delivery.error ? delivery.error : `HTTP ${delivery.responseCode ?? "—"}`}</p></div><div><Status value={delivery.status === "delivered" ? "Approved" : "Failed"} /><time>{formatTime(delivery.createdAt)}</time></div></div>)}</div>
      </article>
    </>
  );
}

function PricingPage({ plans, onSelectPlan }: { plans: PricingPlan[]; onSelectPlan: (plan: PricingPlan) => void }) {
  const [headcount, setHeadcount] = useState(25);

  return (
    <>
      <PageHeading eyebrow="TRANSPARENT PRICING" title="Clear costs, from solo to scale." copy="Versioned published pricing with modular plans—no hidden quote wall for growing teams." />
      <section className="pricing-calculator" style={{ padding: "18px 24px", borderRadius: 12 }}>
        <div>
          <div className="card-kicker">HEADCOUNT COST CALCULATOR</div>
          <h2>How many people are you paying in the Philippines?</h2>
          <div className="range-row">
            <input type="range" min="1" max="500" value={headcount} onChange={(event) => setHeadcount(Number(event.target.value))} />
            <div><strong>{headcount}</strong><span>employees</span></div>
          </div>
        </div>
        <div className="calc-note"><CircleDollarSign size={20} /><span>Monthly estimate updates live. Transparent modular pricing read directly from database.</span></div>
      </section>

      <section className="pricing-grid">
        {plans.map((plan) => {
          const total = Number(plan.monthlyBase) + Number(plan.perEmployee) * (plan.name === "Solo" ? 0 : headcount);
          return (
            <article className={`card price-card ${plan.name === "Scale" ? "featured" : ""}`} key={plan.id}>
              {plan.name === "Scale" && <div className="popular-label">MOST POPULAR</div>}
              <div>
                <span className="price-plan">{plan.name}</span>
                <h2>{plan.name === "Solo" ? "For independent work" : plan.name === "Core" ? "For small teams" : plan.name === "Scale" ? "For growing operations" : "For complex organizations"}</h2>
                <p>{(plan.modules as string[]).join(" · ")}</p>
              </div>
              <div className="price">
                <strong>{money(total)}</strong>
                <span>/ month</span>
              </div>
              <small>Base {money(plan.monthlyBase)} + {money(plan.perEmployee)}/employee · v{plan.version}</small>
              <button className={plan.name === "Scale" ? "primary-button full" : "secondary-button full"} onClick={() => onSelectPlan(plan)}>
                {plan.name === "Enterprise" ? "Upgrade to Enterprise" : `Upgrade to ${plan.name}`} <ArrowUpRight size={15} />
              </button>
            </article>
          );
        })}
      </section>
    </>
  );
}

function AuditPage({ events, organizationId }: { events: AuditEvent[]; organizationId: number }) {
  return (
    <>
      <PageHeading eyebrow="AUDIT TRAIL" title="A record you can inspect." copy="Approval, payroll, export and auth-adjacent actions use a shared server-side audit writer." actions={<a className="secondary-button" href={`/api/exports?organizationId=${organizationId}&kind=audit`}><Download size={16} /> Export log</a>} />
      <article className="card audit-card">
        <div className="table-toolbar"><div className="search-field"><Search size={17} /><input placeholder="Search actions, people, or resources" /></div><button className="filter-button">All activity <ChevronDown size={15} /></button></div>
        <div className="audit-list">
          {events.map((event) => (
            <div className="audit-row" key={event.id}>
              <span className="audit-dot"><Clock3 size={14} /></span>
              <div>
                <strong>{event.action}</strong>
                <p><b>{event.actor}</b> · {event.resource}</p>
              </div>
              <div>
                <span>{event.metadata?.ruleVersion ? `Rule ${event.metadata.ruleVersion}` : "System event"}</span>
                <time>{formatTime(event.createdAt)}</time>
              </div>
            </div>
          ))}
        </div>
        <div className="pagination">
          <span>Showing {events.length} recent events</span>
          <div><button disabled>‹</button><button className="current">1</button><button disabled>›</button></div>
        </div>
      </article>
    </>
  );
}

function SettingsPage({ data, setNotice }: { data: DashboardData; setNotice: (message: string) => void }) {
  const tabs = [
    { key: "organization", label: "Organization profile", icon: Building2 },
    { key: "account", label: "My account", icon: UserCheck },
    { key: "security", label: "Security", icon: LockKeyhole },
    { key: "privacy", label: "Data & privacy", icon: ShieldCheck },
  ];
  const [tab, setTab] = useState("organization");
  return (
    <>
      <PageHeading eyebrow="SETTINGS" title="Company and account controls." copy="Only the sections your role can change are editable. Everything here writes to the database." />
      <section className="settings-layout">
        <article className="card settings-nav">
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.key} className={tab === item.key ? "selected" : ""} onClick={() => setTab(item.key)}>
                <Icon size={17} /> {item.label}
              </button>
            );
          })}
        </article>
        <article className="card settings-detail">
          {tab === "organization" && <OrganizationSettings data={data} setNotice={setNotice} />}
          {tab === "account" && (
            <div>
              <div className="card-header"><div><div className="card-kicker">MY ACCOUNT</div><h2>Sign-in &amp; sessions</h2><p>Change your name, email, password, and revoke devices.</p></div></div>
              <AccountPanel onNotice={setNotice} />
            </div>
          )}
          {tab === "security" && <SecuritySettings data={data} />}
          {tab === "privacy" && <PrivacySettings data={data} setNotice={setNotice} />}
        </article>
      </section>
    </>
  );
}

function OrganizationSettings({ data, setNotice }: { data: DashboardData; setNotice: (message: string) => void }) {
  const [name, setName] = useState(data.selectedOrganization.name);
  const [legalName, setLegalName] = useState(data.selectedOrganization.legalName);
  const [payrollAnnualDivisor, setPayrollAnnualDivisor] = useState(data.selectedOrganization.payrollAnnualDivisor ?? "365.00");
  const [statutoryDeductionMode, setStatutoryDeductionMode] = useState(data.selectedOrganization.statutoryDeductionMode ?? "split_evenly");
  const [busy, setBusy] = useState(false);
  const canEdit = ["admin", "owner"].includes(data.access?.role ?? "");

  async function save() {
    setBusy(true);
    const res = await fetch("/api/organizations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: data.selectedOrganization.id, name, legalName, payrollAnnualDivisor, statutoryDeductionMode }),
    });
    const data2 = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setNotice(data2.error ?? "Could not save.");
    setNotice("Organization profile saved and recorded in the audit trail.");
  }

  return (
    <>
      <div className="card-header"><div><div className="card-kicker">ORGANIZATION PROFILE</div><h2>Company defaults</h2><p>Used across payroll, payslips and government worksheets.</p></div></div>
      <div className="setting-form">
        <label>Trading name<input value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} /></label>
        <label>Legal entity name<input value={legalName} disabled={!canEdit} onChange={(e) => setLegalName(e.target.value)} /></label>
        <label>Plan<input value={data.selectedOrganization.plan} readOnly /><small style={{ color: "var(--muted)", fontWeight: 500 }}>Changed through Pricing, not here.</small></label>
        <label>Annual pay divisor<input type="number" min="200" max="400" step="0.5" value={payrollAnnualDivisor} disabled={!canEdit} onChange={(e) => setPayrollAnnualDivisor(e.target.value)} /><small style={{ color: "var(--muted)", fontWeight: 500 }}>Used to derive daily/hourly rates from monthly salary. Confirm against company policy/CBA.</small></label>
        <label>Statutory deduction timing<select value={statutoryDeductionMode} disabled={!canEdit} onChange={(e) => setStatutoryDeductionMode(e.target.value)}><option value="split_evenly">Split employee shares across both cutoffs</option><option value="second_cutoff">Deduct full monthly employee shares on second cutoff</option></select></label>
        <label>Payroll cycle<input value="Semi-monthly (15th / end of month)" readOnly /><small style={{ color: "var(--muted)", fontWeight: 500 }}>Runs are limited to 16 calendar days per cutoff.</small></label>
      </div>
      {canEdit ? (
        <div className="run-actions">
          <button className="primary-button" disabled={busy || name.trim().length < 2} onClick={save}>
            <Check size={15} /> {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      ) : (
        <div className="notice notice-blue" style={{ margin: "0 18px 14px" }}><LockKeyhole size={16} /><span>Your role ({data.access?.role}) can view but not edit the organization profile.</span></div>
      )}
    </>
  );
}

function SecuritySettings({ data }: { data: DashboardData }) {
  const rows: Array<[string, string, string]> = [
    ["Password hashing", "scrypt with per-user salt", "Enforced"],
    ["Failed-login lockout", "Locks after repeated failures, timed unlock", "Enforced"],
    ["Two-factor (TOTP)", "RFC 6238 challenge between password and session", data.user?.totpEnabled ? "On for you" : "Available, not mandatory"],
    ["Sessions", "Server-side, revocable, hashed tokens", "Enforced"],
    ["Auth rate limiting", data.security?.rateLimit ?? "distributed-postgres", "Enforced"],
    ["Tenant isolation", "Tenant + named permission checks on protected API routes", "Enforced"],
    ["Edge / CDN rate limiting", "Not implemented at the edge", "Not built"],
    ["SSO / SAML", "No identity provider connected", "Not built"],
  ];
  return (
    <>
      <div className="card-header"><div><div className="card-kicker">SECURITY CONTROLS</div><h2>What actually runs</h2><p>Every claim here maps to code on the request path. Anything not built says so.</p></div></div>
      <div className="worksheet-list">
        {rows.map(([label, detail, status]) => (
          <div key={label}>
            <ShieldCheck size={16} style={{ color: status === "Not built" ? "var(--muted)" : "var(--green)" }} />
            <span>{label}<small>{detail}</small></span>
            <Status value={status} />
          </div>
        ))}
      </div>
    </>
  );
}

function PrivacySettings({ data, setNotice }: { data: DashboardData; setNotice: (message: string) => void }) {
  const orgId = data.selectedOrganization.id;
  const [subjectEmail, setSubjectEmail] = useState("");
  const [requestType, setRequestType] = useState("access");
  const [busy, setBusy] = useState(false);

  async function fileRequest() {
    setBusy(true);
    const res = await fetch("/api/compliance/data-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: orgId, subjectEmail, requestType }),
    });
    const payload = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setNotice(payload.error ?? "Could not log the request.");
    setSubjectEmail("");
    setNotice(`Data-subject request logged. ${payload.daysRemaining ?? 30}-day statutory window started.`);
  }

  return (
    <>
      <div className="card-header"><div><div className="card-kicker">DATA &amp; PRIVACY</div><h2>Portability and data-subject requests</h2><p>Export everything, and log access / correction / deletion requests with a statutory due date.</p></div></div>
      <div className="worksheet-list">
        <div>
          <FileSpreadsheet size={16} />
          <span>Full company export (JSON archive)<small>Every download is audit-logged against your user.</small></span>
          <a className="link-button" href={`/api/exports?organizationId=${orgId}&kind=all`}>Download</a>
        </div>
        <div>
          <FileSpreadsheet size={16} />
          <span>Audit trail export (CSV)<small>Actor, action, resource, rule version.</small></span>
          <a className="link-button" href={`/api/exports?organizationId=${orgId}&kind=audit`}>Download</a>
        </div>
      </div>
      <div className="setting-form" style={{ alignItems: "flex-end" }}>
        <label>Subject email
          <input value={subjectEmail} onChange={(e) => setSubjectEmail(e.target.value)} placeholder="employee@company.ph" />
        </label>
        <label>Request type
          <select value={requestType} onChange={(e) => setRequestType(e.target.value)}>
            <option value="access">Access</option>
            <option value="correction">Correction</option>
            <option value="deletion">Deletion</option>
            <option value="portability">Portability</option>
            <option value="objection">Objection</option>
          </select>
        </label>
      </div>
      <div className="run-actions">
        <button className="primary-button" disabled={busy || !subjectEmail.includes("@")} onClick={fileRequest}>
          <ShieldCheck size={15} /> Log data-subject request
        </button>
      </div>
      <div className="notice notice-blue" style={{ margin: "0 18px 14px" }}>
        <LockKeyhole size={16} />
        <span>Requests are tracked with a 30-day due date (Data Privacy Act). NPC registration and a published DPO contact are organisational steps, not code.</span>
      </div>
    </>
  );
}

function NewPayrollModal({ onClose, onCreate, busy, data }: { onClose: () => void; onCreate: (input: { periodStart: string; periodEnd: string; payDate: string; scopeOrgUnitId: number | null; calculationMode: "fixed_salary" | "timekeeping" }) => void; busy: boolean; data: DashboardData }) {
  const [periodStart, setPeriodStart] = useState("2026-09-16");
  const [periodEnd, setPeriodEnd] = useState("2026-09-30");
  const [payDate, setPayDate] = useState("2026-09-30");
  const [scopeOrgUnitId, setScopeOrgUnitId] = useState<number | null>(null);
  const [calculationMode, setCalculationMode] = useState<"fixed_salary" | "timekeeping">("fixed_salary");
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-label="Create payroll draft"><button className="modal-close" onClick={onClose}><X size={18}/></button><div className="modal-icon"><WalletCards size={22}/></div><div className="card-kicker">NEW PAYROLL RUN</div><h2>Create an explicit payroll cutoff</h2><p>The engine calculates only employees and attendance inside this cutoff. Recalculation never settles claims, loans or advances until release.</p><label className="input-label">Period start<input type="date" value={periodStart} onChange={e=>setPeriodStart(e.target.value)}/></label><label className="input-label">Period end<input type="date" value={periodEnd} onChange={e=>setPeriodEnd(e.target.value)}/></label><label className="input-label">Pay date<input type="date" value={payDate} onChange={e=>setPayDate(e.target.value)}/></label><label className="input-label">Run scope<select value={scopeOrgUnitId??""} onChange={e=>setScopeOrgUnitId(e.target.value?Number(e.target.value):null)}><option value="">All permitted locations</option>{data.orgUnits.map(unit=><option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><label className="input-label">Calculation mode<select value={calculationMode} onChange={e=>setCalculationMode(e.target.value as "fixed_salary"|"timekeeping")}><option value="fixed_salary">Fixed salary + attendance adjustments</option><option value="timekeeping">Timekeeping-driven basic pay</option></select></label><div className="modal-note"><ShieldCheck size={16}/>Cutoffs are limited to 16 calendar days. Managed payroll adds a client-approval gate before release.</div><div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy} onClick={()=>onCreate({periodStart,periodEnd,payDate,scopeOrgUnitId,calculationMode})}>{busy?"Processing…":"Create & process"}<ArrowUpRight size={16}/></button></div></section></div>;
}

function OutboxModal({ organizationId, onClose, setNotice }: { organizationId: number; onClose: () => void; setNotice: (message: string) => void }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [selectedMsg, setSelectedMsg] = useState<any>(null);
  const [loaded, setLoaded] = useState(false);

  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(`/api/outbox?organizationId=${organizationId}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (alive) {
          setMessages(data.messages ?? []);
          if (data.messages?.length > 0) setSelectedMsg(data.messages[0]);
        }
      }
      if (alive) setLoaded(true);
    })();
    return () => { alive = false; };
  }, [organizationId, nonce]);

  function load() {
    setNonce((n) => n + 1);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal large" role="dialog" aria-modal="true" aria-label="Outbox Notification Center">
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-icon"><Mail size={22} /></div>
        <div className="card-kicker">NOTIFICATION CENTER & EMAIL OUTBOX</div>
        <h2>Transactional Messages Queue</h2>
        <p>Every invitation, password reset, and payslip-ready notice is recorded in the database outbox. In sandbox mode, view raw rendered messages directly:</p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 14, marginTop: 14 }}>
          <div style={{ border: "1px solid var(--line)", borderRadius: 10, maxHeight: 340, overflowY: "auto" }}>
            {messages.length === 0 && <div className="empty-state">No messages in outbox yet.</div>}
            {messages.map((msg) => (
              <div
                key={msg.id}
                onClick={() => setSelectedMsg(msg)}
                style={{
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--line)",
                  cursor: "pointer",
                  background: selectedMsg?.id === msg.id ? "var(--green-light)" : "white",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>
                  <span>{msg.purpose}</span>
                  <span className={`status status-${msg.status}`}>{msg.status}</span>
                </div>
                <strong style={{ display: "block", fontSize: 11.5 }}>{msg.recipient}</strong>
                <span style={{ fontSize: 11, color: "var(--ink-secondary)", display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{msg.subject}</span>
              </div>
            ))}
          </div>

          <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 14, background: "#fafcfa", maxHeight: 340, overflowY: "auto" }}>
            {selectedMsg ? (
              <>
                <div style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", fontWeight: 800 }}>To: {selectedMsg.recipient}</span>
                  <strong style={{ display: "block", fontSize: 13, marginTop: 2 }}>{selectedMsg.subject}</strong>
                </div>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 11, fontFamily: "monospace", color: "var(--ink-secondary)", lineHeight: 1.5 }}>
                  {selectedMsg.body}
                </pre>
              </>
            ) : (
              <div className="empty-state">Select a message to view content.</div>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}

function CheckoutModal({ organizationId, plan, onClose, onUpgraded }: { organizationId: number; plan: PricingPlan; onClose: () => void; onUpgraded: () => void }) {
  const [billingCycle, setBillingCycle] = useState("monthly");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const basePrice = Number(plan.monthlyBase);
  const finalPrice = billingCycle === "annual" ? basePrice * 10 : basePrice;

  async function checkout() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, plan: plan.name, billingCycle }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Checkout is unavailable.");
        return;
      }
      // A plan is not active yet. PayMongo hosts payment and its verified
      // webhook is the only path that may activate an entitlement.
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      setMessage("Checkout session created. Complete payment in the hosted payment page.");
    } catch {
      setMessage("Could not complete checkout.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-label="Plan Checkout">
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-icon"><CreditCard size={22} /></div>
        <div className="card-kicker">SUBSCRIPTION CHECKOUT</div>
        <h2>Upgrade to {plan.name} Plan</h2>
        <p>Creates a hosted PayMongo checkout session. Your plan changes only after PayMongo confirms payment by webhook.</p>

        <div style={{ background: "var(--canvas-subtle)", padding: 14, borderRadius: 10, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span>Plan Tier</span>
            <strong>{plan.name}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span>Billing Interval</span>
            <select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)} style={{ height: 28, fontSize: 11, padding: "0 6px" }}>
              <option value="monthly">Monthly ({money(basePrice)}/mo)</option>
              <option value="annual">Annual ({money(finalPrice)}/yr · 2 Mo. Free)</option>
            </select>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line)", paddingTop: 8, marginTop: 8 }}>
            <strong>Total Due Now</strong>
            <strong style={{ fontSize: 16, color: "var(--green)" }}>{money(finalPrice)}</strong>
          </div>
        </div>

        <div className="notice notice-blue" style={{ margin: "8px 0 0" }}>
          <span>Hosted checkout supports the payment methods enabled in your PayMongo merchant dashboard (typically card, GCash, and Maya). No payment method is collected inside Linaw.</span>
        </div>

        {message && <div className="notice notice-amber" style={{ margin: "10px 0 0" }}><span>{message}</span></div>}

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={busy} onClick={checkout}>{busy ? "Processing Checkout…" : `Pay ${money(finalPrice)}`}</button>
        </div>
      </section>
    </div>
  );
}

function PayslipInspectModal({ entry, employee, run, onClose }: { entry: PayrollEntry; employee?: Employee; run?: PayrollRun; onClose: () => void }) {
  const trace = entry.trace ?? {};
  const lineItems = (Array.isArray(entry.lineItems) ? entry.lineItems : []) as Array<{ code?: string; label?: string; amount?: number; notes?: string[] }>;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal large" role="dialog" aria-modal="true" aria-label="Payslip Traceability Inspector">
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-icon"><FileText size={22} /></div>
        <div className="card-kicker">CALCULATED PAYSLIP TRACEABILITY</div>
        <h2>{employee ? `${employee.firstName} ${employee.lastName}` : "Employee"} · {employee?.employeeNo}</h2>
        <p>{run?.periodLabel} · Pay Date: {run ? formatDate(run.payDate) : "—"} · Statutory Engine: {run?.ruleVersion ?? "PH-2026.09"}</p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ border: "1px solid var(--line)", padding: 14, borderRadius: 10, background: "white" }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: "var(--green)", textTransform: "uppercase" }}>EARNINGS BREAKDOWN</span>
            <div style={{ marginTop: 8 }}>
              {lineItems.filter((l) => Number(l.amount ?? 0) > 0).map((line, idx) => (
                <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #edf2ee", fontSize: 11.5 }}>
                  <div>
                    <strong>{line.label ?? line.code}</strong>
                    {line.notes && <small style={{ display: "block", color: "var(--muted)", fontSize: 9.5 }}>{line.notes.join(" · ")}</small>}
                  </div>
                  <strong>{money(Number(line.amount))}</strong>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, fontWeight: 800, fontSize: 12 }}>
                <span>Total Gross Pay</span>
                <span>{money(entry.grossPay)}</span>
              </div>
            </div>
          </div>

          <div style={{ border: "1px solid var(--line)", padding: 14, borderRadius: 10, background: "white" }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: "var(--danger)", textTransform: "uppercase" }}>DEDUCTIONS & TAX</span>
            <div style={{ marginTop: 8 }}>
              {lineItems.filter((l) => Number(l.amount ?? 0) < 0).map((line, idx) => (
                <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #edf2ee", fontSize: 11.5 }}>
                  <div>
                    <span>{line.label ?? line.code}</span>
                    {line.notes && <small style={{ display: "block", color: "var(--muted)", fontSize: 9.5 }}>{line.notes.join(" · ")}</small>}
                  </div>
                  <strong style={{ color: "var(--danger)" }}>{money(line.amount!)}</strong>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, fontWeight: 800, fontSize: 12 }}>
                <span>Total Deductions</span>
                <span style={{ color: "var(--danger)" }}>-{money(entry.deductions)}</span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14, padding: "12px 16px", borderRadius: 10, background: "var(--green-light)", display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid var(--green-border)" }}>
          <div>
            <span style={{ fontSize: 10, textTransform: "uppercase", fontWeight: 800, color: "#0e3e34" }}>NET TAKE-HOME PAY</span>
            <strong style={{ display: "block", fontSize: 22, color: "var(--green)" }}>{money(entry.netPay)}</strong>
          </div>
          <a className="primary-button" href={`/api/self/payslips/${entry.id}`}><Download size={15} /> Download PDF Payslip</a>
        </div>

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}

function GovValidationModal({ organizationId, onClose, setNotice }: { organizationId: number; onClose: () => void; setNotice: (message: string) => void }) {
  const [validations, setValidations] = useState<any[]>([]);
  const [checkedAt, setCheckedAt] = useState("");
  const [busy, setBusy] = useState(false);

  async function runValidation() {
    setBusy(true);
    try {
      const res = await fetch("/api/compliance/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const data = await res.json();
      if (res.ok) {
        setValidations(data.validations ?? []);
        setCheckedAt(data.checkedAt ?? "");
        setNotice("Local statutory preflight complete. Portal upload is still required before filing.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal large" role="dialog" aria-modal="true" aria-label="Government Compliance Seal Suite">
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-icon"><ShieldCheck size={22} /></div>
        <div className="card-kicker">STATUTORY LOCAL PREFLIGHT</div>
        <h2>Check your draft before portal upload</h2>
        <p>Checks the local inputs and formulas behind BIR, SSS, PhilHealth, and Pag-IBIG draft exports. It does not replace a government portal acknowledgement.</p>

        <div className="notice notice-amber" style={{ margin: "0 0 14px" }}>
          <HelpCircle size={16} />
          <span><strong>Not a certification.</strong> Upload the generated file to the relevant agency portal and retain its receipt before filing.</span>
        </div>

        <div style={{ marginBottom: 14 }}>
          <button className="primary-button" disabled={busy} onClick={runValidation}>
            {busy ? "Running local checks…" : "Run local preflight"}
          </button>
        </div>

        {validations.length > 0 && (
          <>
            {checkedAt && <p style={{ color: "var(--muted)", fontSize: 11, margin: "0 0 8px" }}>Local check run {formatTime(new Date(checkedAt))}. No government portal response has been recorded.</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 340, overflowY: "auto" }}>
            {validations.map((v, i) => (
              <div key={i} style={{ border: "1px solid var(--line)", padding: 12, borderRadius: 10, background: "white" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <strong>{v.document}</strong>
                  <span className="status status-tested">Local pass · portal pending</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {v.checks.map((c: any, ci: number) => (
                    <div key={ci} style={{ fontSize: 11, color: "var(--ink-secondary)", display: "flex", alignItems: "flex-start", gap: 6 }}>
                      <Check size={13} style={{ color: "var(--green)", marginTop: 2, flex: "none" }} />
                      <div><strong>{c.rule}:</strong> {c.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          </>
        )}

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}

function Avatar({ initials, index }: { initials: string; index: number }) { return <span className={`avatar avatar-${index % 5}`}>{initials}</span>; }
function Status({ value }: { value: string }) { const cls = value.toLowerCase().replaceAll(" ", "-").replaceAll("/", "-"); return <span className={`status status-${cls}`}>{value}</span>; }
function formatDate(date: string) { return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${date}T12:00:00`)); }
function formatTime(value: Date) { const parsed = value instanceof Date ? value : new Date(value); return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(parsed); }
