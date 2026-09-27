"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Check,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  Download,
  FlaskConical,
  LayoutDashboard,
  Search,
  Send,
  UploadCloud,
  UsersRound,
  WalletCards,
} from "lucide-react";
import {
  SAMPLE_APPROVALS,
  SAMPLE_CLIENTS,
  SAMPLE_EMPLOYEES,
  SAMPLE_PUNCHES,
  buildSampleRun,
  type SampleEntry,
} from "./sample-workspace";
import { Battery, Progress, Status, formatDate, money, moneyExact, shortMoney } from "@/components/workspace/ui";

type Tab = "Dashboard" | "Payroll" | "People" | "Time" | "Approvals" | "Exports";

const TABS: Array<{ key: Tab; icon: typeof LayoutDashboard; tone: string }> = [
  { key: "Dashboard", icon: LayoutDashboard, tone: "blue" },
  { key: "Payroll", icon: WalletCards, tone: "green" },
  { key: "People", icon: UsersRound, tone: "purple" },
  { key: "Time", icon: Clock3, tone: "cyan" },
  { key: "Approvals", icon: ClipboardCheck, tone: "amber" },
  { key: "Exports", icon: UploadCloud, tone: "teal" },
];

/**
 * The public workspace preview.
 *
 * `showcase` renders a cropped, non-interactive composition for the hero.
 * `interactive` is the playable version: tabs, client switching, expandable
 * payslips and a simulated release, all local state, nothing persisted.
 */
export function WorkspacePreview({ mode = "interactive" }: { mode?: "showcase" | "interactive" }) {
  const run = useMemo(() => buildSampleRun(), []);
  const [tab, setTab] = useState<Tab>("Dashboard");
  const [client, setClient] = useState(SAMPLE_CLIENTS[0]);
  const [clientOpen, setClientOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [released, setReleased] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [decided, setDecided] = useState<Record<number, "Approved" | "Declined">>({});
  const [query, setQuery] = useState("");

  const interactive = mode === "interactive";
  const activeTab: Tab = interactive ? tab : "Dashboard";

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

      <div className="sim-banner">
        <FlaskConical size={15} />
        <span>
          <strong>Simulated workspace.</strong> The people and punches are sample data and nothing you do here is saved,
          but the SSS, PhilHealth, Pag-IBIG and withholding figures are computed by the same rule engine the real payroll
          uses.
        </span>
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
            {TABS.map(({ key, icon: Icon, tone }) => (
              <button
                key={key}
                className={`nav-item ${activeTab === key ? "active" : ""}`}
                onClick={() => interactive && setTab(key)}
                tabIndex={interactive ? 0 : -1}
                aria-current={activeTab === key ? "page" : undefined}
              >
                <span className={`nav-icon t-${tone}`} aria-hidden>
                  <Icon size={13} strokeWidth={2} />
                </span>
                <span>{key}</span>
                {key === "Approvals" && <b>{SAMPLE_APPROVALS.filter((task) => !decided[task.id]).length}</b>}
              </button>
            ))}
          </aside>

          <div className="pv-main">
            <div className="pv-top">
              <div className="company-switcher-wrap">
                <button
                  className="company-switcher"
                  onClick={() => interactive && setClientOpen((current) => !current)}
                  aria-expanded={clientOpen}
                  tabIndex={interactive ? 0 : -1}
                >
                  <span className="company-logo small" style={{ backgroundColor: client.color }} aria-hidden>
                    {client.name.slice(0, 1)}
                  </span>
                  <span>
                    <strong>{client.name}</strong>
                    <small>
                      {client.plan} · {client.people} people
                    </small>
                  </span>
                  <ChevronDown size={14} />
                </button>
                {clientOpen && interactive && (
                  <div className="company-popover" style={{ width: 260 }}>
                    <p>
                      Client portfolio <span>{SAMPLE_CLIENTS.length} accounts</span>
                    </p>
                    {SAMPLE_CLIENTS.map((option) => (
                      <button
                        key={option.id}
                        className={option.id === client.id ? "selected" : ""}
                        onClick={() => {
                          setClient(option);
                          setClientOpen(false);
                        }}
                      >
                        <span className="company-logo small" style={{ backgroundColor: option.color }} aria-hidden>
                          {option.name.slice(0, 1)}
                        </span>
                        <span>
                          <strong>{option.name}</strong>
                          <small>
                            {option.people} people · {option.plan}
                          </small>
                        </span>
                        {option.id === client.id && <Check size={14} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                <span className="icon-button relative" aria-hidden>
                  <Bell size={16} />
                  <span className="notification-dot">{SAMPLE_APPROVALS.filter((task) => !decided[task.id]).length}</span>
                </span>
                <span className="top-avatar" aria-hidden>
                  CY
                </span>
              </div>
            </div>

            {interactive && (
              <div className="pv-pillnav slim-scroll">
                {TABS.map(({ key }) => (
                  <button key={key} className={activeTab === key ? "on" : ""} onClick={() => setTab(key)}>
                    {key}
                  </button>
                ))}
              </div>
            )}

            <div className="pv-body slim-scroll">
              {client.id !== 1 ? (
                <div className="empty-state">
                  <UsersRound size={22} />
                  <strong>{client.name} is not part of this simulation</strong>
                  <p>
                    Only Masigla Foods carries sample payroll data. Switching clients here demonstrates how the workspace
                    re-scopes every query, in the product, each client&apos;s rows are isolated server-side.
                  </p>
                  <button className="secondary-button" onClick={() => setClient(SAMPLE_CLIENTS[0])}>
                    Back to Masigla Foods
                  </button>
                </div>
              ) : (
                <>
                  {activeTab === "Dashboard" && <PreviewDashboard run={run} released={released} decided={decided} />}
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
                  {activeTab === "Time" && <PreviewTime />}
                  {activeTab === "Approvals" && (
                    <PreviewApprovals decided={decided} onDecide={(id, status) => setDecided((current) => ({ ...current, [id]: status }))} />
                  )}
                  {activeTab === "Exports" && <PreviewExports run={run} released={released} />}
                </>
              )}
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
              <Check size={10} /> Cutoff
            </span>
            <strong>Punches captured</strong>
          </div>
          <div className="track-step done">
            <span>
              <Check size={10} /> Calculate
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
        <MiniStat label="Active people" value={String(SAMPLE_EMPLOYEES.filter((person) => person.status === "Active").length)} hint={`of ${SAMPLE_EMPLOYEES.length} on this client`} tone="mint" />
        <MiniStat label="Net pay" value={shortMoney(run.net)} hint={`${shortMoney(run.gross)} gross`} tone="purple" />
        <MiniStat label="Deductions" value={shortMoney(run.deductions)} hint="statutory + tax" tone="blue" />
        <MiniStat label="Open approvals" value={String(open)} hint={open ? "waiting on a decision" : "queue is clear"} tone={open ? "amber" : "mint"} />
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
              <Send size={14} /> Release (simulated)
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
          <Search size={15} />
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
                    <span className={`avatar avatar-${person.id % 5}`}>{person.initials}</span>
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
            <Search size={20} />
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
                        <span className={`avatar avatar-${punch.employeeId % 5}`}>{person?.initials}</span>
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
        <ClipboardCheck size={15} />
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
                  <ClipboardCheck size={16} />
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
                      <Check size={14} /> Approve
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
        <Download size={15} />
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

function MiniStat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: string }) {
  return (
    <article className="stat-card" style={{ minHeight: 96, padding: "13px 14px" }}>
      <div className="stat-top">
        <span className={`stat-icon ${tone}`} aria-hidden>
          <WalletCards size={14} />
        </span>
      </div>
      <p>{label}</p>
      <h3 style={{ fontSize: 19 }}>{value}</h3>
      <span>{hint}</span>
    </article>
  );
}
