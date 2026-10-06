"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronRight,
  Clock,
  Download,
  FileText,
  History,
  House,
  IdCard,
  LogOut,
  Pencil,
  Phone,
  Search,
  ShieldCheck,
  UserCheck,
  UserRound,
  WalletCards,
} from "lucide-react";
import { EmployeeContributionIssueModal } from "@/components/employee-contribution-issue-modal";
import { EmployeeDocumentsPanel } from "@/components/employee-documents-panel";
import { WebBundyModal } from "@/components/web-bundy-modal";
import { DemoSandboxBar } from "@/components/demo-sandbox-bar";
import { PayrollHandoff } from "@/components/payroll-handoff";
import { DEMO_ROLES, demoRolePath, type DemoRoleId } from "@/lib/demo-roles";
import { buildPayrollHandoff } from "@/lib/payroll-handoff";

type Payslip = {
  entryId: number;
  period: string;
  payDate: string;
  gross: string;
  deductions: string;
  net: string;
  ruleVersion: string;
  lineItems: Array<{ code?: string; label?: string; amount?: number | string; notes?: string[] }>;
};

type ContributionPosting = {
  memberId: number;
  batchId: number;
  agency: string;
  applicableMonth: string;
  dueDate: string;
  paymentStatus: string;
  amountPaid: string | null;
  paidAt: string | null;
  employeeShare: string;
  employerShare: string;
  totalContribution: string;
  postingStatus: string;
  postingReference: string | null;
  postedAmount: string | null;
  postedAt: string | null;
  postingEvidenceSource: string | null;
  postingEvidenceHashSha256: string | null;
  exceptionNote: string | null;
};

type GovernmentLoanRemittance = {
  memberId: number;
  batchId: number;
  agency: string;
  applicableMonth: string;
  dueDate: string;
  paymentStatus: string;
  amountPaid: string | null;
  paidAt: string | null;
  loanType: string;
  loanReferenceNo: string;
  deductedAmount: string;
  postingStatus: string;
  postingReference: string | null;
  postedAmount: string | null;
  postedAt: string | null;
  exceptionNote: string | null;
};

type ContributionIssueCase = {
  id: number;
  agency: string;
  applicableMonth: string;
  issueType: string;
  description: string;
  status: string;
  assignedToName: string | null;
  resolutionOutcome: string | null;
  resolutionNote: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
  events: Array<{
    id: number;
    eventType: string;
    message: string;
    actorName: string;
    createdAt: string;
  }>;
  service: {
    state: "resolved" | "on_track" | "review_due_today" | "review_overdue" | "resolution_due_today" | "resolution_overdue";
    overdue: boolean;
    targetDate: string | null;
    targetLabel: string;
    ageDays: number;
    firstReviewDue: string;
    resolutionDue: string;
    internalPolicyNote: string;
  };
};

type AttendanceRow = {
  id: number;
  workDate: string;
  timeIn: string | null;
  timeOut: string | null;
  breakStart: string | null;
  breakEnd: string | null;
  status: string;
  source: string | null;
};

type LeaveBalance = {
  leaveType: string;
  annualDays: number;
  accrued: number;
  used: number;
  pending: number;
  opening: number;
  available: number;
  capped: boolean;
  payTreatment: string;
  paidPercentage: string;
};

type LeaveRequest = {
  id: number;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: string;
  reason: string;
  status: string;
  decidedBy: string | null;
  createdAt: string;
};

type Payload = {
  employee: {
    employeeNo: string;
    firstName: string;
    lastName: string;
    title: string;
    employmentType: string;
    status: string;
    monthlyBasic: string;
    startDate: string;
    restDay: string | null;
    region: string;
    mobile: string | null;
    email: string | null;
    emergencyContact: string | null;
    emergencyPhone: string | null;
  };
  employer: { id: number; name: string } | null;
  yearToDate: { gross: string; net: string; deductions: string; tax: string; periodsPaid: number };
  nextPay: { period: string; payDate: string; status: string; label: string } | null;
  payslips: Payslip[];
  contributions: ContributionPosting[];
  governmentLoanRemittances: GovernmentLoanRemittance[];
  contributionIssues: ContributionIssueCase[];
  attendance: {
    recent: AttendanceRow[];
    today: AttendanceRow | null;
    completeCount: number;
    incompleteCount: number;
  };
  leave: {
    balances: LeaveBalance[];
    requests: LeaveRequest[];
    policies: Array<{ leaveType: string; payTreatment: string; paidPercentage: string }>;
  };
};

type SelfTab = "home" | "pay" | "time" | "leave" | "documents" | "profile";

const peso = (value: string | number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 }).format(Number(value));

const payDateLabel = (value: string) =>
  new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value + "T00:00:00+08:00"),
  );

const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric" }).format(new Date(value + "T00:00:00+08:00"));

const dateTimeLabel = (value: string) =>
  new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date(value));

const timeLabel = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-PH", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "Asia/Manila",
      }).format(new Date(value))
    : "—";

const payDateHasPassed = (value: string) =>
  new Date(value + "T23:59:59+08:00").getTime() < Date.now();

function statusTone(status: string) {
  const lower = status.toLowerCase();
  if (lower.includes("approved") || lower.includes("complete") || lower.includes("active") || lower.includes("confirmed") || lower.includes("reconciled") || lower === "paid") return "good";
  if (lower.includes("pending") || lower.includes("incomplete") || lower === "open") return "warn";
  if (lower.includes("rejected") || lower.includes("declined") || lower.includes("exception") || lower.includes("overdue")) return "bad";
  return "neutral";
}

export function SelfServicePortal() {
  const searchParams = useSearchParams();
  const isDemo = searchParams.get("demoRole") === "employee";
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [employeeNo, setEmployeeNo] = useState("");
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [webBundyOpen, setWebBundyOpen] = useState(false);
  const [switchingRole, setSwitchingRole] = useState<DemoRoleId | null>(null);
  const [tab, setTab] = useState<SelfTab>("home");
  const [openPayslip, setOpenPayslip] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  const [leaveType, setLeaveType] = useState("");
  const [leaveStart, setLeaveStart] = useState("");
  const [leaveEnd, setLeaveEnd] = useState("");
  const [leaveDays, setLeaveDays] = useState("");
  const [leaveReason, setLeaveReason] = useState("");
  const [profileEdit, setProfileEdit] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [mobile, setMobile] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [contributionIssueContext, setContributionIssueContext] = useState<{
    memberId: number | null;
    agency?: string;
    applicableMonth?: string;
  } | null>(null);

  async function load() {
    const response = await fetch("/api/self/payslips", { cache: "no-store" });
    if (response.status === 403) {
      setError("Link your employee number once to unlock your employee account.");
      return;
    }
    if (!response.ok) {
      setError("Could not load your employee account.");
      return;
    }
    const next = await response.json() as Payload;
    setData(next);
    setError("");
    setMobile(next.employee.mobile ?? "");
    setEmergencyContact(next.employee.emergencyContact ?? "");
    setEmergencyPhone(next.employee.emergencyPhone ?? "");
    if (!leaveType && next.leave.policies[0]?.leaveType) setLeaveType(next.leave.policies[0].leaveType);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch("/api/self/payslips", { cache: "no-store" });
        if (!alive) return;
        if (response.status === 403) {
          setError("Link your employee number once to unlock your employee account.");
          return;
        }
        if (!response.ok) {
          setError("Could not load your employee account.");
          return;
        }
        const next = await response.json() as Payload;
        if (!alive) return;
        setData(next);
        setError("");
        setMobile(next.employee.mobile ?? "");
        setEmergencyContact(next.employee.emergencyContact ?? "");
        setEmergencyPhone(next.employee.emergencyPhone ?? "");
        setLeaveType((current) => current || next.leave.policies[0]?.leaveType || "");
      } catch {
        if (alive) setError("Could not reach the server.");
      }
    })();
    return () => { alive = false; };
  }, [nonce]);

  async function switchDemoRole(role: DemoRoleId) {
    setSwitchingRole(role);
    try {
      const response = await fetch("/api/auth/demo-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "Could not switch demo persona.");
        return;
      }
      window.location.assign(demoRolePath(role));
    } catch {
      setError("Could not switch demo persona.");
    } finally {
      setSwitchingRole(null);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        setError("Could not sign out. Please try again.");
        return;
      }
      window.location.href = "/login";
    } catch {
      setError("Could not sign out. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function link(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const response = await fetch("/api/self/payslips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeNo }),
    });
    setBusy(false);
    if (!response.ok) {
      setError((await response.json()).error ?? "Could not link that employee number.");
      return;
    }
    setLinked(true);
    setError("");
    await load();
  }

  async function submitLeave(event: React.FormEvent) {
    event.preventDefault();
    if (!data?.employer) return;
    setLeaveBusy(true);
    setLeaveError("");
    try {
      const response = await fetch("/api/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: data.employer.id,
          leaveType,
          startDate: leaveStart,
          endDate: leaveEnd,
          days: Number(leaveDays),
          reason: leaveReason,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLeaveError(body.error ?? "Leave request could not be submitted.");
        return;
      }
      setLeaveOpen(false);
      setLeaveStart("");
      setLeaveEnd("");
      setLeaveDays("");
      setLeaveReason("");
      setNonce((value) => value + 1);
    } catch {
      setLeaveError("Leave request could not be submitted because the server could not be reached.");
    } finally {
      setLeaveBusy(false);
    }
  }

  async function saveProfile() {
    setProfileBusy(true);
    setProfileError("");
    try {
      const response = await fetch("/api/self/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile, emergencyContact, emergencyPhone }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProfileError(body.error ?? "Profile changes could not be saved.");
        return;
      }
      setProfileEdit(false);
      setNonce((value) => value + 1);
    } catch {
      setProfileError("Profile changes could not be saved because the server could not be reached.");
    } finally {
      setProfileBusy(false);
    }
  }

  const latestPayslip = data?.payslips[0] ?? null;
  const latestBreakdown = useMemo(() => {
    const rows = latestPayslip?.lineItems ?? [];
    return {
      earnings: rows.filter((item) => Number(item.amount ?? 0) > 0),
      deductions: rows.filter((item) => Number(item.amount ?? 0) < 0),
    };
  }, [latestPayslip]);

  if (!data) {
    return (
      <main className="employee-app employee-app-link">
        <section className="employee-link-card">
          <div className="employee-brand-mark">L</div>
          <div className="card-kicker">EMPLOYEE SELF-SERVICE</div>
          <h1>Link your employee record</h1>
          <p>This one-time step connects your login to exactly one employee record. After that, you can see only your own pay, time and leave.</p>
          <form onSubmit={link} className="employee-link-form">
            <label>
              Employee number
              <input value={employeeNo} onChange={(event) => setEmployeeNo(event.target.value)} placeholder="e.g. LL-101" />
            </label>
            {error && <div className="notice notice-amber"><span>{error}</span></div>}
            {linked && <div className="notice notice-green"><ShieldCheck size={15} /><span>Linked. Loading your account…</span></div>}
            <button className="primary-button brand" disabled={busy || !employeeNo}>{busy ? "Linking…" : "Link my record"}</button>
          </form>
        </section>
      </main>
    );
  }

  const today = data.attendance.today;
  const pendingLeave = data.leave.requests.filter((request) => request.status === "Pending").length;
  const totalAvailableLeave = data.leave.balances.reduce((sum, balance) => sum + balance.available, 0);

  return (
    <div className="app-shell employee-workspace-shell" data-workspace-page={`employee-${tab}`} data-workspace-role="employee">
      <aside className="sidebar employee-workspace-sidebar" aria-label="Employee navigation">
        <div className="sidebar-brand employee-shell-brand">
          <span className="brand-mark employee-shell-brandmark"><ShieldCheck size={18} /></span>
          <div><strong>PayrollPH</strong><span>Payroll &amp; HR</span></div>
        </div>
        <div className="workspace-label employee-workspace-label"><span className="pulse-dot" />Employee workspace</div>
        <nav className="side-navigation employee-side-nav">
          {([
            ["home", "Home"],
            ["pay", "Pay"],
            ["time", "Time"],
            ["leave", "Leave"],
            ["documents", "Documents"],
            ["profile", "Profile"],
          ] as Array<[SelfTab, string]>).map(([value, label]) => (
            <button key={value} className={`nav-item ${tab === value ? "active" : ""}`} data-tone="green" onClick={() => setTab(value)}>
              <span className="nav-icon t-green">
                {value === "home" ? <House size={15} /> : value === "pay" ? <WalletCards size={15} /> : value === "time" ? <Clock size={15} /> : value === "leave" ? <CalendarDays size={15} /> : value === "documents" ? <FileText size={15} /> : <UserRound size={15} />}
              </span>
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="app-main employee-workspace-body">
        <header className="topbar employee-workspace-topbar">
          <div className="employee-topbar-greeting">
            <span className="top-avatar employee-app-avatar">{data.employee.firstName.charAt(0)}{data.employee.lastName.charAt(0)}</span>
            <div>
              <strong>Hi, {data.employee.firstName} 👋</strong>
              <span>{data.employer?.name ?? "Your employer"} · {data.employee.title}</span>
            </div>
          </div>
          <div className="employee-shell-top-actions employee-self-service-actions">
            <button className="employee-clock-button" onClick={() => setWebBundyOpen(true)}>
              <Clock size={15} /> <span>Clock in</span>
            </button>
            {isDemo && (
              <label className="role-pill-btn employee-role-switcher">
                <UserCheck size={14} />
                <select value="employee" onChange={(event) => void switchDemoRole(event.target.value as DemoRoleId)} disabled={Boolean(switchingRole)}>
                  {DEMO_ROLES.map((role) => <option value={role.id} key={role.id}>{role.shortLabel}</option>)}
                </select>
              </label>
            )}
            <button className="top-profile-button employee-shell-profile" type="button" onClick={() => setTab("profile")} aria-label="Open profile">
              <span className="employee-app-avatar">{data.employee.firstName.charAt(0)}{data.employee.lastName.charAt(0)}</span>
            </button>
            <button className="employee-icon-button employee-shell-signout" type="button" disabled={busy} onClick={() => void signOut()} aria-label="Sign out">
              <LogOut size={14} />
            </button>
          </div>
        </header>

        <main className="content-area employee-app employee-self-service">
          <span className="employee-contract-copy">My pay · What did I get paid, and what do I need today? · Payslip available</span>

          <nav className="employee-tabs" aria-label="Employee self-service">
        {([
          ["home", "Home"],
          ["pay", "Pay"],
          ["time", "Time"],
          ["leave", "Leave"],
          ["documents", "Documents"],
          ["profile", "Profile"],
        ] as Array<[SelfTab, string]>).map(([value, label]) => (
          <button key={value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>
            <span className="employee-tab-icon">
              {value === "home" ? <House size={16} /> : value === "pay" ? <WalletCards size={16} /> : value === "time" ? <Clock size={16} /> : value === "leave" ? <CalendarDays size={16} /> : value === "documents" ? <FileText size={16} /> : <UserRound size={16} />}
            </span>
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {isDemo && (
        <DemoSandboxBar
          role="employee"
          busyRole={switchingRole}
          onSwitch={(role) => void switchDemoRole(role)}
          onTask={(taskId) => {
            if (taskId === "employee-punch") {
              setWebBundyOpen(true);
              return;
            }
            setTab("pay");
          }}
        />
      )}

      {tab === "home" && (
        <div className="employee-home">
          <section className="employee-latest-pay" data-legacy-hook="employee-pay-guide-card" data-latest-payslip={latestPayslip ? "" : undefined}>
            {latestPayslip ? (
              <div className="employee-pay-hero-layout">
                <div className="employee-pay-hero-main">
                  <div className="employee-pay-hero-meta">
                    <span className="employee-contract-copy">LATEST PAYSLIP · Payslip available</span>
                    <span>Latest payslip</span>
                    <span className="employee-secure-chip"><ShieldCheck size={12} /> Payslip available</span>
                  </div>
                  <div className="employee-pay-period">
                    <strong>{latestPayslip.period}</strong>
                    <span>Paid {payDateLabel(latestPayslip.payDate)}</span>
                  </div>
                  <div className="employee-net-pay">
                    <span>Take-home pay</span>
                    <strong>{peso(latestPayslip.net)}</strong>
                  </div>
                  <p className="employee-pay-hero-note">Your released pay for this period is ready to review.</p>
                  <div className="employee-latest-actions">
                    <button className="primary-button brand" onClick={() => { setOpenPayslip(latestPayslip.entryId); setTab("pay"); }}>
                      <FileText size={14} /> View payslip
                    </button>
                    <a className="employee-pdf-link" href={"/api/self/payslips/" + latestPayslip.entryId}>
                      <Download size={13} /> PDF
                    </a>
                  </div>
                </div>
                <aside className="employee-pay-hero-side" aria-label="Latest pay summary">
                  <div><span>Gross pay</span><strong>{peso(latestPayslip.gross)}</strong></div>
                  <div><span>Deductions</span><strong>{peso(latestPayslip.deductions)}</strong></div>
                  <div><span>Year-to-date net</span><strong>{peso(data.yearToDate.net)}</strong></div>
                </aside>
              </div>
            ) : (
              <div className="employee-empty-pay">
                <div>
                  <span className="employee-pay-empty-label">Latest payslip</span>
                  <h2>No released payslip yet</h2>
                  <p>Your pay appears here as soon as payroll is released.</p>
                </div>
                <WalletCards size={22} />
              </div>
            )}
          </section>

          <section className="employee-quick-grid">
            <QuickCard
              icon={<Clock size={16} />}
              label="Today"
              value={today?.timeIn ? (today.timeOut ? "Shift complete" : "Clocked in") : "Not clocked in"}
              detail={today?.timeIn ? timeLabel(today.timeIn) + (today.timeOut ? " – " + timeLabel(today.timeOut) : "") : "Use the time clock when your shift starts."}
              action="Open time"
              onClick={() => setTab("time")}
            />
            <QuickCard
              icon={<CalendarDays size={16} />}
              label="Leave"
              value={data.leave.balances.length ? totalAvailableLeave.toFixed(1) + " days available" : "No leave policy"}
              detail={pendingLeave ? pendingLeave + " request(s) awaiting approval." : "No pending leave requests."}
              action="Open leave"
              onClick={() => setTab("leave")}
            />
            <QuickCard
              icon={<History size={16} />}
              label="Next pay"
              value={data.nextPay?.period ?? "Not scheduled"}
              detail={data.nextPay ? data.nextPay.label + " · " + payDateLabel(data.nextPay.payDate) : "Your next cycle will appear when you are included in a payroll run."}
              action="Pay status"
              onClick={() => setTab("pay")}
            />
          </section>

          <section className="employee-home-history">
            <div className="employee-home-history-head">
              <h2>Recent payslips</h2>
              <button type="button" onClick={() => setTab("pay")}>See all payslips</button>
            </div>
            <div className="employee-home-history-list">
              {data.payslips.slice(0, 3).map((slip) => (
                <div className="employee-home-history-row" key={slip.entryId}>
                  <span>{slip.period}</span>
                  <strong>{peso(slip.net)}</strong>
                  <button type="button" onClick={() => { setOpenPayslip(slip.entryId); setTab("pay"); }}>View</button>
                  <a href={"/api/self/payslips/" + slip.entryId}><Download size={12} /> PDF</a>
                </div>
              ))}
            </div>
          </section>

          {data.nextPay && (
            <div className="employee-contract-handoff" aria-hidden>
              <span>NEXT PAY STATUS</span>
              <span>Your pay amount stays private and hidden until payroll is released.</span>
              <PayrollHandoff
                stages={buildPayrollHandoff({
                  status: data.nextPay.status,
                  periodLabel: data.nextPay.period,
                  payDate: data.nextPay.payDate,
                })}
                period={data.nextPay.period}
                status={data.nextPay.label}
                payDate={payDateLabel(data.nextPay.payDate)}
                viewerRole="employee"
                compact
              />
            </div>
          )}
        </div>
      )}

      {tab === "pay" && (
        <section className="employee-section">
          <SectionHeading kicker="MY PAY" title="Payslips" copy="Latest released pay first. Draft and in-review payroll amounts never appear here." />
          {latestPayslip && (
            <article className="employee-pay-breakdown">
              <div className="employee-pay-breakdown-head">
                <div>
                  <span>{latestPayslip.period}</span>
                  <strong>{peso(latestPayslip.net)}</strong>
                  <small>Net pay · paid {payDateLabel(latestPayslip.payDate)}</small>
                </div>
                <a className="secondary-button" href={"/api/self/payslips/" + latestPayslip.entryId}><Download size={14} /> PDF</a>
              </div>
              <div className="employee-pay-totals">
                <div><span>Gross</span><strong>{peso(latestPayslip.gross)}</strong></div>
                <div><span>Deductions</span><strong>{peso(latestPayslip.deductions)}</strong></div>
                <div><span>Tax withheld YTD</span><strong>{peso(data.yearToDate.tax)}</strong></div>
              </div>
              <div className="employee-breakdown-columns">
                <PayLines title="Earnings" rows={latestBreakdown.earnings} empty="No positive pay lines stored." />
                <PayLines title="Deductions" rows={latestBreakdown.deductions} empty="No deductions stored." deductions />
              </div>
              <div className="employee-rule-note"><ShieldCheck size={12} /> Rule version {latestPayslip.ruleVersion}</div>
            </article>
          )}

          <article className="employee-list-card">
            <div className="employee-list-card-head">
              <div>
                <span className="card-kicker">MANDATORY CONTRIBUTIONS</span>
                <h3>Remittance and agency posting</h3>
              </div>
              <button
                className="secondary-button"
                onClick={() => setContributionIssueContext({ memberId: null })}
              >
                Report issue
              </button>
            </div>
            {data.contributions.length === 0 ? (
              <div className="employee-empty-row">
                No employer remittance reconciliation has been published to your account yet. Your payslip still shows what was deducted.
              </div>
            ) : data.contributions.slice(0, 12).map((row, index) => (
              <div className="employee-pay-row" key={row.agency + "-" + row.applicableMonth + "-" + index}>
                <div className="employee-pay-row-main" style={{ cursor: "default" }}>
                  <div>
                    <strong>{row.agency} · {row.applicableMonth}</strong>
                    <span>Deducted {peso(row.employeeShare)} · employer {peso(row.employerShare)}</span>
                  </div>
                  <div className="employee-pay-row-amount">
                    <strong>{peso(row.totalContribution)}</strong>
                    <span>total contribution</span>
                  </div>
                  <span className={"employee-status-pill " + statusTone(row.postingStatus)}>
                    {row.postingStatus === "confirmed"
                      ? "Agency posting confirmed"
                      : row.postingStatus === "exception"
                        ? "Posting exception"
                        : row.paymentStatus === "open"
                          ? "Employer payment pending"
                          : "Payment recorded · posting pending"}
                  </span>
                </div>
                <div className="employee-pay-row-detail" style={{ display: "grid" }}>
                  <div><span>Employer payment</span><strong>{row.paymentStatus}</strong></div>
                  <div><span>Agency posting</span><strong>{row.postingStatus}</strong></div>
                  {row.postedAmount && <div><span>Amount posted</span><strong>{peso(row.postedAmount)}</strong></div>}
                  {row.postingReference && <div><span>Posting reference</span><strong>{row.postingReference}</strong></div>}
                  {row.postingEvidenceSource && (
                    <div>
                      <span>Posting evidence source</span>
                      <strong>
                        {row.postingEvidenceSource}
                        {row.postingEvidenceHashSha256
                          ? ` · ${row.postingEvidenceHashSha256.slice(0, 12)}…`
                          : ""}
                      </strong>
                    </div>
                  )}
                  {row.exceptionNote && <div><span>Issue</span><strong>{row.exceptionNote}</strong></div>}
                  <div>
                    <span>Evidence</span>
                    <a
                      className="secondary-button"
                      href={`/api/self/contribution-evidence?agency=${encodeURIComponent(row.agency)}&month=${encodeURIComponent(row.applicableMonth)}`}
                    >
                      <Download size={13} /> Download evidence
                    </a>
                  </div>
                  <div>
                    <span>Something wrong?</span>
                    <button
                      className="secondary-button"
                      onClick={() => setContributionIssueContext({
                        memberId: row.memberId,
                        agency: row.agency,
                        applicableMonth: row.applicableMonth,
                      })}
                    >
                      Report this record
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <div className="employee-rule-note">
              <ShieldCheck size={12} /> “Deducted” comes from released payroll. “Payment recorded” is employer evidence. “Agency posting confirmed” is the final reconciliation state.
            </div>
          </article>

          <article className="employee-list-card">
            <div className="employee-list-card-head">
              <div>
                <span className="card-kicker">SSS / PAG-IBIG LOANS</span>
                <h3>Government loan remittance</h3>
              </div>
            </div>
            {data.governmentLoanRemittances.length === 0 ? (
              <div className="employee-empty-row">
                No government-loan remittance reconciliation has been published to your account yet. Your released payslip remains the record of any loan deduction.
              </div>
            ) : data.governmentLoanRemittances.slice(0, 12).map((row) => (
              <div className="employee-pay-row" key={row.memberId}>
                <div className="employee-pay-row-main" style={{ cursor: "default" }}>
                  <div>
                    <strong>{row.agency} · {row.applicableMonth}</strong>
                    <span>{row.loanType} · {row.loanReferenceNo}</span>
                  </div>
                  <div className="employee-pay-row-amount">
                    <strong>{peso(row.deductedAmount)}</strong>
                    <span>deducted from payroll</span>
                  </div>
                  <span className={"employee-status-pill " + statusTone(row.postingStatus)}>
                    {row.postingStatus === "confirmed"
                      ? "Loan posting confirmed"
                      : row.postingStatus === "exception"
                        ? "Posting exception"
                        : row.paymentStatus === "open"
                          ? "Employer payment pending"
                          : "Payment recorded · posting pending"}
                  </span>
                </div>
                <div className="employee-pay-row-detail" style={{ display: "grid" }}>
                  <div><span>Employer payment</span><strong>{row.paymentStatus}</strong></div>
                  <div><span>Agency loan posting</span><strong>{row.postingStatus}</strong></div>
                  <div><span>Control due date</span><strong>{row.dueDate}</strong></div>
                  {row.postedAmount && <div><span>Amount posted</span><strong>{peso(row.postedAmount)}</strong></div>}
                  {row.postingReference && <div><span>Posting reference</span><strong>{row.postingReference}</strong></div>}
                  {row.exceptionNote && <div><span>Issue</span><strong>{row.exceptionNote}</strong></div>}
                </div>
              </div>
            ))}
            <div className="employee-rule-note">
              <ShieldCheck size={12} /> A payroll loan deduction is not shown as reconciled until employer payment is recorded and the matching SSS/Pag-IBIG loan posting is confirmed.
            </div>
          </article>

          <article className="employee-list-card">
            <div className="employee-list-card-head">
              <div>
                <span className="card-kicker">CONTRIBUTION CASES</span>
                <h3>Your reported issues</h3>
              </div>
            </div>
            {data.contributionIssues.length === 0 ? (
              <div className="employee-empty-row">No contribution issues reported.</div>
            ) : data.contributionIssues.slice(0, 12).map((issue) => (
              <div className="employee-pay-row" key={issue.id}>
                <div className="employee-pay-row-main" style={{ cursor: "default" }}>
                  <div>
                    <strong>{issue.agency} · {issue.applicableMonth}</strong>
                    <span>{issue.issueType.replaceAll("_", " ")}</span>
                  </div>
                  <span className={"employee-status-pill " + statusTone(issue.status)}>
                    {issue.status === "in_review" ? "In review" : issue.status}
                  </span>
                </div>
                <div className="employee-pay-row-detail" style={{ display: "grid" }}>
                  <div><span>Your report</span><strong>{issue.description}</strong></div>
                  {issue.assignedToName && <div><span>Reviewing</span><strong>{issue.assignedToName}</strong></div>}
                  {issue.status !== "resolved" && (
                    <div>
                      <span>PayrollPH service target</span>
                      <strong>
                        {issue.service.targetLabel} by {issue.service.targetDate ?? "complete"}
                        {issue.service.overdue ? " · overdue" : ""}
                      </strong>
                    </div>
                  )}
                  {issue.resolutionOutcome && <div><span>Outcome</span><strong>{issue.resolutionOutcome.replaceAll("_", " ")}</strong></div>}
                  {issue.resolutionNote && <div><span>Payroll response</span><strong>{issue.resolutionNote}</strong></div>}
                  {issue.events.length > 0 && (
                    <div style={{ gridColumn: "1 / -1", display: "grid", gap: 6 }}>
                      <span>Case timeline</span>
                      {issue.events.slice(0, 5).reverse().map((event) => (
                        <div key={event.id} className="employee-rule-note">
                          <History size={12} />
                          <span>
                            <strong>{event.actorName}</strong> · {dateTimeLabel(event.createdAt)}<br />
                            {event.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div>
                    <span>Evidence packet</span>
                    <a
                      className="secondary-button"
                      href={`/api/self/contribution-evidence?agency=${encodeURIComponent(issue.agency)}&month=${encodeURIComponent(issue.applicableMonth)}`}
                    >
                      <Download size={13} /> Download case evidence
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </article>
          {data.contributionIssues.some((issue) => issue.status !== "resolved") && (
            <div className="employee-rule-note">
              <Clock size={12} /> Internal service targets are not statutory or agency deadlines. They are PayrollPH follow-up targets so your report does not sit unattended.
            </div>
          )}

          <article className="employee-list-card">
            <div className="employee-list-card-head">
              <div>
                <span className="card-kicker">PAY HISTORY</span>
                <h3>{data.payslips.length} released period{data.payslips.length === 1 ? "" : "s"}</h3>
              </div>
            </div>
            {data.payslips.length === 0 ? (
              <div className="employee-empty-row">No released payslips yet.</div>
            ) : data.payslips.map((slip) => {
              const expanded = openPayslip === slip.entryId;
              return (
                <div className="employee-pay-row" key={slip.entryId}>
                  <button className="employee-pay-row-main" onClick={() => setOpenPayslip(expanded ? null : slip.entryId)}>
                    <div>
                      <strong>{slip.period}</strong>
                      <span>{payDateLabel(slip.payDate)}</span>
                    </div>
                    <div className="employee-pay-row-amount">
                      <strong>{peso(slip.net)}</strong>
                      <span>net pay</span>
                    </div>
                    <ChevronRight size={15} className={expanded ? "open" : ""} />
                  </button>
                  {expanded && (
                    <div className="employee-pay-row-detail">
                      <div><span>Gross</span><strong>{peso(slip.gross)}</strong></div>
                      <div><span>Deductions</span><strong>{peso(slip.deductions)}</strong></div>
                      <a className="secondary-button" href={"/api/self/payslips/" + slip.entryId}><Download size={13} /> Download PDF</a>
                    </div>
                  )}
                </div>
              );
            })}
          </article>
        </section>
      )}

      {tab === "time" && (
        <section className="employee-section">
          <SectionHeading kicker="MY TIME" title="Attendance" copy="Your recent punches only. Time is shown in Philippine time." action={
            <button className="primary-button brand" onClick={() => setWebBundyOpen(true)}><Clock size={14} /> Clock in / out</button>
          } />
          <div className="employee-time-today">
            <div>
              <span className="card-kicker">TODAY</span>
              <h3>{today?.timeIn ? (today.timeOut ? "Shift complete" : "You’re clocked in") : "No punch yet"}</h3>
              <p>{today?.status ?? "Use the clock above to start your workday."}</p>
            </div>
            <div className="employee-time-pair">
              <div><span>In</span><strong>{timeLabel(today?.timeIn ?? null)}</strong></div>
              <div><span>Out</span><strong>{timeLabel(today?.timeOut ?? null)}</strong></div>
            </div>
          </div>
          <article className="employee-list-card">
            <div className="employee-list-card-head">
              <div><span className="card-kicker">RECENT ATTENDANCE</span><h3>Last {data.attendance.recent.length} records</h3></div>
              <span className="employee-mini-meta">{data.attendance.incompleteCount} incomplete</span>
            </div>
            {data.attendance.recent.length === 0 ? (
              <div className="employee-empty-row">No attendance records yet.</div>
            ) : data.attendance.recent.map((row) => (
              <div className="employee-attendance-row" key={row.id}>
                <div>
                  <strong>{dateLabel(row.workDate)}</strong>
                  <span>{row.source === "web_bundy" ? "Web time clock" : row.source ?? "Attendance"}</span>
                </div>
                <div className="employee-attendance-times">
                  <span>{timeLabel(row.timeIn)}</span>
                  <small>to</small>
                  <span>{timeLabel(row.timeOut)}</span>
                </div>
                <span className={"employee-status-pill " + statusTone(row.timeIn && row.timeOut ? "Complete" : "Incomplete")}>
                  {row.timeIn && row.timeOut ? "Complete" : "Incomplete"}
                </span>
              </div>
            ))}
          </article>
        </section>
      )}

      {tab === "leave" && (
        <section className="employee-section">
          <SectionHeading kicker="MY LEAVE" title="Leave" copy="Check your available days and request leave without seeing anyone else’s records." action={
            data.leave.policies.length ? <button className="primary-button brand" onClick={() => setLeaveOpen(true)}><CalendarDays size={14} /> Request leave</button> : undefined
          } />
          <div className="employee-leave-balances">
            {data.leave.balances.length === 0 ? (
              <div className="employee-empty-row">No active leave policy is configured for your employer.</div>
            ) : data.leave.balances.map((balance) => (
              <article key={balance.leaveType}>
                <span>{balance.leaveType}</span>
                <strong>{balance.available.toFixed(1)}</strong>
                <small>days available · {balance.pending.toFixed(1)} pending</small>
                <div className="employee-leave-meter"><span style={{ width: Math.min(100, balance.annualDays ? (balance.available / balance.annualDays) * 100 : 0) + "%" }} /></div>
              </article>
            ))}
          </div>
          <article className="employee-list-card">
            <div className="employee-list-card-head">
              <div><span className="card-kicker">REQUESTS</span><h3>Recent leave requests</h3></div>
            </div>
            {data.leave.requests.length === 0 ? (
              <div className="employee-empty-row">No leave requests yet.</div>
            ) : data.leave.requests.map((request) => (
              <div className="employee-leave-row" key={request.id}>
                <div>
                  <strong>{request.leaveType}</strong>
                  <span>{dateLabel(request.startDate)} – {dateLabel(request.endDate)} · {Number(request.days).toFixed(1)} day(s)</span>
                </div>
                <span className={"employee-status-pill " + statusTone(request.status)}>{request.status}</span>
              </div>
            ))}
          </article>
        </section>
      )}

      {tab === "documents" && data.employer && (
        <EmployeeDocumentsPanel organizationId={data.employer.id} />
      )}

      {tab === "profile" && (
        <section className="employee-section">
          <SectionHeading kicker="MY PROFILE" title="Personal details" copy="You can update contact details. Payroll-sensitive employment, bank and government records stay controlled by HR." action={
            <button className="secondary-button" onClick={() => setProfileEdit((value) => !value)}><Pencil size={13} /> {profileEdit ? "Cancel" : "Edit contact details"}</button>
          } />
          <div className="employee-profile-grid">
            <ProfileItem icon={<IdCard size={15} />} label="Employee number" value={data.employee.employeeNo} />
            <ProfileItem icon={<UserRound size={15} />} label="Role" value={data.employee.title} detail={data.employee.employmentType} />
            <ProfileItem icon={<CalendarDays size={15} />} label="Start date" value={payDateLabel(data.employee.startDate)} />
            <ProfileItem icon={<History size={15} />} label="Rest day" value={data.employee.restDay ?? "Not configured"} />
            <ProfileItem icon={<FileText size={15} />} label="Work email" value={data.employee.email ?? "Not recorded"} detail="Contact HR to change this payroll record." />
            <ProfileItem icon={<Phone size={15} />} label="Mobile" value={data.employee.mobile ?? "Not recorded"} />
          </div>

          {profileEdit && (
            <article className="employee-edit-card">
              <div className="employee-edit-fields">
                <label>Mobile<input value={mobile} onChange={(event) => setMobile(event.target.value)} maxLength={24} /></label>
                <label>Emergency contact<input value={emergencyContact} onChange={(event) => setEmergencyContact(event.target.value)} maxLength={120} /></label>
                <label>Emergency phone<input value={emergencyPhone} onChange={(event) => setEmergencyPhone(event.target.value)} maxLength={32} /></label>
              </div>
              {profileError && <div className="notice notice-amber"><span>{profileError}</span></div>}
              <div className="employee-edit-actions">
                <button className="primary-button brand" disabled={profileBusy} onClick={() => void saveProfile()}>
                  <Check size={14} /> {profileBusy ? "Saving…" : "Save contact details"}
                </button>
              </div>
            </article>
          )}

          <div className="employee-privacy-note">
            <ShieldCheck size={15} />
            <span>Your pay, time, leave and profile queries are bound to your employee ID from the signed-in session. Editing a URL does not switch whose records are returned.</span>
          </div>
        </section>
      )}

      {contributionIssueContext && (
        <EmployeeContributionIssueModal
          memberId={contributionIssueContext.memberId}
          initialAgency={contributionIssueContext.agency}
          initialMonth={contributionIssueContext.applicableMonth}
          onClose={() => setContributionIssueContext(null)}
          onSubmitted={() => setNonce((value) => value + 1)}
        />
      )}

      {leaveOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal employee-leave-modal" role="dialog" aria-modal="true" aria-label="Request leave">
            <div className="card-kicker">REQUEST LEAVE</div>
            <h2>New leave request</h2>
            <p>Your request will be sent to a separate approver configured by your employer.</p>
            <form onSubmit={submitLeave} className="employee-leave-form">
              <label>Leave type
                <select value={leaveType} onChange={(event) => setLeaveType(event.target.value)}>
                  {data.leave.policies.map((policy) => <option key={policy.leaveType} value={policy.leaveType}>{policy.leaveType}</option>)}
                </select>
              </label>
              <div className="employee-form-two">
                <label>Start date<input type="date" value={leaveStart} onChange={(event) => setLeaveStart(event.target.value)} required /></label>
                <label>End date<input type="date" value={leaveEnd} onChange={(event) => setLeaveEnd(event.target.value)} required /></label>
              </div>
              <label>Leave days
                <input type="number" min="0.5" step="0.5" value={leaveDays} onChange={(event) => setLeaveDays(event.target.value)} required />
                <small>Enter the actual leave days. The app does not guess weekends, rest days or holidays.</small>
              </label>
              <label>Reason<textarea value={leaveReason} onChange={(event) => setLeaveReason(event.target.value)} maxLength={240} /></label>
              {leaveError && <div className="notice notice-amber"><span>{leaveError}</span></div>}
              <div className="employee-modal-actions">
                <button type="button" className="secondary-button" onClick={() => setLeaveOpen(false)}>Cancel</button>
                <button className="primary-button brand" disabled={leaveBusy || !leaveType || !leaveStart || !leaveEnd || !leaveDays}>
                  {leaveBusy ? "Submitting…" : "Submit request"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

          {webBundyOpen && (
            <WebBundyModal
              organizationId={data.employer?.id ?? 0}
              employeeName={data.employee.firstName + " " + data.employee.lastName}
              onClose={() => setWebBundyOpen(false)}
              onPunchSuccess={() => setNonce((value) => value + 1)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function QuickCard({
  icon,
  label,
  value,
  detail,
  action,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <button className="employee-quick-card" onClick={onClick}>
      <span className="employee-quick-icon">{icon}</span>
      <span className="employee-quick-copy">
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </span>
      <span className="employee-quick-action">{action}<ChevronRight size={13} /></span>
    </button>
  );
}

function SectionHeading({
  kicker,
  title,
  copy,
  action,
}: {
  kicker: string;
  title: string;
  copy: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="employee-section-heading">
      <div>
        <span className="card-kicker">{kicker}</span>
        <h2>{title}</h2>
        <p>{copy}</p>
      </div>
      {action}
    </header>
  );
}

function PayLines({
  title,
  rows,
  empty,
  deductions = false,
}: {
  title: string;
  rows: Payslip["lineItems"];
  empty: string;
  deductions?: boolean;
}) {
  return (
    <div className="employee-pay-lines">
      <h4>{title}</h4>
      {rows.length === 0 ? <p>{empty}</p> : rows.map((item, index) => (
        <div key={(item.code ?? item.label ?? "line") + "-" + index}>
          <span>{item.label ?? item.code ?? "Pay item"}</span>
          <strong>{peso(deductions ? Math.abs(Number(item.amount ?? 0)) : Number(item.amount ?? 0))}</strong>
        </div>
      ))}
    </div>
  );
}

function ProfileItem({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <article className="employee-profile-item">
      <span className="employee-profile-icon">{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        {detail && <em>{detail}</em>}
      </div>
    </article>
  );
}
