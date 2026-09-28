"use client";

import { useMemo, useState, type ElementType } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  Calculator,
  Check,
  CircleDollarSign,
  Clock3,
  FileBarChart2,
  LayoutDashboard,
  LoaderCircle,
  MoreHorizontal,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  UserRoundCheck,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { DEMO_ROLES, type DemoRoleId } from "@/lib/demo-roles";
import styles from "./demo-role-picker.module.css";

const ICONS: Record<DemoRoleId, ElementType> = {
  owner: BriefcaseBusiness,
  bookkeeper: Calculator,
  payroll: CircleDollarSign,
  hr: UsersRound,
  manager: UserRoundCheck,
  employee: UserRound,
  freelancer: WalletCards,
};

type PreviewMetric = {
  label: string;
  value: string;
  hint: string;
  tone?: "good" | "review";
};

type PreviewConfig = {
  nav: string[];
  metrics: PreviewMetric[];
  tabLabels: string[];
  primaryAction: string;
  tableTitle: string;
};

const PREVIEWS: Record<DemoRoleId, PreviewConfig> = {
  owner: {
    nav: ["Overview", "Payroll", "People", "Analytics", "Settings"],
    metrics: [
      { label: "Net payroll", value: "₱936K", hint: "Current cutoff" },
      { label: "Headcount", value: "42", hint: "Active people" },
      { label: "Approvals", value: "2", hint: "Waiting on decision", tone: "review" },
      { label: "Exceptions", value: "3", hint: "Needs review", tone: "review" },
    ],
    tabLabels: ["Company", "Payroll", "Approvals"],
    primaryAction: "Open overview",
    tableTitle: "Recent payroll activity",
  },
  bookkeeper: {
    nav: ["Overview", "Clients", "Payroll", "Exports", "Approvals"],
    metrics: [
      { label: "Client payrolls", value: "6", hint: "This cutoff" },
      { label: "Total net pay", value: "₱2.8M", hint: "Across clients" },
      { label: "Ready to export", value: "4", hint: "Bank files" },
      { label: "Exceptions", value: "5", hint: "Across 2 clients", tone: "review" },
    ],
    tabLabels: ["Clients", "Payroll", "Exports"],
    primaryAction: "Open client workspace",
    tableTitle: "Client payrolls",
  },
  payroll: {
    nav: ["Overview", "Payroll", "People", "Time & attendance", "Approvals", "Exports"],
    metrics: [
      { label: "Total gross pay", value: "₱1.25M", hint: "2.4% vs last cutoff", tone: "good" },
      { label: "Total deductions", value: "₱312K", hint: "Statutory + tax" },
      { label: "Employees", value: "42", hint: "Active in this run" },
      { label: "Exceptions", value: "3", hint: "Needs review", tone: "review" },
    ],
    tabLabels: ["Employees (42)", "Exceptions (3)", "Approvals (2)"],
    primaryAction: "Prepare payroll",
    tableTitle: "Payroll register",
  },
  hr: {
    nav: ["People", "Time & attendance", "Leave", "Benefits", "Recruitment"],
    metrics: [
      { label: "Active people", value: "42", hint: "Company-wide" },
      { label: "On leave", value: "3", hint: "Today" },
      { label: "New hires", value: "4", hint: "This month", tone: "good" },
      { label: "Exceptions", value: "6", hint: "Attendance", tone: "review" },
    ],
    tabLabels: ["People", "Attendance", "Leave"],
    primaryAction: "Add employee",
    tableTitle: "People directory",
  },
  manager: {
    nav: ["People", "Time & attendance", "Leave", "Approvals"],
    metrics: [
      { label: "Team members", value: "12", hint: "Operations" },
      { label: "Present today", value: "10", hint: "2 on leave" },
      { label: "Approvals", value: "3", hint: "Assigned to you", tone: "review" },
      { label: "Overtime", value: "18.5h", hint: "This cutoff" },
    ],
    tabLabels: ["Team", "Attendance", "Approvals"],
    primaryAction: "Review approvals",
    tableTitle: "Team activity",
  },
  employee: {
    nav: ["My pay", "Payslips", "Time", "Leave"],
    metrics: [
      { label: "Latest net pay", value: "₱27,818", hint: "Sep 15 cutoff" },
      { label: "YTD gross", value: "₱420K", hint: "Current year" },
      { label: "Leave balance", value: "8.5", hint: "Days available" },
      { label: "Time today", value: "7h 41m", hint: "Clocked" },
    ],
    tabLabels: ["Payslips", "Time", "Leave"],
    primaryAction: "View payslip",
    tableTitle: "Pay history",
  },
  freelancer: {
    nav: ["Overview", "Income", "Expenses", "Tax planning"],
    metrics: [
      { label: "Income", value: "₱148K", hint: "This month", tone: "good" },
      { label: "Expenses", value: "₱24K", hint: "Tracked" },
      { label: "Tax reserve", value: "₱18K", hint: "Suggested" },
      { label: "Receivables", value: "₱35K", hint: "Outstanding", tone: "review" },
    ],
    tabLabels: ["Income", "Expenses", "Tax"],
    primaryAction: "Add income",
    tableTitle: "Recent transactions",
  },
};

export function DemoRolePicker() {
  const [selectedRole, setSelectedRole] = useState<DemoRoleId>("payroll");
  const [launching, setLaunching] = useState<DemoRoleId | null>(null);
  const [error, setError] = useState("");

  const selected = useMemo(
    () => DEMO_ROLES.find((role) => role.id === selectedRole) ?? DEMO_ROLES[0],
    [selectedRole],
  );
  const preview = PREVIEWS[selected.id];
  const SelectedIcon = ICONS[selected.id];

  async function openDemo(role: DemoRoleId) {
    setLaunching(role);
    setError("");

    try {
      const response = await fetch("/api/auth/demo-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "This demo is not available on the current deployment.");
        return;
      }

      window.location.href = typeof payload.redirectTo === "string" ? payload.redirectTo : `/?demoRole=${role}`;
    } catch {
      setError("Could not open the demo workspace. Please try again.");
    } finally {
      setLaunching(null);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.shell}>
          <div className={styles.heroInner}>
            <span className={styles.eyebrow}>
              <ShieldCheck size={14} aria-hidden />
              No signup required
            </span>
            <h1>See Linaw from the seat you actually use.</h1>
            <p>
              Explore a sample Philippine payroll workspace from different roles. See how each person prepares, reviews,
              approves and releases payroll using sample data.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.demoSection}>
        <div className={styles.shell}>
          <div className={styles.sectionIntro}>
            <span className={styles.kicker}>Role-based product demo</span>
            <h2>Choose a seat.</h2>
            <p>You can switch roles inside the demo at any time.</p>
          </div>

          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}

          <div className={styles.demoLayout}>
            <div className={styles.roleList} role="tablist" aria-label="Demo roles">
              {DEMO_ROLES.map((role) => {
                const Icon = ICONS[role.id];
                const active = role.id === selected.id;

                return (
                  <button
                    className={`${styles.roleRow} ${active ? styles.active : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    key={role.id}
                    onClick={() => setSelectedRole(role.id)}
                  >
                    <span className={styles.roleIcon} aria-hidden>
                      <Icon size={16} />
                    </span>
                    <span className={styles.roleText}>
                      <strong>{role.label}</strong>
                      <small>{role.person}</small>
                    </span>
                    {role.id === "payroll" && <span className={styles.suggested}>Start here</span>}
                    <ArrowRight size={14} aria-hidden />
                  </button>
                );
              })}
            </div>

            <article className={styles.roleDetail} role="tabpanel">
              <div className={styles.detailTop}>
                <span className={styles.detailIcon} aria-hidden>
                  <SelectedIcon size={20} />
                </span>
                <div>
                  <span className={styles.personLabel}>{selected.label}</span>
                  <h3>{selected.person}</h3>
                  <p>{selected.description}</p>
                </div>
              </div>

              <div className={styles.detailMeta}>
                <div>
                  <span>Starts in</span>
                  <strong>{selected.landingPage}</strong>
                </div>
                <div>
                  <span>Workspace</span>
                  <strong>Sample Philippine payroll</strong>
                </div>
              </div>

              <div className={styles.accessBlock}>
                <span className={styles.accessLabel}>What you can explore</span>
                <div className={styles.accessList}>
                  {selected.access.map((item) => (
                    <span key={item}>
                      <Check size={13} aria-hidden />
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              <div className={styles.productPreview} aria-label={`${selected.label} product preview`}>
                <aside className={styles.previewSidebar}>
                  <div className={styles.previewBrand}>
                    <span>L</span>
                    <strong>linaw</strong>
                  </div>
                  <div className={styles.previewNavList}>
                    {preview.nav.map((item, index) => (
                      <span
                        className={item === selected.landingPage || index === 1 ? styles.previewNavActive : styles.previewNav}
                        key={item}
                      >
                        {index === 0 ? <LayoutDashboard size={11} /> : index === 2 ? <UsersRound size={11} /> : index === 3 ? <Clock3 size={11} /> : <CircleDollarSign size={11} />}
                        {item}
                      </span>
                    ))}
                  </div>
                </aside>

                <div className={styles.previewMain}>
                  <div className={styles.previewToolbar}>
                    <div>
                      <strong>{selected.landingPage}</strong>
                      <span>{selected.shortLabel} workspace</span>
                    </div>
                    <button type="button" tabIndex={-1}>{preview.primaryAction}</button>
                  </div>

                  <div className={styles.previewMetrics}>
                    {preview.metrics.map((metric) => (
                      <div key={metric.label}>
                        <span>{metric.label}</span>
                        <strong>{metric.value}</strong>
                        <small className={metric.tone === "review" ? styles.metricReview : metric.tone === "good" ? styles.metricGood : undefined}>
                          {metric.hint}
                        </small>
                      </div>
                    ))}
                  </div>

                  <div className={styles.previewTabs}>
                    {preview.tabLabels.map((tab, index) => (
                      <span className={index === 0 ? styles.previewTabActive : undefined} key={tab}>{tab}</span>
                    ))}
                    <div className={styles.previewSearch}>
                      <Search size={11} />
                      <span>Search</span>
                    </div>
                    <span className={styles.previewFilter}><SlidersHorizontal size={11} /> Filters</span>
                  </div>

                  <div className={styles.previewTable}>
                    <div className={styles.previewTableHead}>
                      <span>{preview.tableTitle}</span>
                      <span>Amount</span>
                      <span>Status</span>
                      <span />
                    </div>
                    <PreviewRow initials="JD" name="Juan Dela Cruz" detail="Marketing" amount="₱27,818" />
                    <PreviewRow initials="MS" name="Maria Santos" detail="Operations" amount="₱32,844" />
                    <PreviewRow initials="AV" name="Aira Villanueva" detail="People" amount="₱29,620" />
                  </div>
                </div>
              </div>

              <div className={styles.detailFooter}>
                <div>
                  <strong>Sample data only</strong>
                  <span>Figures are for demonstration and are not real employee data.</span>
                </div>
                <button
                  type="button"
                  onClick={() => void openDemo(selected.id)}
                  disabled={Boolean(launching)}
                >
                  {launching === selected.id ? (
                    <>
                      <LoaderCircle className={styles.spin} size={15} aria-hidden />
                      Opening…
                    </>
                  ) : (
                    <>
                      Open {selected.shortLabel} demo <ArrowRight size={15} aria-hidden />
                    </>
                  )}
                </button>
              </div>
            </article>
          </div>
        </div>
      </section>
    </main>
  );
}

function PreviewRow({
  initials,
  name,
  detail,
  amount,
}: {
  initials: string;
  name: string;
  detail: string;
  amount: string;
}) {
  return (
    <div className={styles.previewRow}>
      <span className={styles.previewAvatar}>{initials}</span>
      <span className={styles.previewPerson}>
        <strong>{name}</strong>
        <small>{detail}</small>
      </span>
      <span className={styles.previewAmount}>{amount}</span>
      <span className={styles.previewStatus}>Ready</span>
      <MoreHorizontal size={12} aria-hidden />
    </div>
  );
}
