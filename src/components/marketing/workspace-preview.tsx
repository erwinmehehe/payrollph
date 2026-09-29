"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Download,
  FileBarChart2,
  Globe,
  HandCoins,
  LayoutDashboard,
  Package,
  ReceiptText,
  RefreshCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  UserPlus,
  UsersRound,
  UserX,
  WalletCards,
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
import { Battery, Progress, Status, formatDate, money, moneyExact, shortMoney } from "@/components/workspace/ui";

type Tab =
  | "Overview"
  | "Payroll"
  | "People"
  | "Migration"
  | "Time & attendance"
  | "Leave"
  | "Approvals"
  | "Analytics"
  | "Exports"
  | "Compliance"
  | "Loans"
  | "Benefits"
  | "De minimis"
  | "Expenses"
  | "Earned wage"
  | "Recruitment"
  | "Discipline"
  | "Separation"
  | "Contractors"
  | "Assets";

type PreviewGroup = "Workspace" | "Operate";

const TABS: Array<{ key: Tab; icon: typeof LayoutDashboard; tone: string; group: PreviewGroup }> = [
  { key: "Overview", icon: LayoutDashboard, tone: "blue", group: "Workspace" },
  { key: "Payroll", icon: WalletCards, tone: "green", group: "Workspace" },
  { key: "People", icon: UsersRound, tone: "purple", group: "Workspace" },
  { key: "Migration", icon: RefreshCcw, tone: "teal", group: "Workspace" },
  { key: "Time & attendance", icon: Clock3, tone: "cyan", group: "Workspace" },
  { key: "Leave", icon: CalendarDays, tone: "pink", group: "Workspace" },
  { key: "Approvals", icon: ClipboardCheck, tone: "amber", group: "Workspace" },
  { key: "Analytics", icon: FileBarChart2, tone: "blue", group: "Operate" },
  { key: "Exports", icon: UploadCloud, tone: "teal", group: "Operate" },
  { key: "Compliance", icon: ShieldCheck, tone: "green", group: "Operate" },
  { key: "Loans", icon: Banknote, tone: "amber", group: "Operate" },
  { key: "Benefits", icon: HandCoins, tone: "pink", group: "Operate" },
  { key: "De minimis", icon: Sparkles, tone: "purple", group: "Operate" },
  { key: "Expenses", icon: ReceiptText, tone: "cyan", group: "Operate" },
  { key: "Earned wage", icon: CircleDollarSign, tone: "green", group: "Operate" },
  { key: "Recruitment", icon: UserPlus, tone: "blue", group: "Operate" },
  { key: "Discipline", icon: AlertCircle, tone: "red", group: "Operate" },
  { key: "Separation", icon: UserX, tone: "red", group: "Operate" },
  { key: "Contractors", icon: Globe, tone: "teal", group: "Operate" },
  { key: "Assets", icon: Package, tone: "amber", group: "Operate" },
];

const CORE_INTERACTIVE_TABS = new Set<Tab>([
  "Overview",
  "Payroll",
  "People",
  "Time & attendance",
  "Approvals",
  "Exports",
]);

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
  const [client, setClient] = useState(SAMPLE_CLIENTS[0]);
  const [clientOpen, setClientOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [released, setReleased] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [decided, setDecided] = useState<Record<number, "Approved" | "Declined">>({});
  const [query, setQuery] = useState("");

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
            {(["Workspace", "Operate"] as PreviewGroup[]).map((group) => (
              <div key={group}>
                <div
                  style={{
                    padding: group === "Workspace" ? "2px 10px 5px" : "14px 10px 5px",
                    color: "var(--muted)",
                    fontSize: 8.5,
                    fontWeight: 700,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                  }}
                >
                  {group}
                </div>
                {TABS.filter((item) => item.group === group).map(({ key, icon: Icon, tone }) => (
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
                    {key === "People" && <b>{SAMPLE_EMPLOYEES.length}</b>}
                  </button>
                ))}
              </div>
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
                        {option.id === client.id && <Check size={14} className="i-green" />}
                      </button>
                    ))}
                  </div>
                )}
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
                  <UsersRound size={22} className="i-purple" />
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
                  {activeTab === "Time & attendance" && <PreviewTime />}
                  {activeTab === "Approvals" && (
                    <PreviewApprovals decided={decided} onDecide={(id, status) => setDecided((current) => ({ ...current, [id]: status }))} />
                  )}
                  {activeTab === "Exports" && <PreviewExports run={run} released={released} />}
                  {!CORE_INTERACTIVE_TABS.has(activeTab) && <PreviewFeature tab={activeTab} run={run} />}
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

function PreviewFeature({ tab, run }: { tab: Tab; run: ReturnType<typeof buildSampleRun> }) {
  const spec = FEATURE_PREVIEWS[tab];
  if (!spec) return null;

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
            icon={TABS.find((item) => item.key === tab)?.icon ?? LayoutDashboard}
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
