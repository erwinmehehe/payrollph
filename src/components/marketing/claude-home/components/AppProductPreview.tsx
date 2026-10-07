"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LinawMark } from "@/components/linaw-mark";
import { DEMO_ROLES, type DemoRoleId } from "@/lib/demo-roles";
import { workspacePrimaryPagesForRole } from "@/lib/workspace-role-ui";
import { NAVIGATION } from "@/components/workspace/nav";
import {
  AlertCircle, ArrowRight, CalendarDays, Check, ChevronRight,
  ClipboardCheck, Clock3, FileText, Leaf, LockKeyhole, ShieldCheck,
  UsersRound, WalletCards,
} from "lucide-react";

/**
 * A clearly labelled interactive marketing preview of the live app.
 * Mirrors the real CleanRoleDashboard / RoleOverviewV2 / EmployeeHomeDashboard
 * role structure without invoking payroll APIs or representing sample values
 * as a real employer's records.
 */
export function AppProductPreview({ role, compact = false }: { role: DemoRoleId; compact?: boolean }) {
  const info = DEMO_ROLES.find((item) => item.id === role);
  const rawNav = workspacePrimaryPagesForRole(role) ?? ["My pay", "Attendance", "Leave"];
  const nav = rawNav.slice(0, compact ? 4 : 5);
  const [selectedNav, setSelectedNav] = useState(nav[0] ?? "Overview");

  useEffect(() => {
    setSelectedNav(nav[0] ?? "Overview");
  }, [role, compact]);

  const label = (value: string) => {
    if (value === "Overview") return ({ owner: "Home", payroll: "Home", checker: "Reviews", hr: "Today", bookkeeper: "Close" } as Record<string, string>)[role] ?? "Home";
    if (value === "People") return role === "owner" ? "Team" : "Employees";
    if (value === "Analytics") return "Reports";
    if (value === "Time & attendance") return "Attendance";
    if (value === "Audit trail" && role === "checker") return "Payroll history";
    return value;
  };
  const selectedLabel = label(selectedNav);
  const isHome = selectedNav === (nav[0] ?? "Overview");

  return (
    <div className={"linaw-app-preview " + (compact ? "linaw-app-preview-compact" : "")} data-testid={compact ? "payroll-hero-preview" : "app-role-preview"} aria-label={"Illustrative Linaw " + (info?.label ?? role) + " dashboard"}>
      <div className="linaw-app-preview-head">
        <span className="linaw-app-preview-brand"><LinawMark /><strong>linaw</strong></span>
        <span className="linaw-app-preview-demo-flag">Illustrative · sample data</span>
      </div>
      <div className="linaw-app-preview-layout">
        <aside className="linaw-app-preview-rail" aria-label="Illustrative sidebar navigation">
          <div className="linaw-app-preview-role"><span className="linaw-app-preview-pulse" />{info?.shortLabel ?? role} workspace</div>
          {nav.map((item) => {
            const Icon = NAVIGATION.flatMap(group => group.items).find(link => link.name === item)?.icon ??
              (item === "My pay" ? WalletCards : item === "Attendance" ? Clock3 : Leaf);
            const active = selectedNav === item;
            return (
              <button
                type="button"
                key={item}
                className={"linaw-app-preview-nav " + (active ? "active" : "")}
                aria-current={active ? "page" : undefined}
                aria-label={label(item)}
                onClick={() => setSelectedNav(item)}
              >
                <span className="linaw-app-preview-nav-symbol" aria-hidden><Icon size={12} strokeWidth={2} /></span>
                <span>{label(item)}</span>
              </button>
            );
          })}
          <span className="linaw-app-preview-rail-label">EXAMPLE WORKSPACE</span>
        </aside>
        <div className="linaw-app-preview-content">
          <div className="linaw-app-preview-toolbar">
            <span>Sample company <ChevronRight size={12} aria-hidden="true"/> {selectedLabel}</span>
            <span className="linaw-app-preview-avatar">SL</span>
          </div>
          <div className="linaw-app-preview-body" key={selectedNav}>
            {isHome ? (
              <>
                {role === "payroll" && <PayrollPanel compact={compact}/>}
                {role === "owner" && <OwnerPanel compact={compact}/>}
                {role === "checker" && <CheckerPanel compact={compact}/>}
                {role === "hr" && <HrPanel compact={compact}/>}
                {role === "bookkeeper" && <BookkeeperPanel compact={compact}/>}
                {role === "employee" && <EmployeePanel compact={compact}/>}
              </>
            ) : (
              <PreviewModulePanel item={selectedNav} label={selectedLabel} role={role} compact={compact}/>
            )}
          </div>
        </div>
      </div>
      <div className="linaw-app-preview-foot">
        <span>Interactive interface example, not a live payroll or filing result</span>
        <span>PH-focused workflows</span>
      </div>
    </div>
  );
}

function PreviewModulePanel({ item, label, role, compact }: { item: string; label: string; role: DemoRoleId; compact: boolean }) {
  const normalized = item.toLowerCase();
  const module = normalized.includes("payroll") ? {
    title: "Payroll runs",
    subtitle: "Prepare, calculate and review each cutoff before release.",
    status: "Payroll",
    rows: [
      ["Current sample cutoff", "48 employees · needs review", "warn" as const],
      ["Previous payroll", "Released · example record", "good" as const],
      ["Payroll register", "Preview employee-level results", "neutral" as const],
    ],
  } : normalized.includes("analytic") || normalized.includes("report") ? {
    title: "Reports",
    subtitle: "Review payroll movement, workforce context and exported evidence.",
    status: "Reports",
    rows: [
      ["Payroll variance", "Compare against the previous run", "neutral" as const],
      ["Payroll register", "Employee-level sample results", "neutral" as const],
      ["Statutory summary", "Prepared output · external validation required", "warn" as const],
    ],
  } : normalized.includes("people") ? {
    title: role === "owner" ? "Team" : "Employees",
    subtitle: "Keep employee records and payroll-impacting changes together.",
    status: "People",
    rows: [
      ["Employee records", "48 example employees", "neutral" as const],
      ["Onboarding changes", "1 record needs review", "warn" as const],
      ["Separation records", "No open sample exception", "good" as const],
    ],
  } : normalized.includes("setting") ? {
    title: "Settings",
    subtitle: "Configure organization, payroll and approval controls.",
    status: "Settings",
    rows: [
      ["Payroll configuration", "Cutoffs, calendars and policies", "neutral" as const],
      ["Approval roles", "Maker-checker access boundaries", "neutral" as const],
      ["Organization details", "Company and workspace settings", "neutral" as const],
    ],
  } : normalized.includes("time") || normalized.includes("attendance") ? {
    title: "Attendance",
    subtitle: "Review worked time and exceptions before they reach payroll.",
    status: "Workforce",
    rows: [
      ["Attendance summary", "46 complete · 2 need review", "warn" as const],
      ["Overtime evidence", "Approved and pending sample items", "neutral" as const],
      ["Schedule context", "Shifts and rest days connected", "good" as const],
    ],
  } : normalized.includes("audit") ? {
    title: "Payroll history",
    subtitle: "Trace review decisions and payroll events.",
    status: "Audit",
    rows: [
      ["Checker review", "Pending decision · sample run", "warn" as const],
      ["Payroll calculation", "Recorded in audit history", "good" as const],
      ["Previous release", "Released sample payroll", "good" as const],
    ],
  } : normalized.includes("export") ? {
    title: "Exports",
    subtitle: "Prepare accounting and payroll outputs for review.",
    status: "Exports",
    rows: [
      ["Payroll journal", "Accounting export preview", "neutral" as const],
      ["Bank payout file", "Requires authorized release", "warn" as const],
      ["Government worksheets", "Prepared output · not filing acceptance", "warn" as const],
    ],
  } : normalized.includes("compliance") || normalized.includes("readiness") ? {
    title: label,
    subtitle: "Review evidence and validation states before close.",
    status: "Readiness",
    rows: [
      ["Statutory calculations", "Sample checks complete", "good" as const],
      ["Government output", "External validation still required", "warn" as const],
      ["Payroll evidence", "Available for review", "neutral" as const],
    ],
  } : normalized.includes("my pay") ? {
    title: "My pay",
    subtitle: "Your own payday details and payslips.",
    status: "Employee",
    rows: [
      ["Latest payslip", "₱28,450 example net pay", "good" as const],
      ["Next payday", "15 Oct · example date", "neutral" as const],
      ["Previous payslip", "Released sample record", "neutral" as const],
    ],
  } : normalized.includes("leave") ? {
    title: "Leave",
    subtitle: "See balances and submitted leave requests.",
    status: "Employee",
    rows: [
      ["Available balance", "5 days · sample balance", "good" as const],
      ["Upcoming leave", "No pending sample request", "neutral" as const],
      ["Leave history", "View approved requests", "neutral" as const],
    ],
  } : {
    title: label,
    subtitle: "Explore this role-specific workspace area.",
    status: infoLabel(role),
    rows: [
      ["Current workspace", "Illustrative sample content", "neutral" as const],
      ["Needs attention", "No blocking sample item", "good" as const],
      ["Recent activity", "Example workspace history", "neutral" as const],
    ],
  };

  return <>
    <PreviewTitle title={module.title} subtitle={module.subtitle} status={module.status}/>
    <div className="linaw-preview-two-panels">
      <Card heading={module.title}>
        {module.rows.slice(0, compact ? 2 : 3).map(([title, detail, tone]) => (
          <SampleRow key={title} title={title} detail={detail} tone={tone}/>
        ))}
      </Card>
      {!compact && <Card heading="Quick actions">
        <SampleRow title={"Open "+module.title.toLowerCase()} detail="Illustrative action"/>
        <SampleRow title="Review recent activity" detail="Example workspace history"/>
      </Card>}
    </div>
  </>;
}

function infoLabel(role: DemoRoleId) {
  return DEMO_ROLES.find((item) => item.id === role)?.shortLabel ?? role;
}

function PreviewTitle({ title, subtitle, status }: { title: string; subtitle: string; status?: string }) {
  return <div className="linaw-preview-title"><div><h3>{title}</h3><p>{subtitle}</p></div>{status && <span className="linaw-preview-muted-pill">{status}</span>}</div>;
}
function Card({ heading, children, className = "" }: { heading?: string; children: ReactNode; className?: string }) {
  return <section className={"linaw-preview-card " + className}>{heading && <h4>{heading}</h4>}{children}</section>;
}
function Flag({ children, tone = "neutral" }: { children: ReactNode; tone?: "good" | "warn" | "neutral" }) {
  return <span className={"linaw-preview-status " + tone}>{children}</span>;
}
function SampleRow({ icon, title, detail, tone = "neutral" }: { icon?: ReactNode; title: string; detail?: string; tone?: "warn" | "good" | "neutral" }) {
  return <div className="linaw-preview-row"><span className={"linaw-preview-row-icon " + tone} aria-hidden>{icon ?? <FileText size={15}/>}</span><span><strong>{title}</strong>{detail && <small>{detail}</small>}</span><ChevronRight size={14} className="linaw-preview-arrow" aria-hidden="true"/></div>;
}
function MiniMetric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className="linaw-preview-mini-metric"><span>{label}</span><strong className={tone ?? ""}>{value}</strong></div>;
}

function PayrollPanel({ compact }: { compact: boolean }) {
  return <>
    <PreviewTitle title="Let’s make payday a good day." subtitle="Here’s where your payroll stands." status="Sample cutoff"/>
    <div className="linaw-preview-payroll-head">
      <Card className="linaw-preview-primary-card">
        <div className="linaw-preview-flex-title"><div><span className="linaw-preview-eyebrow">CURRENT PAYROLL</span><h4>Sample cutoff payroll</h4></div><Flag tone="warn">Needs review</Flag></div>
        <p className="linaw-preview-helper">48 employees · Example payroll</p>
        <div className="linaw-preview-steps">
          {["Inputs","Calculate","Review","Submit"].map((step, i) => <div key={step} className={"linaw-preview-step " + (i < 2 ? "done" : i === 2 ? "current" : "")}><span>{i < 2 ? <Check size={12}/> : String(i+1)}</span><small>{step}</small></div>)}
        </div>
        <div className="linaw-preview-card-footer"><span>Review the register before submitting payroll.</span><span className="linaw-preview-cta">Continue payroll <ArrowRight size={12}/></span></div>
      </Card>
      {!compact && <Card className="linaw-preview-payday"><h4>Upcoming payday</h4><CalendarDays size={18}/><strong>15</strong><p>Sample pay date</p><small>48 employees</small></Card>}
    </div>
    <div className="linaw-preview-metrics">
      <MiniMetric label="Gross pay" value="₱512,000"/>
      <MiniMetric label="Deductions" value="₱49,500"/>
      <MiniMetric label="Net pay" value="₱462,500" tone="accent"/>
      <MiniMetric label="Employees" value="48"/>
    </div>
    <div className="linaw-preview-two-panels">
      <Card heading="Needs your attention">
        <SampleRow title="Incomplete attendance" detail="Review work hours" tone="warn" icon={<Clock3 size={15}/>}/>
        <SampleRow title="Payroll exceptions" detail="2 items for review" tone="warn" icon={<AlertCircle size={15}/>}/>
      </Card>
      {!compact && <Card heading="Quick actions">
        <SampleRow title="Import adjustments" icon={<ClipboardCheck size={15}/>}/>
        <SampleRow title="Preview payroll register" icon={<FileText size={15}/>}/>
      </Card>}
    </div>
  </>;
}

function OwnerPanel({ compact }: { compact: boolean }) {
  return <>
    <PreviewTitle title="Ready for payday" subtitle="Example payroll · 48 employees" status="Sample cutoff"/>
    <div className="linaw-preview-owner-grid">
      <Card className="linaw-preview-primary-card">
        <div className="linaw-preview-flex-title"><h4>Checks before release</h4><Flag tone="warn">Review required</Flag></div>
        <div className="linaw-preview-checks">
          <p><span className="good"><Check size={12}/></span>Payroll calculated</p>
          <p><span className="warn"><AlertCircle size={12}/></span>Checker approval pending</p>
          <p><span className="warn"><AlertCircle size={12}/></span>2 exceptions need review</p>
          <p><span className="good"><Check size={12}/></span>Payout details present</p>
        </div>
      </Card>
      <Card className="linaw-preview-funding">
        <span>NET PAYROLL FUNDING</span><strong>₱462,500</strong><small>Example amount · not a bank transfer</small>
        <div className="linaw-preview-card-footer"><span>Release subject to final review</span><span className="linaw-preview-cta"><LockKeyhole size={13}/> Continue payroll</span></div>
      </Card>
    </div>
    {!compact && <Card heading="Recent payrolls"><SampleRow title="Previous sample cutoff" detail="Released · example record" tone="good"/><SampleRow title="Current sample cutoff" detail="Needs checker review" tone="warn"/></Card>}
  </>;
}

function CheckerPanel({ compact }: { compact: boolean }) {
  return <>
    <PreviewTitle title="Payroll review" subtitle="Review changes. Resolve exceptions." status="Pending review"/>
    <Card>
      <div className="linaw-preview-flex-title"><div><h4>Sample cutoff</h4><p className="linaw-preview-helper">48 employees · Example payroll</p></div><Flag tone="warn">Needs review</Flag></div>
      <div className="linaw-preview-net"><span>NET PAY</span><strong>₱462,500</strong></div>
      <div className="linaw-preview-tabs"><span className="active">Changes (2)</span><span>Exceptions (2)</span><span>Summary</span></div>
      <h4 className="linaw-preview-small-heading">What changed?</h4>
      <SampleRow title="Salary changes" detail="1 example record" tone="warn"/>
      <SampleRow title="Overtime increases" detail="1 example record" tone="warn"/>
      {!compact && <SampleRow title="Bank detail changes" detail="No flagged change" tone="good"/>}
      <div className="linaw-preview-card-footer"><span>Independent review before release</span><span className="linaw-preview-cta">Open comparison <ArrowRight size={12}/></span></div>
    </Card>
  </>;
}

function HrPanel({ compact }: { compact: boolean }) {
  return <>
    <PreviewTitle title="Your team at a glance" subtitle="Employee record checks before the cutoff" status="HR Admin"/>
    <div className="linaw-preview-owner-grid">
      <Card className="linaw-preview-primary-card">
        <span className="linaw-preview-eyebrow">EMPLOYEE RECORD CHECKS</span>
        <div className="linaw-preview-readiness"><strong>46 / 48</strong><span>records without visible gaps</span></div>
        <div className="linaw-preview-progress"><span style={{width:"96%"}} /></div>
        <p className="linaw-preview-helper">Example only · not payroll release approval</p>
      </Card>
      <Card heading="Needs attention">
        <SampleRow title="Payout details" detail="1 employee record" tone="warn"/>
        <SampleRow title="Incomplete attendance" detail="1 employee record" tone="warn"/>
        {!compact && <SampleRow title="Onboarding" detail="Review employee status" />}
      </Card>
    </div>
  </>;
}

function BookkeeperPanel({ compact }: { compact: boolean }) {
  return <>
    <PreviewTitle title="Payroll close" subtitle="Reconcile released pay and statutory evidence" status="Bookkeeper"/>
    <div className="linaw-preview-owner-grid">
      <Card className="linaw-preview-primary-card">
        <span className="linaw-preview-eyebrow">CLOSE CHECKLIST</span>
        <SampleRow title="Payroll journal" detail="Review accounting entries" icon={<FileText size={15}/>}/>
        <SampleRow title="Payout reconciliation" detail="Confirm bank evidence" tone="warn" icon={<WalletCards size={15}/>}/>
        <SampleRow title="Statutory output" detail="Prepared files require validation" tone="warn" icon={<ShieldCheck size={15}/>}/>
      </Card>
      <Card className="linaw-preview-funding">
        <span>EXAMPLE RELEASED NET</span><strong>₱462,500</strong><small>Illustrative amount, not a remittance receipt</small>
        <div className="linaw-preview-card-footer"><span>Track close evidence</span><span className="linaw-preview-cta">Review exports <ArrowRight size={12}/></span></div>
      </Card>
    </div>
    {!compact && <Card heading="Month-end context"><SampleRow title="Government filings" detail="External acceptance not yet asserted" tone="warn"/></Card>}
  </>;
}

function EmployeePanel({ compact }: { compact: boolean }) {
  return <>
    <PreviewTitle title="Good morning, Jonas." subtitle="Here’s your payday at a glance." status="Employee"/>
    <div className="linaw-preview-owner-grid">
      <Card className="linaw-preview-primary-card">
        <span className="linaw-preview-eyebrow">NEXT PAYDAY</span>
        <div className="linaw-preview-readiness"><strong>15 Oct</strong><span>Example pay date</span></div>
        <p className="linaw-preview-helper">Payslip available after payroll is released.</p>
      </Card>
      <Card className="linaw-preview-funding">
        <span>LATEST PAYSLIP</span><strong>₱28,450</strong><small>Example net pay · released sample record</small>
        <div className="linaw-preview-card-footer"><span>Private to this employee</span><span className="linaw-preview-cta">View payslip <ArrowRight size={12}/></span></div>
      </Card>
    </div>
    {!compact && <div className="linaw-preview-two-panels"><Card heading="Leave balance"><div className="linaw-preview-leave"><Leaf size={18}/><strong>5 days</strong><span>Sample balance</span></div></Card><Card heading="Attendance"><div className="linaw-preview-leave"><Clock3 size={18}/><strong>Complete</strong><span>Sample time record</span></div></Card></div>}
  </>;
}
