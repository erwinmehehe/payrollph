"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Download,
  LayoutDashboard,
  ReceiptText,
  RefreshCcw,
  Search,
  Send,
  UploadCloud,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  SAMPLE_APPROVALS,
  SAMPLE_CLIENTS,
  SAMPLE_EMPLOYEES,
  SAMPLE_PUNCHES,
  buildSampleRun,
  type SampleEntry,
} from "./sample-workspace";
import { NAVIGATION } from "@/components/workspace/nav";
import { Battery, Progress, Status, formatDate, money, moneyExact, shortMoney } from "@/components/workspace/ui";

type Tab = string;

const PREVIEW_GROUPS = NAVIGATION
  .map((group) => ({
    label: group.label,
    items: group.items.filter((item) => item.name !== "Freelancer hub"),
  }))
  .filter((group) => group.items.length > 0);

const TABS = PREVIEW_GROUPS.flatMap((group) => group.items);

const CORE_INTERACTIVE_TABS = new Set<Tab>([
  "Overview",
  "Payroll",
  "People",
  "Migration",
  "Time & attendance",
  "Leave",
  "Approvals",
  "Exports",
]);

const SAMPLE_COMPANY = SAMPLE_CLIENTS[0];

/**
 * The public workspace preview.
 *
 * `showcase` renders a cropped, non-interactive composition for the hero.
 * `interactive` is the playable version: tabs, client switching, expandable
 * payslips and a simulated release, all local state, nothing persisted.
 */
export function WorkspacePreview({ mode = "interactive" }: { mode?: "showcase" | "interactive" }) {
  const run = useMemo(() => buildSampleRun(), []);
  const [tab, setTab] = useState<Tab>("Overview");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [released, setReleased] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [decided, setDecided] = useState<Record<number, "Approved" | "Declined">>({});
  const [query, setQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({ Manage: true });

  const interactive = mode === "interactive";
  const activeTab: Tab = interactive ? tab : "Overview";

  return (
    <div className={`frame ${interactive ? "standalone" : ""}`}>
      <div className="frame-bar">
        <span className="frame-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="frame-url">
          <span>linaw.ph/workspace</span>
        </span>
        <span className="frame-tag">Simulation</span>
      </div>

      <div className="frame-body">
        <div className="pv">
          <aside className="pv-side">
            <div className="sidebar-brand" style={{ minHeight: 34, marginBottom: 10 }}>
              <span className="brand-mark" style={{ width: 24, height: 24, borderRadius: 7, fontSize: 11 }} aria-hidden>
                <span className="brand-bars">
                  <i />
                  <i />
                  <i />
                </span>
              </span>
              <div>
                <strong style={{ fontSize: 14 }}>linaw</strong>
              </div>
            </div>
            {PREVIEW_GROUPS.map((group) => {
              const collapsed = interactive && Boolean(collapsedGroups[group.label]);
              return (
                <div className="pv-nav-group" key={group.label}>
                  <button
                    className="pv-nav-group-toggle"
                    type="button"
                    disabled={!interactive}
                    onClick={() =>
                      interactive &&
                      setCollapsedGroups((current) => ({
                        ...current,
                        [group.label]: !current[group.label],
                      }))
                    }
                    aria-expanded={!collapsed}
                  >
                    <span>{group.label}</span>
                    {interactive && (collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />)}
                  </button>
                  {!collapsed && group.items.map(({ name, icon: Icon, tone }) => (
                    <button
                      key={name}
                      className={`nav-item ${activeTab === name ? "active" : ""}`}
                      data-tone={tone}
                      onClick={() => interactive && setTab(name)}
                      tabIndex={interactive ? 0 : -1}
                      aria-current={activeTab === name ? "page" : undefined}
                      title={name}
                    >
                      <span className={`nav-icon t-${tone}`} aria-hidden>
                        <Icon size={13} strokeWidth={2.1} />
                      </span>
                      <span>{name}</span>
                      {name === "Approvals" && <b>{SAMPLE_APPROVALS.filter((task) => !decided[task.id]).length}</b>}
                      {name === "People" && <b>{SAMPLE_EMPLOYEES.length}</b>}
                    </button>
                  ))}
                </div>
              );
            })}
          </aside>

          <div className="pv-main">
            <div className="pv-top">
              <div className="company-switcher-wrap">
                <div className="company-switcher" aria-label="Sample company">
                  <span className="company-logo small" style={{ backgroundColor: SAMPLE_COMPANY.color }} aria-hidden>
                    {SAMPLE_COMPANY.name.slice(0, 1)}
                  </span>
                  <span>
                    <strong>{SAMPLE_COMPANY.name}</strong>
                    <small>{SAMPLE_COMPANY.plan} · {SAMPLE_COMPANY.people} sample people</small>
                  </span>
                </div>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                <span className="icon-button relative" aria-hidden>
                  <Bell size={16} className="i-pink" />
                  <span className="notification-dot">{SAMPLE_APPROVALS.filter((task) => !decided[task.id]).length}</span>
                </span>
                <span className="top-avatar" aria-hidden>
                  CY
                </span>
              </div>
            </div>

            {interactive && (
              <div className="pv-pillnav slim-scroll">
                {TABS.map(({ name }) => (
                  <button key={name} className={activeTab === name ? "on" : ""} onClick={() => setTab(name)}>
                    {name}
                  </button>
                ))}
              </div>
            )}

            <div className="pv-body slim-scroll">
              <>
                {activeTab === "Overview" && <PreviewDashboard run={run} released={released} decided={decided} />}
                {activeTab === "Payroll" && (
                  <PreviewPayroll
                    run={run}
                    released={released}
                    acknowledged={acknowledged}
                    onAcknowledge={setAcknowledged}
                    onRelease={() => setReleased(true)}
                    expanded={expanded}
                    onExpand={setExpanded}
                  />
                )}
                {activeTab === "People" && <PreviewPeople query={query} onQuery={setQuery} />}
                {activeTab === "Migration" && <PreviewMigration run={run} />}
                {activeTab === "Time & attendance" && <PreviewTime />}
                {activeTab === "Leave" && <PreviewLeave />}
                {activeTab === "Approvals" && (
                  <PreviewApprovals
                    decided={decided}
                    onDecide={(id, status) => setDecided((current) => ({ ...current, [id]: status }))}
                  />
                )}
                {activeTab === "Exports" && <PreviewExports run={run} released={released} />}
                {!CORE_INTERACTIVE_TABS.has(activeTab) && <PreviewFeature tab={activeTab} run={run} />}
              </>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ tabs */

function PreviewDashboard({
  run,
  released,
  decided,
}: {
  run: ReturnType<typeof buildSampleRun>;
  released: boolean;
  decided: Record<number, string>;
}) {
  const open = SAMPLE_APPROVALS.filter((task) => !decided[task.id]).length;
  return (
    <>
      <div className="console-strip" style={{ marginBottom: 14 }}>
        <div className="console-strip-top">
          <div>
            <span className="kicker">
              <span className="pulse-dot" aria-hidden /> {released ? "Released run" : "Live run"}
            </span>
            <h2 style={{ fontSize: 17 }}>{run.periodLabel}</h2>
            <p style={{ fontSize: 11.5 }}>
              Pay date {formatDate(run.payDate)} · rule engine {run.ruleVersion} · {run.entries.length} employees
            </p>
          </div>
          <div className="console-figures">
            <div>
              <span>Gross</span>
              <strong style={{ fontSize: 16 }}>{shortMoney(run.gross)}</strong>
            </div>
            <div>
              <span>Net</span>
              <strong style={{ fontSize: 16 }}>{shortMoney(run.net)}</strong>
            </div>
            <div>
              <span>Exceptions</span>
              <strong style={{ fontSize: 16, color: run.exceptions ? "#ffc46b" : undefined }}>{run.exceptions}</strong>
            </div>
          </div>
        </div>
        <div className="track">
          <div className="track-step done">
            <span>
              <Check size={10} className="i-green" /> Cutoff
            </span>
            <strong>Punches captured</strong>
          </div>
          <div className="track-step done">
            <span>
              <Check size={10} className="i-green" /> Calculate
            </span>
            <strong>100% of queue</strong>
          </div>
          <div className={`track-step ${open ? "now" : "done"}`}>
            <span>Approve</span>
            <strong>{open ? `${open} open` : "Clear"}</strong>
          </div>
          <div className={`track-step ${released ? "done" : ""}`}>
            <span>Release</span>
            <strong>{released ? "Released" : "Pending"}</strong>
          </div>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 14 }}>
        <MiniStat label="Active people" value={String(SAMPLE_EMPLOYEES.filter((person) => person.status === "Active").length)} hint={`of ${SAMPLE_EMPLOYEES.length} on this client`} tone="mint" icon={UsersRound} />
        <MiniStat label="Net pay" value={shortMoney(run.net)} hint={`${shortMoney(run.gross)} gross`} tone="purple" icon={CircleDollarSign} />
        <MiniStat label="Deductions" value={shortMoney(run.deductions)} hint="statutory + tax" tone="blue" icon={ReceiptText} />
        <MiniStat label="Open approvals" value={String(open)} hint={open ? "waiting on a decision" : "queue is clear"} tone={open ? "amber" : "mint"} icon={ClipboardCheck} />
      </div>

      <article className="card">
        <div className="card-header">
          <div>
            <div className="card-kicker">Entry status</div>
            <h2 style={{ fontSize: 14 }}>Where this run stands</h2>
          </div>
          <Status value={released ? "Released" : run.exceptions ? "Needs review" : "Ready"} />
        </div>
        <div className="card-body">
          <Battery
            slices={[
              { key: "ok", label: "ready", value: run.entries.length - run.exceptions },
              { key: "review", label: "exception", value: run.exceptions },
            ]}
          />
        </div>
      </article>
    </>
  );
}

function PreviewPayroll({
  run,
  released,
  acknowledged,
  onAcknowledge,
  onRelease,
  expanded,
  onExpand,
}: {
  run: ReturnType<typeof buildSampleRun>;
  released: boolean;
  acknowledged: boolean;
  onAcknowledge: (next: boolean) => void;
  onRelease: () => void;
  expanded: number | null;
  onExpand: (id: number | null) => void;
}) {
  return (
    <article className="card">
      <div className="card-header">
        <div>
          <div className="card-kicker">
            {run.scopeLabel} · rule engine <span className="mono">{run.ruleVersion}</span>
          </div>
          <h2 style={{ fontSize: 15 }}>{run.periodLabel}</h2>
          <p>Pay date {formatDate(run.payDate)}</p>
        </div>
        <Status value={released ? "Released" : run.exceptions ? "Needs review" : "Ready"} />
      </div>

      <div className="run-stats">
        <div>
          <span>Gross</span>
          <strong>{money(run.gross)}</strong>
        </div>
        <div>
          <span>Deductions</span>
          <strong className="red-number">{money(run.deductions)}</strong>
        </div>
        <div>
          <span>Net pay</span>
          <strong className="green-number">{money(run.net)}</strong>
        </div>
      </div>

      {run.exceptions > 0 && !released && (
        <div className="card-body" style={{ paddingTop: 0 }}>
          {run.entries
            .filter((entry) => entry.status === "Exception")
            .map((entry) => (
              <div className="exception-row" key={entry.employee.id}>
                <AlertTriangle size={15} style={{ color: "var(--review)", flex: "none", marginTop: 1 }} />
                <div>
                  <strong>
                    {entry.employee.firstName} {entry.employee.lastName}{" "}
                    <span className="mono" style={{ fontWeight: 500, opacity: 0.7 }}>
                      {entry.employee.employeeNo}
                    </span>
                  </strong>
                  <p>{entry.flags[0]}</p>
                </div>
              </div>
            ))}
        </div>
      )}

      <div className="line-title">
        <strong>Register</strong>
        <span>Open a row for the payslip breakdown</span>
      </div>

      <div className="register">
        <div className="register-scroll slim-scroll">
          <div className="register-head">
            <span>Employee</span>
            <span className="right">Gross</span>
            <span className="right">Deductions</span>
            <span className="right">Net pay</span>
            <span>Status</span>
            <span aria-hidden />
          </div>
          {run.entries.map((entry) => {
            const open = expanded === entry.employee.id;
            return (
              <div key={entry.employee.id}>
                <button
                  className={`register-row ${open ? "open" : ""} ${entry.status === "Exception" ? "flagged" : ""}`}
                  onClick={() => onExpand(open ? null : entry.employee.id)}
                  aria-expanded={open}
                >
                  <span>
                    {entry.employee.firstName} {entry.employee.lastName}
                    <small>
                      {entry.employee.employeeNo} · {entry.employee.title}
                    </small>
                  </span>
                  <span className="amt right">{money(entry.gross)}</span>
                  <span className="amt right red-number">−{money(entry.deductions)}</span>
                  <strong className="right">{money(entry.net)}</strong>
                  <span>
                    <Status value={entry.status} />
                  </span>
                  <span className="chev" aria-hidden>
                    <ChevronDown size={14} />
                  </span>
                </button>
                {open && <PreviewPayslip entry={entry} />}
              </div>
            );
          })}
        </div>
      </div>

      <div className="run-actions">
        {released ? (
          <span className="status status-released" style={{ height: 32, padding: "0 12px" }}>
            Released in this simulation
          </span>
        ) : (
          <>
            {run.exceptions > 0 && (
              <label className="switch" style={{ marginRight: "auto" }}>
                <input type="checkbox" checked={acknowledged} onChange={(event) => onAcknowledge(event.target.checked)} />
                <i aria-hidden />
                <span>
                  Acknowledge {run.exceptions} exception{run.exceptions === 1 ? "" : "s"}
                </span>
              </label>
            )}
            <button className="primary-button brand" disabled={run.exceptions > 0 && !acknowledged} onClick={onRelease}>
              <Send size={14} className="i-pink" /> Release (simulated)
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function PreviewPayslip({ entry }: { entry: SampleEntry }) {
  return (
    <div className="payslip-panel">
      <div className="payslip-grid">
        <div className="payslip-col">
          <p>Earnings</p>
          {entry.earnings.map((line) => (
            <div className="payslip-line" key={line.code}>
              <code>{line.code}</code>
              <span>
                {line.label}
                {line.note && <em>{line.note}</em>}
              </span>
              <b>{moneyExact(line.amount)}</b>
            </div>
          ))}
          <div className="payslip-total">
            <span>Gross</span>
            <strong style={{ color: "var(--ink)" }}>{moneyExact(entry.gross)}</strong>
          </div>
        </div>
        <div className="payslip-col">
          <p>Deductions</p>
          {entry.withholdings.map((line) => (
            <div className="payslip-line" key={line.code}>
              <code>{line.code}</code>
              <span>
                {line.label}
                {line.note && <em>{line.note}</em>}
              </span>
              <b className="minus">{moneyExact(line.amount)}</b>
            </div>
          ))}
          <div className="payslip-total">
            <span>Net pay</span>
            <strong>{moneyExact(entry.net)}</strong>
          </div>
        </div>
      </div>
      <div className="trace-box slim-scroll">
        <p>Engine trace · rule version PH-2026.01</p>
        {entry.flags.map((flag) => (
          <span className="trace-line trace-flag" key={flag}>
            ! {flag}
          </span>
        ))}
        <span className="trace-line">
          <span className="k">monthlyBasic</span>= <span className="v">{entry.employee.monthlyBasic}</span>
        </span>
        <span className="trace-line">
          <span className="k">overtimeMinutes</span>= <span className="v">{entry.employee.overtimeMinutes}</span>
        </span>
        <span className="trace-line">
          <span className="k">nightMinutes</span>= <span className="v">{entry.employee.nightMinutes}</span>
        </span>
        <span className="trace-line">
          <span className="k">mwe</span>= <span className="v">{String(Boolean(entry.employee.mwe))}</span>
        </span>
      </div>
      <p className="payslip-note">
        Contribution and withholding amounts on this payslip come from{" "}
        <span className="mono">src/lib/payroll-rules.ts</span>. The preview does not re-implement them.
      </p>
    </div>
  );
}

function PreviewPeople({ query, onQuery }: { query: string; onQuery: (value: string) => void }) {
  const needle = query.trim().toLowerCase();
  const rows = SAMPLE_EMPLOYEES.filter((person) =>
    `${person.firstName} ${person.lastName} ${person.employeeNo} ${person.title} ${person.unit}`.toLowerCase().includes(needle),
  );

  return (
    <article className="card table-card">
      <div className="table-toolbar">
        <div className="search-field">
          <Search size={15} className="i-slate" />
          <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search people" aria-label="Search sample people" />
        </div>
      </div>
      <div className="data-table-wrap slim-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Unit</th>
              <th>Status</th>
              <th className="right">Monthly basic</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((person) => (
              <tr key={person.id}>
                <td>
                  <div className="person-cell">
                    <div className={`avatar avatar-${person.id % 5}`} aria-hidden>{person.initials}</div>
                    <div>
                      <strong>
                        {person.firstName} {person.lastName}
                      </strong>
                      <span>
                        <span className="id">{person.employeeNo}</span> · {person.title}
                      </span>
                    </div>
                  </div>
                </td>
                <td>{person.unit}</td>
                <td>
                  <Status value={person.status} />
                </td>
                <td className="right num">
                  {money(person.monthlyBasic)}
                  {person.mwe && <small className="mwe-tag">MWE</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="empty-state">
            <Search size={20} className="i-slate" />
            <strong>No sample people match “{query}”</strong>
          </div>
        )}
      </div>
    </article>
  );
}

function PreviewTime() {
  const incomplete = SAMPLE_PUNCHES.filter((punch) => !punch.timeIn || !punch.timeOut).length;
  return (
    <>
      <article className="card" style={{ marginBottom: 14 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">Punch completeness</div>
            <h2 style={{ fontSize: 14 }}>
              {SAMPLE_PUNCHES.length - incomplete} complete, {incomplete} incomplete
            </h2>
          </div>
        </div>
        <div className="card-body">
          <Progress percent={((SAMPLE_PUNCHES.length - incomplete) / SAMPLE_PUNCHES.length) * 100} />
          <p style={{ margin: "12px 0 0", color: "var(--muted)", fontSize: 11.5 }}>
            A missing IN or OUT derives zero hours for that day and raises an exception on the payroll entry, it is never
            filled in with an assumed time.
          </p>
        </div>
      </article>

      <article className="card table-card">
        <div className="data-table-wrap slim-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Date</th>
                <th>In</th>
                <th>Out</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_PUNCHES.map((punch) => {
                const person = SAMPLE_EMPLOYEES.find((employee) => employee.id === punch.employeeId);
                return (
                  <tr key={punch.id}>
                    <td>
                      <div className="person-cell">
                        <div className={`avatar avatar-${punch.employeeId % 5}`} aria-hidden>{person?.initials}</div>
                        <div>
                          <strong>
                            {person?.firstName} {person?.lastName}
                          </strong>
                        </div>
                      </div>
                    </td>
                    <td>{formatDate(punch.date)}</td>
                    <td className="num">{punch.timeIn ?? "-"}</td>
                    <td className="num">{punch.timeOut ?? "-"}</td>
                    <td>
                      <Status value={punch.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>
    </>
  );
}

function PreviewApprovals({
  decided,
  onDecide,
}: {
  decided: Record<number, "Approved" | "Declined">;
  onDecide: (id: number, status: "Approved" | "Declined") => void;
}) {
  return (
    <>
      <div className="notice notice-purple" style={{ marginTop: 0 }}>
        <ClipboardCheck size={15} className="i-amber" />
        <span>
          <strong>Delegation enforced in the product.</strong> Mariel Santos → Celine Yao. In the real workspace a decision
          from outside that chain is refused with a 403 by the server, and a delegate&apos;s decision records who they acted
          for.
        </span>
      </div>
      <article className="card">
        <div className="approval-list">
          {SAMPLE_APPROVALS.map((task) => {
            const decision = decided[task.id];
            return (
              <div className="approval-content" key={task.id}>
                <span className="approval-symbol" aria-hidden>
                  <ClipboardCheck size={16} className="i-amber" />
                </span>
                <div>
                  <div className="card-kicker">{task.priority === "High" ? "Priority review" : "Pending decision"}</div>
                  <strong>{task.title}</strong>
                  <p>{task.detail}</p>
                  <div className="approval-meta">
                    <span>
                      Approver <strong style={{ fontSize: 10.5 }}>{task.approver}</strong>
                    </span>
                    <span>{task.due}</span>
                  </div>
                </div>
                {decision ? (
                  <Status value={decision} />
                ) : (
                  <div className="approval-actions">
                    <button className="decline-button" onClick={() => onDecide(task.id, "Declined")}>
                      Decline
                    </button>
                    <button className="primary-button brand" onClick={() => onDecide(task.id, "Approved")}>
                      <Check size={14} className="i-green" /> Approve
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </article>
    </>
  );
}

function PreviewExports({ run, released }: { run: ReturnType<typeof buildSampleRun>; released: boolean }) {
  return (
    <>
      <div className="notice notice-blue" style={{ marginTop: 0 }}>
        <Download size={15} className="i-teal" />
        <span>
          In the product these buttons call the server, which generates the file and writes an audit event. Here they are
          inert, the preview never produces a file.
        </span>
      </div>
      <div className="integration-grid">
        <article className="export-card">
          <div>
            <h3>
              Bank disbursement <Status value="Versioned" />
            </h3>
            <p>
              BDO DAT and BPI / UnionBank / GCash CSV, validated by a dry run before any file that looks submittable is
              produced. {money(run.net)} would be disbursed for {run.periodLabel}.
            </p>
          </div>
        </article>
        <article className="export-card">
          <div>
            <h3>
              Accounting journal <Status value="Ready" />
            </h3>
            <p>Xero and QuickBooks Online journal CSV balanced to this run&apos;s gross, deductions and net.</p>
          </div>
        </article>
        <article className="export-card">
          <div>
            <h3>
              Government worksheets <Status value="Draft only" />
            </h3>
            <p>
              1601-C, Alphalist/2316, SSS R-3, PhilHealth RF-1 and Pag-IBIG MCRF are generated from real figures but are
              <strong> not</strong> validated against the agencies&apos; own import tools, so every file is labelled DRAFT.
            </p>
          </div>
        </article>
        <article className="export-card">
          <div>
            <h3>Payslip PDFs</h3>
            <p>
              {released
                ? "Available once a run is released, one PDF per entry, written without a PDF dependency."
                : "Generated on release. Release the run in this simulation to see the stage unlock."}
            </p>
          </div>
        </article>
      </div>
      <p style={{ marginTop: 14, color: "var(--muted)", fontSize: 11.5 }}>
        Linaw generates these files; it does not submit them. There is no live bank or certified filing connection.{" "}
        <a className="link-button" href="/api/readiness">
          /api/readiness
        </a>{" "}
        lists every gate. <ArrowUpRight size={11} style={{ display: "inline", verticalAlign: "middle" }} />
      </p>
    </>
  );
}

type PreviewFeatureSpec = {
  kicker: string;
  title: string;
  copy: string;
  stats: Array<{ label: string; value: string; hint: string }>;
  rows: Array<{ title: string; detail: string; status: string }>;
};

const FEATURE_PREVIEWS: Partial<Record<Tab, PreviewFeatureSpec>> = {
  Migration: {
    kicker: "Switching tools",
    title: "Bring your existing payroll and HR data with you.",
    copy: "Upload exports from another payroll or HRIS, review detected mappings and errors, then commit only after validation.",
    stats: [
      { label: "Source presets", value: "14+", hint: "plus generic CSV" },
      { label: "Import types", value: "4", hint: "people, payroll, leave, loans" },
      { label: "Write mode", value: "Dry run", hint: "validate before commit" },
    ],
    rows: [
      { title: "Sprout Solutions", detail: "Employee and payroll export aliases detected", status: "Ready" },
      { title: "Salarium", detail: "Employee, payroll and leave fields recognized", status: "Ready" },
      { title: "PayrollHero / GreatDay / Omni HR", detail: "Vendor aliases with generic fallback mapping", status: "Ready" },
      { title: "Historical payroll", detail: "Preserved as imported, not recalculated under current rules", status: "Protected" },
    ],
  },
  Leave: {
    kicker: "Leave",
    title: "Balances and approvals stay attached to the employee.",
    copy: "Track opening balances, accrual, requests and decisions without moving the payroll team into another sheet.",
    stats: [
      { label: "Pending", value: "3", hint: "requests awaiting review" },
      { label: "Approved", value: "11", hint: "this month" },
      { label: "Balance alerts", value: "2", hint: "near policy limit" },
    ],
    rows: [
      { title: "Aira Villanueva", detail: "Emergency leave · Mar 17–18", status: "Pending" },
      { title: "Jonas Reyes", detail: "Vacation leave · 6.5 days remaining", status: "Healthy" },
      { title: "Trish Dela Cruz", detail: "Final leave conversion attached to separation", status: "Review" },
    ],
  },
  Analytics: {
    kicker: "Analytics",
    title: "Payroll and people trends without a separate BI project.",
    copy: "Use the same operational data behind payroll to understand cost, headcount, exceptions and movement.",
    stats: [
      { label: "Headcount", value: "8", hint: "sample company" },
      { label: "Net payroll", value: "₱285.6k", hint: "current cutoff" },
      { label: "Exceptions", value: "2", hint: "needs attention" },
    ],
    rows: [
      { title: "Payroll cost", detail: "Gross and statutory employer cost by cutoff", status: "Live" },
      { title: "Headcount", detail: "Active, on leave and separating employees", status: "Live" },
      { title: "Compliance exceptions", detail: "Missing IDs, incomplete time and filing blockers", status: "Live" },
    ],
  },
  Compliance: {
    kicker: "Philippine compliance",
    title: "The rulebook stays visible in the workflow.",
    copy: "Statutory rules, wage orders, filing prerequisites and year-end annualization are exposed to the reviewer.",
    stats: [
      { label: "Rule version", value: "PH-2026.01", hint: "calculation trace" },
      { label: "BIR", value: "Ready", hint: "identity checks enforced" },
      { label: "Year-end", value: "YTD", hint: "imports included" },
    ],
    rows: [
      { title: "SSS", detail: "Employee and employer contribution basis", status: "Configured" },
      { title: "PhilHealth", detail: "Contribution basis and employer share", status: "Configured" },
      { title: "Pag-IBIG", detail: "Mandatory contribution and supported voluntary plans", status: "Configured" },
      { title: "BIR TRAIN", detail: "Semi-monthly withholding plus annualization", status: "Configured" },
    ],
  },
  Loans: {
    kicker: "Employee loans",
    title: "Outstanding balances deduct through payroll.",
    copy: "Keep government and company loans visible with balances, amortization and payroll-linked settlement.",
    stats: [
      { label: "Active loans", value: "3", hint: "sample workspace" },
      { label: "Due this cutoff", value: "₱3.8k", hint: "scheduled deductions" },
      { label: "Stale balance guard", value: "On", hint: "release fails closed" },
    ],
    rows: [
      { title: "SSS Salary Loan", detail: "Jonas Reyes · ₱12,000 remaining", status: "Active" },
      { title: "Pag-IBIG MPL", detail: "Paolo Cruz · ₱8,500 remaining", status: "Active" },
      { title: "Company Emergency Loan", detail: "Rico Mendoza · ₱4,200 remaining", status: "Active" },
    ],
  },
  Benefits: {
    kicker: "Benefits",
    title: "Plans can flow directly into payroll.",
    copy: "Enroll employees in benefits and voluntary programs while keeping employee and employer shares separate.",
    stats: [
      { label: "Plans", value: "4", hint: "sample catalogue" },
      { label: "Enrolments", value: "13", hint: "active" },
      { label: "Payroll linked", value: "Yes", hint: "next calculation" },
    ],
    rows: [
      { title: "HMO", detail: "Employee and employer share tracked separately", status: "Active" },
      { title: "Group life", detail: "Employer-paid benefit", status: "Active" },
      { title: "Pag-IBIG MP2", detail: "Voluntary deduction with cap validation", status: "Active" },
    ],
  },
  "De minimis": {
    kicker: "De minimis",
    title: "Tax-exempt allowances remain traceable.",
    copy: "Record supported benefit types, limits and taxable excess instead of hiding them inside one allowance total.",
    stats: [
      { label: "Active grants", value: "6", hint: "sample records" },
      { label: "Tax handling", value: "Automatic", hint: "within configured ceilings" },
      { label: "Trace", value: "Per line", hint: "visible on payslip" },
    ],
    rows: [
      { title: "Rice allowance", detail: "Monthly benefit with tax treatment", status: "Active" },
      { title: "Uniform allowance", detail: "Annual ceiling tracked", status: "Active" },
      { title: "Medical cash allowance", detail: "Taxable excess is separated", status: "Tracked" },
    ],
  },
  Expenses: {
    kicker: "Expenses",
    title: "Approved reimbursements can ride the payroll run.",
    copy: "Keep reimbursements non-taxable and linked to the run that actually settles them.",
    stats: [
      { label: "Approved", value: "4", hint: "waiting for payroll" },
      { label: "Value", value: "₱8.4k", hint: "approved claims" },
      { label: "Double-pay guard", value: "On", hint: "settlement checks linkage" },
    ],
    rows: [
      { title: "Client travel", detail: "Mariel Santos · ₱2,450", status: "Approved" },
      { title: "Internet reimbursement", detail: "Jonas Reyes · ₱1,500", status: "Approved" },
      { title: "Warehouse supplies", detail: "Rico Mendoza · ₱4,420", status: "Approved" },
    ],
  },
  "Earned wage": {
    kicker: "Earned wage",
    title: "Advances stay visible before payroll recovers them.",
    copy: "Approved advances become explicit deductions, with settlement blocked if the linked balance changed.",
    stats: [
      { label: "Open", value: "2", hint: "approved advances" },
      { label: "Recovery", value: "₱3.0k", hint: "next cutoff" },
      { label: "Settlement", value: "Atomic", hint: "no partial recovery" },
    ],
    rows: [
      { title: "Jonas Reyes", detail: "₱1,500 approved advance", status: "Approved" },
      { title: "Nina Garcia", detail: "₱1,500 approved advance", status: "Approved" },
    ],
  },
  Recruitment: {
    kicker: "Recruitment",
    title: "A light hiring pipeline lives beside the employee record.",
    copy: "Track openings and applicants until a candidate becomes an employee and onboarding begins.",
    stats: [
      { label: "Open roles", value: "3", hint: "current requisitions" },
      { label: "Applicants", value: "18", hint: "across pipeline" },
      { label: "Offers", value: "2", hint: "awaiting decision" },
    ],
    rows: [
      { title: "Payroll Specialist", detail: "6 applicants · 2 interviewing", status: "Open" },
      { title: "Support Associate", detail: "8 applicants · 1 offer", status: "Open" },
      { title: "Operations Analyst", detail: "4 applicants · 1 offer", status: "Open" },
    ],
  },
  Discipline: {
    kicker: "Discipline",
    title: "Employee cases stay documented and auditable.",
    copy: "Keep notices, explanations, hearings and decisions attached to the case rather than scattered across inboxes.",
    stats: [
      { label: "Open cases", value: "1", hint: "sample workspace" },
      { label: "NTE", value: "Issued", hint: "response pending" },
      { label: "Audit trail", value: "On", hint: "case actions recorded" },
    ],
    rows: [
      { title: "Rico Mendoza", detail: "Attendance policy review · explanation requested", status: "NTE issued" },
    ],
  },
  Separation: {
    kicker: "Separation",
    title: "Offboarding and final pay move together.",
    copy: "Coordinate access removal, leave conversion and final-pay inputs instead of treating resignation as a separate spreadsheet.",
    stats: [
      { label: "Separating", value: "1", hint: "sample employee" },
      { label: "Checklist", value: "4/6", hint: "items completed" },
      { label: "Final pay", value: "Review", hint: "not regular payroll" },
    ],
    rows: [
      { title: "Trish Dela Cruz", detail: "Last day Mar 31 · access and property review", status: "In progress" },
      { title: "Leave conversion", detail: "Approved balance included in final-pay workflow", status: "Ready" },
    ],
  },
  Contractors: {
    kicker: "Contractors",
    title: "Keep non-employees separate from payroll employees.",
    copy: "Track contractor terms, currencies and engagement dates without forcing them into statutory employee payroll.",
    stats: [
      { label: "Active", value: "3", hint: "contractors" },
      { label: "Currencies", value: "2", hint: "PHP and USD" },
      { label: "Employee payroll", value: "Separate", hint: "no accidental inclusion" },
    ],
    rows: [
      { title: "Design contractor", detail: "Monthly · USD", status: "Active" },
      { title: "IT consultant", detail: "Monthly · PHP", status: "Active" },
      { title: "Project accountant", detail: "Fixed term · PHP", status: "Active" },
    ],
  },
  Assets: {
    kicker: "Assets",
    title: "Issued equipment follows the person.",
    copy: "Track assigned devices and returns so offboarding can see what is still outstanding.",
    stats: [
      { label: "Assigned", value: "7", hint: "sample assets" },
      { label: "Due back", value: "1", hint: "separating employee" },
      { label: "Unassigned", value: "2", hint: "available stock" },
    ],
    rows: [
      { title: "MacBook Air M3", detail: "Assigned to Mariel Santos", status: "Assigned" },
      { title: "Dell Latitude 7450", detail: "Assigned to Trish Dela Cruz · return due", status: "Due back" },
      { title: "YubiKey 5C", detail: "Unassigned inventory", status: "Available" },
    ],
  },
};

type PreviewLeaveRow = {
  id: number;
  person: string;
  initials: string;
  type: string;
  dates: string;
  balance: string;
  status: "Pending" | "Approved" | "Declined" | "Review";
};

const BASE_LEAVE_ROWS: PreviewLeaveRow[] = [
  { id: 1, person: "Aira Villanueva", initials: "AV", type: "Emergency leave", dates: "Mar 17–18", balance: "7.0 days left", status: "Pending" },
  { id: 2, person: "Jonas Reyes", initials: "JR", type: "Vacation leave", dates: "Mar 24", balance: "6.5 days left", status: "Approved" },
  { id: 3, person: "Trish Dela Cruz", initials: "TD", type: "Leave conversion", dates: "Final pay", balance: "4.0 days convertible", status: "Review" },
];

function PreviewLeave() {
  const [rows, setRows] = useState<PreviewLeaveRow[]>(BASE_LEAVE_ROWS);
  const [filter, setFilter] = useState<"All" | "Pending">("All");
  const [newOpen, setNewOpen] = useState(false);
  const pending = rows.filter((row) => row.status === "Pending").length;
  const approved = rows.filter((row) => row.status === "Approved").length;
  const visible = filter === "Pending" ? rows.filter((row) => row.status === "Pending") : rows;

  function decide(id: number, status: "Approved" | "Declined") {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, status } : row)));
  }

  function addSampleRequest() {
    setRows((current) => [
      {
        id: Math.max(...current.map((row) => row.id), 0) + 1,
        person: "Nina Garcia",
        initials: "NG",
        type: "Annual leave",
        dates: "Apr 6–7",
        balance: "9.0 days left",
        status: "Pending",
      },
      ...current,
    ]);
    setNewOpen(false);
    setFilter("Pending");
  }

  return (
    <>
      <div className="preview-feature-hero tone-purple">
        <div>
          <span className="kicker">Leave</span>
          <h2>Balances and approvals stay attached to the employee.</h2>
          <p>Try the sample workflow: add a request, filter pending items, then approve or decline it.</p>
        </div>
        <button className="secondary-button preview-hero-action" type="button" onClick={() => setNewOpen((value) => !value)}>
          <CalendarDays size={14} /> {newOpen ? "Close form" : "New request"}
        </button>
      </div>

      <div className="stats-grid preview-stat-grid">
        <MiniStat label="Pending" value={String(pending)} hint="requests awaiting review" tone="amber" icon={CalendarDays} />
        <MiniStat label="Approved" value={String(approved)} hint="sample decisions" tone="mint" icon={Check} />
        <MiniStat label="Payroll link" value="On" hint="approved leave follows cutoff" tone="purple" icon={RefreshCcw} />
      </div>

      {newOpen && (
        <article className="card preview-inline-form">
          <div>
            <span className="card-kicker">NEW SAMPLE REQUEST</span>
            <strong>Nina Garcia · Annual leave · Apr 6–7</strong>
            <small>This writes only to local demo state and resets on refresh.</small>
          </div>
          <div className="preview-inline-form-actions">
            <button className="secondary-button" type="button" onClick={() => setNewOpen(false)}><X size={13} /> Cancel</button>
            <button className="primary-button brand" type="button" onClick={addSampleRequest}><Check size={13} /> Add request</button>
          </div>
        </article>
      )}

      <article className="card preview-feature-card">
        <div className="card-header">
          <div>
            <div className="card-kicker">LEAVE REGISTER</div>
            <h2>Review requests</h2>
            <p>Decisions update the counters immediately so the demo behaves like a real workflow.</p>
          </div>
          <div className="preview-segmented" role="group" aria-label="Filter leave requests">
            {(["All", "Pending"] as const).map((value) => (
              <button key={value} className={filter === value ? "active" : ""} type="button" onClick={() => setFilter(value)}>
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="preview-feature-list">
          {visible.map((row, index) => (
            <div className="preview-feature-row" key={row.id}>
              <span className={`avatar avatar-${index % 5}`} aria-hidden>{row.initials}</span>
              <div className="preview-feature-copy">
                <strong>{row.person}</strong>
                <span>{row.type} · {row.dates}</span>
                <small>{row.balance}</small>
              </div>
              <Status value={row.status === "Pending" ? "Awaiting approval" : row.status} />
              {row.status === "Pending" && (
                <div className="preview-row-actions">
                  <button type="button" className="preview-decision preview-decline" aria-label={`Decline ${row.person}`} onClick={() => decide(row.id, "Declined")}>
                    <X size={12} /> Decline
                  </button>
                  <button type="button" className="preview-decision preview-approve" aria-label={`Approve ${row.person}`} onClick={() => decide(row.id, "Approved")}>
                    <Check size={12} /> Approve
                  </button>
                </div>
              )}
            </div>
          ))}
          {visible.length === 0 && <div className="empty-state">No pending leave requests. Try adding a sample request.</div>}
        </div>
      </article>
    </>
  );
}

function PreviewMigration({ run }: { run: ReturnType<typeof buildSampleRun> }) {
  const [source, setSource] = useState("Sprout");
  const [stage, setStage] = useState<"choose" | "mapped" | "validated">("choose");

  return (
    <>
      <div className="preview-feature-hero tone-teal">
        <div>
          <span className="kicker">Migration</span>
          <h2>Switch payroll software without rebuilding your data.</h2>
          <p>Try a sample import: choose a source, load an export, then validate the detected mappings.</p>
        </div>
        <span className="status status-simulation">Local demo</span>
      </div>

      <article className="card preview-migration-card">
        <div className="preview-migration-step">
          <span>1</span>
          <div>
            <strong>Choose current system</strong>
            <p>Header aliases adapt to common payroll and HRIS exports.</p>
          </div>
          <select value={source} onChange={(event) => { setSource(event.target.value); setStage("choose"); }}>
            <option>Sprout</option>
            <option>Salarium</option>
            <option>PayrollHero</option>
            <option>GreatDay HR</option>
            <option>Other CSV</option>
          </select>
        </div>
        <div className="preview-migration-step">
          <span>2</span>
          <div>
            <strong>Load sample export</strong>
            <p>Employee ID, salary, statutory IDs and payout fields are detected automatically.</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => setStage("mapped")}>
            <UploadCloud size={14} /> Load sample
          </button>
        </div>
        {stage !== "choose" && (
          <div className="preview-mapping-grid">
            {[
              ["Employee ID", "Employee No"],
              ["Basic Salary", "Monthly Basic"],
              ["PhilHealth PIN", "PhilHealth No"],
              ["Bank Account", "Bank Account"],
            ].map(([from, to]) => (
              <div key={from}><span>{from}</span><ArrowUpRight size={12} /><strong>{to}</strong></div>
            ))}
          </div>
        )}
        {stage === "mapped" && (
          <div className="run-actions">
            <span className="preview-validation-copy">42 rows · 40 ready · 2 warnings · no data written yet</span>
            <button className="primary-button brand" type="button" onClick={() => setStage("validated")}>
              <Check size={14} /> Validate import
            </button>
          </div>
        )}
        {stage === "validated" && (
          <div className="notice notice-green" style={{ margin: 14 }}>
            <Check size={15} />
            <span><strong>Validation passed.</strong> Historical payroll stays preserved and the current sample run remains {money(run.net)} net.</span>
          </div>
        )}
      </article>
    </>
  );
}

function PreviewFeature({ tab, run }: { tab: Tab; run: ReturnType<typeof buildSampleRun> }) {
  const navItem = TABS.find((item) => item.name === tab);
  const group = PREVIEW_GROUPS.find((candidate) => candidate.items.some((item) => item.name === tab));
  const spec = FEATURE_PREVIEWS[tab] ?? {
    kicker: group?.label ?? "Workspace",
    title: navItem?.name ?? tab,
    copy: navItem?.hint ?? "Explore this module in the connected sample workspace.",
    stats: [
      { label: "Workspace", value: "Connected", hint: "same sample company" },
      { label: "Data", value: "Sample", hint: "no live writes" },
      { label: "Access", value: "Role-aware", hint: "real product permissions" },
    ],
    rows: [
      { title: navItem?.name ?? tab, detail: navItem?.hint ?? "Module preview", status: "Available" },
      { title: "Audit trail", detail: "Product actions remain traceable in the authenticated workspace", status: "Connected" },
      { title: "Same company context", detail: "No dead client switch or separate fake dataset", status: "Connected" },
    ],
  };

  return (
    <>
      <div className="console-strip" style={{ marginBottom: 14 }}>
        <div className="console-strip-top">
          <div>
            <span className="kicker">{spec.kicker}</span>
            <h2 style={{ fontSize: 17 }}>{spec.title}</h2>
            <p style={{ fontSize: 11.5, maxWidth: 620 }}>{spec.copy}</p>
          </div>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 14 }}>
        {spec.stats.map((stat, index) => (
          <MiniStat
            key={stat.label}
            label={stat.label}
            value={stat.value}
            hint={stat.hint}
            tone={["purple", "mint", "blue"][index % 3]}
            icon={TABS.find((item) => item.name === tab)?.icon ?? LayoutDashboard}
          />
        ))}
      </div>

      <article className="card">
        <div className="card-header">
          <div>
            <div className="card-kicker">{tab}</div>
            <h2 style={{ fontSize: 14 }}>Sample workspace activity</h2>
            <p>
              This is sample data in the public simulation. The authenticated workspace uses the server-backed module.
            </p>
          </div>
          <Status value="Simulation" />
        </div>
        <div className="approval-list">
          {spec.rows.map((row) => (
            <div className="approval-content" key={row.title}>
              <span className="approval-symbol" aria-hidden>
                <Check size={15} className="i-green" />
              </span>
              <div>
                <strong>{row.title}</strong>
                <p>{row.detail}</p>
              </div>
              <Status value={row.status} />
            </div>
          ))}
        </div>
        {tab === "Migration" && (
          <div className="notice notice-blue" style={{ margin: "0 16px 16px" }}>
            <RefreshCcw size={15} className="i-teal" />
            <span>
              <strong>Switching mid-year?</strong> Imported payroll history contributes to year-end totals without being
              recalculated under the current rule engine. The current sample run remains {money(run.net)} net.
            </span>
          </div>
        )}
      </article>
    </>
  );
}

function MiniStat({
  label,
  value,
  hint,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  tone: string;
  icon: LucideIcon;
}) {
  return (
    <article className="stat-card" style={{ minHeight: 96, padding: "13px 14px" }}>
      <div className="stat-top">
        {/* The chip owns the colour; the icon only has to say what the figure is. */}
        <span className={`stat-icon ${tone}`} aria-hidden>
          <Icon size={14} />
        </span>
      </div>
      <p>{label}</p>
      <h3 style={{ fontSize: 19 }}>{value}</h3>
      <span>{hint}</span>
    </article>
  );
}
