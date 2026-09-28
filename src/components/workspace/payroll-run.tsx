"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { readLineItems, readTrace, type BankTemplate, type DashboardData, type Notify, type PayrollEntry, type PayrollLineItem, type PayrollRun, type Task } from "./types";
import { PayrollAssurancePanel } from "./payroll-assurance-panel";
import {
  Battery,
  EmptyState,
  ErrorState,
  PageHeading,
  Progress,
  Spinner,
  Status,
  TableSkeleton,
  formatDate,
  money,
  moneyExact,
} from "./ui";

type Stage = "prepare" | "approve" | "release" | "export";

const GOVERNMENT_DRAFTS = ["1601-C", "Alphalist/2316", "SSS R-3", "PhilHealth RF-1", "Pag-IBIG MCRF"];

export function PayrollRunView({
  data,
  busy,
  onNewRun,
  onProcess,
  onRelease,
  onDecide,
  onPage,
  onRefresh,
  notify,
}: {
  data: DashboardData;
  busy: boolean;
  onNewRun: () => void;
  onProcess: (runId: number) => Promise<void>;
  onRelease: (runId: number, acknowledgeExceptions: boolean) => Promise<void>;
  onDecide: (taskId: number, status: "Approved" | "Declined") => Promise<void>;
  onPage: (page: string) => void;
  onRefresh: () => Promise<void>;
  notify: Notify;
}) {
  const [selectedId, setSelectedId] = useState<number | undefined>(data.payrollRuns[0]?.id);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [onlyExceptions, setOnlyExceptions] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [exportsOpen, setExportsOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewApprovers, setReviewApprovers] = useState<Array<{ id: number; name: string; email: string; role: string }>>([]);
  const [reviewApproverId, setReviewApproverId] = useState<number | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);

  // Derived, not synced: if the selected run disappears (client switch, new
  // run) the first run takes over without an effect round-trip.
  const run = data.payrollRuns.find((item) => item.id === selectedId) ?? data.payrollRuns[0];

  // The dashboard ships entries for one run only, which is rarely the run you
  // are looking at. The register therefore loads the selected run's own entries
  // through the membership-gated endpoint, falling back to the dashboard's set
  // while that request is in flight.
  const serverEntryRun = data.payrollRuns.find((item) => item.status !== "Released") ?? data.payrollRuns[0];
  const seeded = run && serverEntryRun && run.id === serverEntryRun.id ? data.payrollEntries : [];
  const [fetched, setFetched] = useState<{ runId: number; entries: PayrollEntry[] } | null>(null);
  const [failedRunId, setFailedRunId] = useState<number | null>(null);
  const runId = run?.id;

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    (async () => {
      try {
        const response = await fetch(`/api/payroll-runs?runId=${runId}&include=entries`, { cache: "no-store" });
        if (!alive) return;
        if (!response.ok) {
          setFailedRunId(runId);
          return;
        }
        const payload = (await response.json()) as { entries?: PayrollEntry[] };
        if (!alive) return;
        setFetched({ runId, entries: payload.entries ?? [] });
        setFailedRunId((current) => (current === runId ? null : current));
      } catch {
        if (alive) setFailedRunId(runId);
      }
    })();
    return () => {
      alive = false;
    };
  }, [runId, data.payrollRuns]);

  const loadedForSelection = Boolean(fetched && fetched.runId === runId);
  const entries = useMemo(
    () => (fetched && fetched.runId === runId ? fetched.entries : seeded),
    // `seeded` is recomputed from props on every render, so this depends on the
    // props it is derived from rather than on the array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetched, runId, data.payrollEntries, serverEntryRun?.id],
  );
  // Derived, not stored: the register is loading until this run's own entries
  // have come back, unless the request already failed.
  const entriesFailed = failedRunId === runId;
  const entriesLoading = !loadedForSelection && !entriesFailed;

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries
      .map((entry) => ({ entry, employee: data.employees.find((person) => person.id === entry.employeeId) }))
      .filter(({ entry, employee }) => {
        if (onlyExceptions && entry.status !== "Exception") return false;
        if (!needle) return true;
        const haystack = `${employee?.firstName ?? ""} ${employee?.lastName ?? ""} ${employee?.employeeNo ?? ""} ${employee?.title ?? ""}`;
        return haystack.toLowerCase().includes(needle);
      });
  }, [entries, data.employees, query, onlyExceptions]);

  const exceptionRows = entries.filter((entry) => entry.status === "Exception");
  const relatedTask = useMemo(() => findRunApproval(data.tasks, run), [data.tasks, run]);
  async function openReviewSubmission() {
    if (!run) return;
    setReviewLoading(true);
    try {
      const response = await fetch(
        `/api/organizations/${data.selectedOrganization.id}/payroll-approvers`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(payload.error ?? "Could not load payroll checkers.", "err");
        return;
      }
      const approvers = Array.isArray(payload.approvers) ? payload.approvers : [];
      setReviewApprovers(approvers);
      setReviewApproverId(approvers[0]?.id ?? null);
      setReviewOpen(true);
    } catch {
      notify("Could not load payroll checkers.", "err");
    } finally {
      setReviewLoading(false);
    }
  }

  async function submitForReview() {
    if (!run || !reviewApproverId) {
      notify("Choose a checker before submitting payroll for review.", "err");
      return;
    }
    const checker = reviewApprovers.find((approver) => approver.id === reviewApproverId);
    setReviewBusy(true);
    try {
      const response = await fetch(`/api/payroll-runs/${run.id}/submit-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approverUserId: reviewApproverId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(payload.error ?? "Payroll could not be submitted for review.", "err");
        return;
      }
      setReviewOpen(false);
      await onRefresh();
      notify(`Payroll submitted to ${checker?.name ?? "the selected checker"} for checker approval.`);
    } catch {
      notify("Could not reach the payroll review service.", "err");
    } finally {
      setReviewBusy(false);
    }
  }

  if (!run) {
    return (
      <>
        <PageHeading
          eyebrow="Payroll"
          title="No payroll runs yet."
          copy="A run is scoped to this client and calculated by the chunked background queue, so it stays resumable at any headcount."
          actions={
            <button className="primary-button brand" onClick={onNewRun}>
              <Plus size={16} className="i-green" /> New payroll
            </button>
          }
        />
        <article className="card">
          <EmptyState icon={<FileText size={22} className="i-teal" />} title="Start the first run">
            Create a semi-monthly run for {data.selectedOrganization.name}. Statutory contributions, derived hours and
            holiday premiums are computed server-side by the rule engine.
          </EmptyState>
        </article>
      </>
    );
  }

  const gross = Number(run.grossPay);
  const net = Number(run.netPay);
  const deductions = Math.max(gross - net, 0);
  const released = run.status === "Released";
  // A run counts as calculated once it has stored figures, even when its
  // entries are not the ones loaded for this page (the dashboard only ships
  // entries for the live run).
  const calculated = entries.length > 0 || Number(run.grossPay) > 0;
  const chunkPercent = run.totalChunks
    ? ((run.processedChunks ?? 0) / Math.max(run.totalChunks, 1)) * 100
    : calculated
      ? 100
      : 0;
  const stage = currentStage(run, relatedTask);

  return (
    <>
      <PageHeading
        eyebrow={`Payroll run #${run.id}`}
        title="Pay confidently, every cycle."
        copy="Prepare, approve, release and export are deliberately separate steps. Each one is authorised on the server against your role and this client's workspace."
        actions={
          <>
            <button className="secondary-button" onClick={() => setExportsOpen((current) => !current)} aria-expanded={exportsOpen}>
              <FileSpreadsheet size={15} className="i-teal" /> Exports
            </button>
            <button className="primary-button brand" onClick={onNewRun}>
              <Plus size={16} className="i-green" /> New payroll
            </button>
          </>
        }
      />

      <section className="payroll-workspace">
        <article className="card run-list flush">
          <div className="card-header">
            <div>
              <div className="card-kicker">Runs</div>
              <h2>{data.payrollRuns.length} on file</h2>
            </div>
          </div>
          {data.payrollRuns.map((item) => (
            <button
              key={item.id}
              className={`run-item ${item.id === run.id ? "selected" : ""}`}
              onClick={() => {
                setSelectedId(item.id);
                setExpanded(null);
              }}
              aria-current={item.id === run.id ? "true" : undefined}
            >
              <span className="run-calendar" aria-hidden>
                <small>{monthOf(item.payDate)}</small>
                <b>{dayOf(item.payDate)}</b>
              </span>
              <span>
                <strong>{item.periodLabel}</strong>
                <small>
                  {item.scopeLabel} · {item.employeeCount} people
                </small>
              </span>
              <Status value={item.status} />
            </button>
          ))}
          <button className="new-run-line" onClick={onNewRun}>
            <Plus size={15} className="i-green" /> Start another payroll
          </button>
        </article>

        <article className="card payroll-detail">
          <div className="card-header">
            <div>
              <div className="card-kicker">
                {run.scopeLabel} · rule engine <span className="mono">{run.ruleVersion}</span>
              </div>
              <h2>{run.periodLabel}</h2>
              <p>
                Pay date {formatDate(run.payDate)} · {run.employeeCount} employees in scope
              </p>
            </div>
            <Status value={run.status} />
          </div>

          {/* Gross → deductions → net */}
          <div className="run-stats">
            <div>
              <span>Gross compensation</span>
              <strong>{money(gross)}</strong>
              <small>basic, overtime, night diff, premiums</small>
            </div>
            <div>
              <span>Employee deductions</span>
              <strong className="red-number">{money(deductions)}</strong>
              <small>statutory, tax, loans, benefits</small>
            </div>
            <div>
              <span>Net pay</span>
              <strong className="green-number">{money(net)}</strong>
              <small>{gross > 0 ? `${Math.round((net / gross) * 100)}% of gross` : "not yet calculated"}</small>
            </div>
          </div>

          {/* Run progress */}
          <div className="card-body" style={{ paddingTop: 0 }}>
            <div className="progress-label">
              <span>
                {run.totalChunks
                  ? `Queue progress, ${run.processedChunks ?? 0} of ${run.totalChunks} chunks`
                  : calculated
                    ? "Calculation complete"
                    : "Not yet calculated"}
              </span>
              <strong>{Math.round(chunkPercent)}%</strong>
            </div>
            <Progress percent={chunkPercent} tone={released ? undefined : chunkPercent < 100 ? "blue" : undefined} />
            {entries.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Battery
                  slices={[
                    { key: "ok", label: "ready", value: entries.filter((entry) => entry.status !== "Exception").length },
                    { key: "review", label: "exception", value: exceptionRows.length },
                  ]}
                />
              </div>
            )}
          </div>

          <PayrollAssurancePanel runId={run.id} employees={data.employees} />

          {/* Exceptions */}
          {exceptionRows.length > 0 && (
            <div className="card-body" style={{ paddingTop: 0 }}>
              <div className="line-title" style={{ margin: 0 }}>
                <strong>Exceptions requiring sign-off</strong>
                <span>{exceptionRows.length} of {entries.length} entries</span>
              </div>
              {exceptionRows.slice(0, 4).map((entry) => {
                const employee = data.employees.find((person) => person.id === entry.employeeId);
                const flags = readTrace(entry).flags;
                return (
                  <div className="exception-row" key={entry.id}>
                    <AlertTriangle size={16} style={{ color: "var(--review)", flex: "none", marginTop: 1 }} />
                    <div>
                      <strong>
                        {employee ? `${employee.firstName} ${employee.lastName}` : `Entry #${entry.id}`}{" "}
                        <span className="mono" style={{ fontWeight: 500, opacity: 0.7 }}>
                          {employee?.employeeNo}
                        </span>
                      </strong>
                      <p>{flags.length ? flags.join(" · ") : "Flagged by the payroll engine, open the payslip for the full trace."}</p>
                    </div>
                    <button
                      className="secondary-button"
                      style={{ height: 28, fontSize: 11 }}
                      onClick={() => {
                        setOnlyExceptions(true);
                        setExpanded(entry.id);
                      }}
                    >
                      Inspect
                    </button>
                  </div>
                );
              })}
              {exceptionRows.length > 4 && (
                <button className="link-button" onClick={() => setOnlyExceptions(true)}>
                  Show all {exceptionRows.length} exceptions in the register
                </button>
              )}
            </div>
          )}

          {/* Stage rail: the four separated actions */}
          <div className="stage-rail">
            <StageCard
              no={1}
              title="Prepare"
              state={calculated ? "done" : stage === "prepare" ? "now" : "locked"}
              copy="Derive hours from punches and compute statutory deductions in the resumable queue."
              action={
                <button className="secondary-button" disabled={busy || released} onClick={() => onProcess(run.id)}>
                  {busy ? <Spinner label="Processing" /> : <RefreshCw size={14} className="i-blue" />}
                  {calculated ? "Re-calculate" : "Calculate"}
                </button>
              }
            />
            <StageCard
              no={2}
              title="Approve"
              state={
                relatedTask
                  ? relatedTask.status === "Pending"
                    ? "now"
                    : relatedTask.status === "Approved"
                      ? "done"
                      : "locked"
                  : calculated
                    ? "now"
                    : "locked"
              }
              copy={
                relatedTask
                  ? relatedTask.status === "Pending"
                    ? `${relatedTask.detail}, checker ${relatedTask.approver}.`
                    : relatedTask.status === "Approved"
                      ? `Approved by ${relatedTask.approver}. Maker-checker control is satisfied.`
                      : "The review was declined. Resolve the issue and submit again."
                  : calculated
                    ? "Submit this calculated payroll to a different person for checker approval."
                    : "Calculate payroll before submitting it for review."
              }
              action={
                relatedTask && relatedTask.status === "Pending" ? (
                  <button className="secondary-button" onClick={() => onPage("Approvals")}>
                    <ArrowRight size={14} /> Open approval
                  </button>
                ) : relatedTask?.status === "Approved" ? (
                  <span className="status status-approved" style={{ height: 30, padding: "0 12px" }}>
                    <Check size={12} /> Approved
                  </span>
                ) : (
                  <button
                    className="secondary-button"
                    disabled={!calculated || released}
                    onClick={() => void openReviewSubmission()}
                  >
                    {reviewLoading ? <Spinner label="Loading" /> : <ShieldCheck size={14} className="i-purple" />} Submit for review
                  </button>
                )
              }
            />
            <StageCard
              no={3}
              title="Release"
              state={released ? "done" : relatedTask?.status === "Approved" ? "now" : "locked"}
              copy={
                released
                  ? "Released. Payslip-ready notices were queued for every active employee with an email on file."
                  : relatedTask?.status !== "Approved"
                    ? "A checker must approve this payroll before release is available."
                    : exceptionRows.length > 0
                      ? `${exceptionRows.length} exception${exceptionRows.length === 1 ? "" : "s"} must be acknowledged explicitly.`
                      : "Locks the register, generates payslips and fires the payroll.released webhook."
              }
              action={
                released ? (
                  <span className="status status-released" style={{ height: 30, padding: "0 12px" }}>
                    Released
                  </span>
                ) : (
                  <button className="primary-button brand" disabled={busy || !calculated || relatedTask?.status !== "Approved"} onClick={() => setConfirmRelease(true)}>
                    <Send size={14} className="i-pink" /> Release
                  </button>
                )
              }
            />
            <StageCard
              no={4}
              title="Export"
              state={released ? "now" : "locked"}
              copy="Bank disbursement files, accounting journals and government worksheet drafts."
              action={
                <button className="secondary-button" disabled={!calculated} onClick={() => setExportsOpen(true)}>
                  <Download size={14} className="i-teal" /> Open exports
                </button>
              }
            />
          </div>

          {reviewOpen && (
            <article className="card" style={{ margin: "0 18px 16px", boxShadow: "none" }}>
              <div className="card-header">
                <div>
                  <div className="card-kicker">Maker-checker review</div>
                  <h2 style={{ fontSize: 16 }}>Choose the checker for this payroll</h2>
                  <p>The person submitting this run cannot approve it. Linaw enforces that rule on the server.</p>
                </div>
                <button className="icon-button" onClick={() => setReviewOpen(false)} aria-label="Close review submission">
                  <X size={15} />
                </button>
              </div>
              <div className="setting-form">
                <label>
                  Checker
                  <select
                    value={reviewApproverId ?? ""}
                    onChange={(event) => setReviewApproverId(event.target.value ? Number(event.target.value) : null)}
                  >
                    <option value="">Choose a checker</option>
                    {reviewApprovers.map((approver) => (
                      <option key={approver.id} value={approver.id}>
                        {approver.name} · {approver.role}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="notice notice-blue" style={{ margin: 0 }}>
                  <ShieldCheck size={15} className="i-purple" />
                  <span>
                    <strong>Maker:</strong> {data.user?.name ?? "Signed-in user"} · <strong>Checker:</strong>{" "}
                    {reviewApprovers.find((approver) => approver.id === reviewApproverId)?.name ?? "not selected"}
                  </span>
                </div>
              </div>
              <div className="run-actions">
                <button className="secondary-button" onClick={() => setReviewOpen(false)}>Cancel</button>
                <button className="primary-button brand" disabled={reviewBusy || !reviewApproverId} onClick={() => void submitForReview()}>
                  {reviewBusy ? <Spinner label="Submitting" /> : <ShieldCheck size={14} className="i-green" />} Submit for review
                </button>
              </div>
            </article>
          )}

          {exportsOpen && <ExportPanel run={run} templates={data.templates} notify={notify} onClose={() => setExportsOpen(false)} />}

          {/* Register */}
          <div className="line-title" id="payroll-register">
            <strong>Register &amp; payslip breakdown</strong>
            <span>Open a row for the full arithmetic trace</span>
          </div>

          {entriesLoading ? (
            <TableSkeleton rows={5} label="Loading this run's register" />
          ) : entriesFailed ? (
            <div style={{ padding: "0 18px 18px" }}>
              <ErrorState
                title="The register could not be loaded"
                detail="The server refused or could not return this run's entries. Your figures above still come from the stored run record."
              />
            </div>
          ) : entries.length === 0 ? (
            <div style={{ padding: "0 18px 18px" }}>
              <EmptyState icon={<FileText size={20} className="i-teal" />} title="Nothing calculated yet">
                Run <strong>Prepare</strong> to derive hours from the raw punches and compute this period&apos;s deductions.
              </EmptyState>
            </div>
          ) : (
            <>
              <div className="table-toolbar" style={{ borderTop: "1px solid var(--line-faint)", borderBottom: 0 }}>
                <div className="search-field">
                  <Search size={15} className="i-slate" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search this register"
                    aria-label="Search register"
                  />
                </div>
                <button
                  className={`filter-button ${onlyExceptions ? "on" : ""}`}
                  onClick={() => setOnlyExceptions((current) => !current)}
                  aria-pressed={onlyExceptions}
                >
                  <AlertTriangle size={14} className="i-red" /> Exceptions only
                  {exceptionRows.length > 0 && <span className="mono">({exceptionRows.length})</span>}
                </button>
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
                  {rows.map(({ entry, employee }) => {
                    const open = expanded === entry.id;
                    return (
                      <div key={entry.id}>
                        <button
                          className={`register-row ${open ? "open" : ""} ${entry.status === "Exception" ? "flagged" : ""}`}
                          onClick={() => setExpanded(open ? null : entry.id)}
                          aria-expanded={open}
                        >
                          <span>
                            {employee ? `${employee.firstName} ${employee.lastName}` : `Employee #${entry.employeeId}`}
                            <small>
                              {employee?.employeeNo} · {employee?.title}
                            </small>
                          </span>
                          <span className="amt right">{money(entry.grossPay)}</span>
                          <span className="amt right red-number">−{money(entry.deductions)}</span>
                          <strong className="right">{money(entry.netPay)}</strong>
                          <span>
                            <Status value={entry.status} />
                          </span>
                          <span className="chev" aria-hidden>
                            <ChevronDown size={15} />
                          </span>
                        </button>
                        {open && <PayslipDetail entry={entry} runId={run.id} periodLabel={run.periodLabel} notify={notify} />}
                      </div>
                    );
                  })}
                </div>
              </div>

              {rows.length === 0 && (
                <EmptyState icon={<Search size={20} className="i-slate" />} title="No entries match">
                  Clear the search or the exceptions filter to see the whole register.
                </EmptyState>
              )}

              <div className="pagination" style={{ border: 0, marginTop: 4 }}>
                <span>
                  Showing <span className="mono">{rows.length}</span> of <span className="mono">{entries.length}</span> calculated
                  entries · totals above come from the run record, not this page
                </span>
              </div>
            </>
          )}
        </article>
      </section>

      {confirmRelease && (
        <ReleaseDialog
          run={run}
          exceptions={exceptionRows.length || run.exceptions}
          busy={busy}
          onClose={() => setConfirmRelease(false)}
          onConfirm={async (acknowledge) => {
            await onRelease(run.id, acknowledge);
            setConfirmRelease(false);
          }}
        />
      )}
    </>
  );
}

function StageCard({
  no,
  title,
  copy,
  state,
  action,
}: {
  no: number;
  title: string;
  copy: string;
  state: "done" | "now" | "locked";
  action: React.ReactNode;
}) {
  return (
    <div className={`stage ${state}`}>
      <div className="stage-top">
        <span className="stage-no" aria-hidden>
          {state === "done" ? <Check size={11} className="i-green" /> : no}
        </span>
        <h4>{title}</h4>
      </div>
      <p>{copy}</p>
      {action}
    </div>
  );
}

/** Expanded payslip: real line items and the engine's own trace, never re-computed here. */
function PayslipDetail({
  entry,
  runId,
  periodLabel,
  notify,
}: {
  entry: PayrollEntry;
  runId: number;
  periodLabel: string;
  notify: Notify;
}) {
  const lines: PayrollLineItem[] = readLineItems(entry);
  const earnings = lines.filter((line) => Number(line.amount) > 0);
  const deductions = lines.filter((line) => Number(line.amount) < 0);
  const trace = readTrace(entry);
  const inputs = trace.inputs;
  const flags = trace.flags;

  // The stored line items should account for the stored totals. When they do
  // not, an older entry written before a line item existed, for instance, say
  // so rather than presenting a breakdown that silently fails to add up.
  const earningsSum = earnings.reduce((sum, line) => sum + Number(line.amount), 0);
  const deductionsSum = deductions.reduce((sum, line) => sum + Math.abs(Number(line.amount)), 0);
  const unexplainedEarnings = Number(entry.grossPay) - earningsSum;
  const unexplainedDeductions = Number(entry.deductions) - deductionsSum;
  const reconciles = Math.abs(unexplainedEarnings) < 0.01 && Math.abs(unexplainedDeductions) < 0.01;

  return (
    <div className="payslip-panel">
      {lines.length === 0 ? (
        <p className="payslip-note">
          This entry has no stored line items. Re-calculating the run regenerates them from the payroll engine.
        </p>
      ) : (
        <div className="payslip-grid">
          <div className="payslip-col">
            <p>Earnings</p>
            {earnings.map((line) => (
              <div className="payslip-line" key={`${line.code}-${line.label}`}>
                <code>{line.code}</code>
                <span>
                  {line.label}
                  {line.notes?.length ? <em>{line.notes.join(" · ")}</em> : null}
                </span>
                <b>{moneyExact(line.amount)}</b>
              </div>
            ))}
            <div className="payslip-total">
              <span>Gross</span>
              <strong style={{ color: "var(--ink)" }}>{moneyExact(entry.grossPay)}</strong>
            </div>
          </div>

          <div className="payslip-col">
            <p>Deductions</p>
            {deductions.map((line) => (
              <div className="payslip-line" key={`${line.code}-${line.label}`}>
                <code>{line.code}</code>
                <span>
                  {line.label}
                  {line.notes?.length ? <em>{line.notes.join(" · ")}</em> : null}
                </span>
                <b className="minus">{moneyExact(Math.abs(Number(line.amount)))}</b>
              </div>
            ))}
            <div className="payslip-total">
              <span>Net pay</span>
              <strong>{moneyExact(entry.netPay)}</strong>
            </div>
          </div>
        </div>
      )}

      {(inputs.length > 0 || flags.length > 0) && (
        <div className="trace-box slim-scroll">
          <p>
            Engine trace · rule version {trace.ruleVersion ?? "-"}
          </p>
          {flags.map((flag) => (
            <span className="trace-line trace-flag" key={flag}>
              ! {flag}
            </span>
          ))}
          {inputs.map((line) => {
            const [key, ...rest] = line.split("=");
            return (
              <span className="trace-line" key={line}>
                <span className="k">{key}</span>
                {rest.length ? (
                  <>
                    = <span className="v">{rest.join("=")}</span>
                  </>
                ) : null}
              </span>
            );
          })}
        </div>
      )}

      {lines.length > 0 && !reconciles && (
        <div className="notice notice-amber" style={{ marginBottom: 0 }}>
          <AlertTriangle size={15} className="i-red" />
          <span>
            The stored line items do not account for this entry&apos;s full totals
            {Math.abs(unexplainedEarnings) >= 0.01 && <>, {moneyExact(Math.abs(unexplainedEarnings))} of gross</>}
            {Math.abs(unexplainedDeductions) >= 0.01 && <>, {moneyExact(Math.abs(unexplainedDeductions))} of deductions</>}{" "}
            is not itemised. The totals above are the authoritative stored figures; re-calculating the run regenerates a
            complete breakdown.
          </span>
        </div>
      )}

      <p className="payslip-note">
        Figures come straight from the stored payroll entry, this panel never re-derives statutory amounts in the browser.
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button
          className="secondary-button"
          onClick={async () => {
            try {
              const response = await fetch(`/api/payroll-runs/${runId}/exports?kind=payslip`);
              if (!response.ok) {
                notify("Payslip list could not be loaded.", "err");
                return;
              }
              const payload = (await response.json()) as { payslips?: Array<{ id: number; employeeId?: number }> };
              const slip = payload.payslips?.find((item) => item.employeeId === entry.employeeId) ?? payload.payslips?.[0];
              if (!slip) {
                notify(`No stored payslip for ${periodLabel} yet, release the run to generate them.`, "err");
                return;
              }
              window.open(`/api/payroll-runs/${runId}/exports?kind=payslip&payslipId=${slip.id}`, "_blank", "noopener");
            } catch {
              notify("Payslip download failed.", "err");
            }
          }}
        >
          <Download size={14} className="i-teal" /> Payslip PDF
        </button>
      </div>
    </div>
  );
}

/** Bank, journal and government exports, every one hits the run's own export route. */
function ExportPanel({
  run,
  templates,
  notify,
  onClose,
}: {
  run: PayrollRun;
  templates: BankTemplate[];
  notify: Notify;
  onClose: () => void;
}) {
  const [template, setTemplate] = useState(templates[0]?.name ?? "BDO DAT");
  const [dryRun, setDryRun] = useState(true);
  const [draft, setDraft] = useState(GOVERNMENT_DRAFTS[0]);

  function download(url: string, label: string) {
    window.open(url, "_blank", "noopener");
    notify(`${label} requested, the download is audit-logged.`, "info");
  }

  return (
    <div className="card-body">
      <div className="card" style={{ boxShadow: "none", background: "var(--canvas)" }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">Exports for {run.periodLabel}</div>
            <h2>Files leave the server, not the browser</h2>
            <p>Each export is generated by the API and written to the audit trail with its template version.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close exports">
            <X size={16} />
          </button>
        </div>

        <div className="card-body">
          <div className="integration-grid">
            <div className="export-card">
              <span className="inline-icon blue" aria-hidden>
                <Building2 size={16} />
              </span>
              <div>
                <h3>Bank disbursement</h3>
                <p>Versioned generators for BDO DAT and BPI / UnionBank / GCash CSV.</p>
                <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                  <label className="field">
                    <span className="sr-only">Bank template</span>
                    <select value={template} onChange={(event) => setTemplate(event.target.value)} aria-label="Bank template">
                      {(templates.length ? templates : [{ id: 0, name: "BDO DAT", version: "-", format: "dat" }]).map((item) => (
                        <option key={item.id} value={item.name}>
                          {item.name} {item.version !== "-" ? `· ${item.version}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="switch">
                    <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
                    <i aria-hidden />
                    <span>Validate only (dry run)</span>
                  </label>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      download(
                        `/api/payroll-runs/${run.id}/exports?kind=bank&template=${encodeURIComponent(template)}&dryRun=${dryRun}`,
                        dryRun ? `${template} dry-run validation` : `${template} file`,
                      )
                    }
                  >
                    <Download size={14} className="i-teal" /> {dryRun ? "Run validation" : "Generate file"}
                  </button>
                </div>
              </div>
            </div>

            <div className="export-card">
              <span className="inline-icon purple" aria-hidden>
                <BookOpen size={16} />
              </span>
              <div>
                <h3>Accounting journal</h3>
                <p>Xero and QuickBooks Online journal CSV for this run&apos;s cost.</p>
                <button
                  className="secondary-button"
                  style={{ marginTop: 10 }}
                  onClick={() => download(`/api/payroll-runs/${run.id}/exports?kind=journal`, "Journal CSV")}
                >
                  <Download size={14} className="i-teal" /> Journal CSV
                </button>
              </div>
            </div>

            <div className="export-card">
              <span className="inline-icon amber" aria-hidden>
                <ShieldCheck size={16} />
              </span>
              <div>
                <h3>
                  Government worksheets <span className="status status-draft-only">Draft</span>
                </h3>
                <p>
                  Generated from real figures but <strong>not</strong> yet validated against the agencies&apos; own import
                  tools. Treat as a worksheet, not a filing.
                </p>
                <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                  <label className="field">
                    <span className="sr-only">Worksheet</span>
                    <select value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Government worksheet">
                      {GOVERNMENT_DRAFTS.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      download(
                        `/api/payroll-runs/${run.id}/exports?kind=government&template=${encodeURIComponent(draft)}`,
                        `${draft} draft`,
                      )
                    }
                  >
                    <Download size={14} className="i-teal" /> Download draft
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReleaseDialog({
  run,
  exceptions,
  busy,
  onClose,
  onConfirm,
}: {
  run: PayrollRun;
  exceptions: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: (acknowledgeExceptions: boolean) => Promise<void>;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const blocked = exceptions > 0 && !acknowledged;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirm payroll release">
      <div className="modal">
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
        <div className="modal-icon">
          <Send size={18} className="i-pink" />
        </div>
        <h2>Release {run.periodLabel}?</h2>
        <p>
          Releasing locks this register, generates payslip PDFs, queues a payslip-ready notice for every active employee
          with an email on file, and fires the <span className="mono">payroll.released</span> webhook. The server re-checks
          your authorisation and the run&apos;s state before anything is written.
        </p>

        <div className="run-stats" style={{ margin: "0 0 16px" }}>
          <div>
            <span>Employees</span>
            <strong>{run.employeeCount}</strong>
          </div>
          <div>
            <span>Net pay</span>
            <strong className="green-number">{money(run.netPay)}</strong>
          </div>
          <div>
            <span>Pay date</span>
            <strong style={{ fontSize: 14 }}>{formatDate(run.payDate)}</strong>
          </div>
        </div>

        {exceptions > 0 && (
          <div className="notice notice-amber" style={{ margin: 0 }}>
            <AlertTriangle size={15} className="i-red" />
            <div>
              <strong>
                {exceptions} exception{exceptions === 1 ? "" : "s"} still flagged.
              </strong>
              <p style={{ margin: "4px 0 8px" }}>
                Incomplete punches derive zero hours. The release endpoint rejects this run unless you acknowledge them
                explicitly, that acknowledgement is recorded in the audit event.
              </p>
              <label className="switch">
                <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
                <i aria-hidden />
                <span>I have reviewed the exceptions and accept them</span>
              </label>
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button brand" disabled={busy || blocked} onClick={() => onConfirm(acknowledged)}>
            {busy ? <Spinner label="Releasing" /> : <Send size={14} className="i-pink" />} Release payroll
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- helpers */

function currentStage(run: PayrollRun, task?: Task): Stage {
  if (run.status === "Released") return "export";
  if (run.status === "Ready for release" && task?.status === "Approved") return "release";
  if (Number(run.grossPay) > 0) return "approve";
  return "prepare";
}

/**
 * Payroll approvals are linked to an exact run id in task detail. Do not fall
 * back to period-title matching: repeated labels and historical seed tasks can
 * otherwise attach the wrong approval to a live run.
 */
function findRunApproval(tasks: Task[], run?: PayrollRun) {
  if (!run) return undefined;
  return tasks
    .filter((task) => task.detail.includes(`Payroll run #${run.id}`))
    .sort((a, b) => b.id - a.id)[0];
}

const monthOf = (date: string) => {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleDateString("en-PH", { month: "short" }).toUpperCase();
};

const dayOf = (date: string) => {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? "-" : String(parsed.getDate());
};
