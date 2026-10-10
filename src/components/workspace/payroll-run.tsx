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
import { PayrollHandoff } from "@/components/payroll-handoff";
import type { TaskTarget } from "@/lib/task-first-ui";
import { PayrollConnectedImpactPanel } from "./payroll-connected-impact-panel";
import { buildPayrollHandoff, handoffViewerRole } from "@/lib/payroll-handoff";
import { derivePayrollPayoutState } from "@/lib/payroll-payout-state";
import { readLineItems, readTrace, type BankTemplate, type DashboardData, type Notify, type PayrollEntry, type PayrollLineItem, type PayrollReleaseReceipt, type PayrollRun, type Task } from "./types";
import { PayrollAssurancePanel } from "./payroll-assurance-panel";
import { PayrollOfficerWorkspace } from "./payroll-officer-workspace";
import { StatutoryRemittancePanel } from "./statutory-remittance-panel";
import { StatutoryRemittanceActionQueue } from "./statutory-remittance-action-queue";
import { StatutoryRemittanceCorrectionsPanel } from "./statutory-remittance-corrections-panel";
import { StatutoryContributionIssueCasesPanel } from "./statutory-contribution-issue-cases-panel";
import { StatutoryRemittanceMonthClose } from "./statutory-remittance-month-close";
import { OwnerPayrollRelease } from "./owner-payroll-release";
import { ExplainPayDrawer } from "./explain-pay-drawer";
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

type ReleaseChecklistItem = {
  key: "inputs" | "attendance" | "calculation" | "exceptions" | "statutory" | "approval" | "bank";
  label: string;
  passed: boolean;
  blocking: boolean;
  acknowledgeable?: boolean;
  detail: string;
};

const GOVERNMENT_DRAFTS = [
  { value: "bir-1601c", label: "BIR 1601-C worksheet" },
  { value: "bir-1604c-source", label: "BIR 1604-C annual source extract" },
  { value: "sss-r3", label: "SSS e-CL / R-3 worksheet" },
  { value: "philhealth-rf1", label: "PhilHealth EPRS / RF-1 worksheet" },
  { value: "pagibig-mcrf", label: "Pag-IBIG MCRF / eSRS worksheet" },
] as const;

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
  availablePages = [],
  taskTarget,
}: {
  data: DashboardData;
  busy: boolean;
  onNewRun: () => void;
  onProcess: (runId: number) => Promise<void>;
  onRelease: (runId: number, acknowledgeExceptions: boolean) => Promise<{ receipt?: PayrollReleaseReceipt; error?: string }>;
  onDecide: (taskId: number, status: "Approved" | "Declined") => Promise<void>;
  onPage: (page: string) => void;
  onRefresh: () => Promise<void>;
  notify: Notify;
  availablePages?: readonly string[];
  taskTarget?: TaskTarget & {sequence:number};
}) {
  const [selectedId, setSelectedId] = useState<number | undefined>(data.payrollRuns[0]?.id);
  const taskSequence = taskTarget?.sequence;
  const targetRunId = taskTarget?.runId;
  const targetFocus = taskTarget?.focus;
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [explainEmployeeId, setExplainEmployeeId] = useState<number | null>(null);
  const [onlyExceptions, setOnlyExceptions] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [exportsOpen, setExportsOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewApprovers, setReviewApprovers] = useState<Array<{ id: number; name: string; email: string; role: string }>>([]);
  const [reviewApproverId, setReviewApproverId] = useState<number | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [releaseChecklist, setReleaseChecklist] = useState<{
    ready: boolean;
    items: ReleaseChecklistItem[];
    assuranceSummary?: { high: number; medium: number; blocking: number } | null;
    assuranceFindings?: Array<{
      code: string;
      severity: "high" | "medium" | "info";
      blocking: boolean;
      title: string;
      detail: string;
      employeeId: number | null;
    }>;
  } | null>(null);
  const [releaseReceipt, setReleaseReceipt] = useState<PayrollReleaseReceipt | null>(null);
  const [releaseFailure, setReleaseFailure] = useState<{ runId: number; error: string } | null>(null);

  useEffect(() => {
    if (taskSequence === undefined) return;
    if (targetRunId && data.payrollRuns.some(r=>r.id===targetRunId)) setSelectedId(targetRunId);
    setOnlyExceptions(targetFocus === "exceptions");
    setExpanded(null);
  },[taskSequence,targetRunId,targetFocus,data.payrollRuns]);

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

  useEffect(() => {
    if (!runId) {
      setReleaseChecklist(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const response = await fetch(`/api/payroll-runs/${runId}/release-checklist`, { cache: "no-store" });
        if (!alive) return;
        if (!response.ok) {
          setReleaseChecklist(null);
          return;
        }
        setReleaseChecklist(await response.json());
      } catch {
        if (alive) setReleaseChecklist(null);
      }
    })();
    return () => { alive = false; };
  }, [runId, data.payrollRuns, data.tasks]);

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

  useEffect(() => {
    if (taskSequence === undefined || !run || (targetRunId && run.id !== targetRunId)) return;
    const id = targetFocus === "review" ? "payroll-review-status" : targetFocus === "exceptions" || targetFocus === "register" ? "payroll-register" : targetFocus === "comparison" ? "payroll-assurance" : null;
    if (!id) return;
    const frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({behavior:"smooth",block:"start"}));
    return () => cancelAnimationFrame(frame);
  },[taskSequence,targetRunId,targetFocus,run?.id]);

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
  const handoffStages = buildPayrollHandoff(run, {
    payrollExceptions: exceptionRows.length,
    approvalTask: relatedTask,
  });
  const handoffRole = handoffViewerRole(data.access?.role ?? data.user?.role);
  const payrollOfficerMode = data.access?.role === "payroll";
  const ownerMode = data.access?.role === "owner";
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
  const hardChecklistBlocked = releaseChecklist?.items.some(
    (item) => item.blocking && !item.passed && !item.acknowledgeable,
  ) ?? false;
  const checklistAcknowledgementNeeded = releaseChecklist?.items.some(
    (item) => item.blocking && !item.passed && item.acknowledgeable,
  ) ?? false;

  const failedChecklistItem = releaseChecklist?.items.find((item) => item.blocking && !item.passed);
  const persistedReleaseReceipt = readReleaseReceipt(data.auditEvents, run.id);
  const visibleReleaseReceipt =
    persistedReleaseReceipt ?? (releaseReceipt?.runId === run.id ? releaseReceipt : null);
  const recoveryStates: Array<{
    key: string;
    title: string;
    detail: string;
    actionLabel: string;
    onAction: () => void;
  }> = [];

  if (run.status === "Failed") {
    recoveryStates.push({
      key: "calculation-failed",
      title: "Calculation failed",
      detail: "The payroll worker could not finish this run. No failed calculation can move forward to checker review or release.",
      actionLabel: "Retry calculation",
      onAction: () => void onProcess(run.id),
    });
  }

  if (!released && run.status === "Needs review" && exceptionRows.length > 0) {
    recoveryStates.push({
      key: "unresolved-exception",
      title: "Unresolved payroll exceptions",
      detail: `${exceptionRows.length} payroll entr${exceptionRows.length === 1 ? "y needs" : "ies need"} review before this run should be handed off again.`,
      actionLabel: "Review exceptions",
      onAction: () => {
        setOnlyExceptions(true);
        document.getElementById("payroll-register")?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    });
  }

  if (!released && relatedTask?.status === "Declined") {
    recoveryStates.push({
      key: "checker-declined",
      title: "Checker declined this payroll",
      detail: "The independent checker returned the run to Needs review. Resolve the register or assurance issue, then submit the corrected run again.",
      actionLabel: "Resubmit to checker",
      onAction: () => void openReviewSubmission(),
    });
  }

  if (releaseFailure?.runId === run.id) {
    const needsRecalculation = /recalculat|changed after calculation|immutable|register no longer matches/i.test(releaseFailure.error);
    recoveryStates.push({
      key: "release-failed",
      title: "Release blocked",
      detail: releaseFailure.error,
      actionLabel: needsRecalculation ? "Recalculate payroll" : "Review release checks",
      onAction: needsRecalculation
        ? () => void onProcess(run.id)
        : () => document.getElementById("release-checklist")?.scrollIntoView({ behavior: "smooth", block: "center" }),
    });
  } else if (!released && hardChecklistBlocked && failedChecklistItem) {
    recoveryStates.push({
      key: "release-blocked",
      title: "Release blocked",
      detail: `${failedChecklistItem.label}: ${failedChecklistItem.detail}`,
      actionLabel: "Review release checks",
      onAction: () => document.getElementById("release-checklist")?.scrollIntoView({ behavior: "smooth", block: "center" }),
    });
  }

  return (
    <>
      <PageHeading
        eyebrow={
          payrollOfficerMode
            ? `${data.selectedOrganization.legalName} · Payroll Officer`
            : ownerMode
              ? `${data.selectedOrganization.legalName} · Owner`
              : `Payroll run #${run.id}`
        }
        title={payrollOfficerMode ? "Run payroll." : ownerMode ? "Review and release payroll." : "Pay confidently, every cycle."}
        copy={
          payrollOfficerMode
            ? "Prepare inputs, calculate the cutoff, resolve exceptions, then hand the run to an independent Checker. Release stays outside the Payroll Officer role."
            : ownerMode
              ? "Confirm the independent review, total funding requirement and payout readiness before you release the payroll."
              : "Prepare, approve, release and export are deliberately separate steps. Each one is authorised on the server against your role and this client's workspace."
        }
        actions={
          <>
            {!payrollOfficerMode && !ownerMode && (
              <button
                className="secondary-button"
                disabled={!calculated}
                onClick={() => setExportsOpen((current) => !current)}
                aria-expanded={exportsOpen}
              >
                <FileSpreadsheet size={15} className="i-teal" /> Exports
              </button>
            )}
            {!ownerMode && (
              <button className="primary-button brand" onClick={onNewRun}>
                <Plus size={16} className="i-green" /> New payroll
              </button>
            )}
          </>
        }
      />

      {(taskTarget?.focus === "review") && (
        <section className="card tf-review-status" id="payroll-review-status" aria-labelledby="payroll-review-title" style={{ marginBottom: 18 }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">INDEPENDENT PAYROLL REVIEW</div>
              <h2 id="payroll-review-title" tabIndex={-1}>{run.periodLabel} · Review status</h2>
              <p>This is the recorded status for payroll run #{run.id}. Viewing it does not approve or release payroll.</p>
            </div>
            <Status value={run.status} />
          </div>
          <div className="card-body" style={{ paddingTop: 0 }}>
            <PayrollHandoff
              stages={handoffStages}
              period={run.periodLabel}
              status={run.status}
              payDate={formatDate(run.payDate)}
              viewerRole={handoffRole}
              compact
            />
            <div className="tf-review-summary">
              <div><strong>Checker assignment</strong><span>{relatedTask?.approver ?? "Not yet assigned"}</span></div>
              <div><strong>Checker decision</strong><span>{relatedTask?.status ?? "No decision recorded"}</span></div>
            </div>
            <p className="tf-review-note">Checker review, payroll release, bank payout, and payment settlement are separate steps. A released payroll is not proof that employees have received funds.</p>
          </div>
        </section>
      )}

      {["owner", "admin", "bookkeeper", "payroll"].includes(data.access?.role ?? "") && (
        <PayrollConnectedImpactPanel runId={run.id} onPage={onPage} allowedPages={availablePages} />
      )}

      {!payrollOfficerMode && !ownerMode && (
        <PayrollHandoff
          stages={handoffStages}
          period={run.periodLabel}
          status={run.status}
          payDate={formatDate(run.payDate)}
          viewerRole={handoffRole}
          compact
        />
      )}

      {payrollOfficerMode && (
        <PayrollOfficerWorkspace
          data={data}
          run={run}
          entries={entries}
          checklist={releaseChecklist?.items ?? null}
          assuranceFindings={releaseChecklist?.assuranceFindings ?? []}
          relatedTask={relatedTask}
          calculated={calculated}
          busy={busy}
          onCalculate={() => void onProcess(run.id)}
          onSubmit={() => void openReviewSubmission()}
          onOpenApproval={() => onPage("Approvals")}
          onPage={onPage}
          onInspectEntry={(entry) => {
            setOnlyExceptions(true);
            setExpanded(entry.id);
            document.getElementById("payroll-register")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          onExplainEmployee={setExplainEmployeeId}
          onShowAllExceptions={() => {
            setOnlyExceptions(true);
            document.getElementById("payroll-register")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      )}

      {["owner", "admin", "bookkeeper", "payroll"].includes(data.access?.role ?? "") && (
        <StatutoryRemittancePanel
          organizationId={data.selectedOrganization.id}
          legalEntityId={run.legalEntityId}
          defaultMonth={String(run.periodEnd).slice(0, 7)}
          notify={notify}
        />
      )}

      {["owner", "admin", "bookkeeper", "payroll"].includes(data.access?.role ?? "") && (
        <StatutoryRemittanceActionQueue
          organizationId={data.selectedOrganization.id}
          notify={notify}
        />
      )}

      {["owner", "admin", "bookkeeper", "payroll"].includes(data.access?.role ?? "") && (
        <StatutoryContributionIssueCasesPanel
          organizationId={data.selectedOrganization.id}
          legalEntityId={run.legalEntityId}
          notify={notify}
        />
      )}

      {["owner", "admin", "bookkeeper", "payroll", "checker"].includes(data.access?.role ?? "") && (
        <StatutoryRemittanceCorrectionsPanel
          organizationId={data.selectedOrganization.id}
          notify={notify}
        />
      )}

      {["owner", "admin", "checker"].includes(data.access?.role ?? "") && (
        <StatutoryRemittanceMonthClose
          organizationId={data.selectedOrganization.id}
          legalEntityId={run.legalEntityId}
          applicableMonth={String(run.periodEnd).slice(0, 7)}
          notify={notify}
        />
      )}

      {ownerMode && (
        <OwnerPayrollRelease
          data={data}
          run={run}
          entries={entries}
          checklist={releaseChecklist?.items ?? null}
          relatedTask={relatedTask}
          busy={busy}
          onRelease={() => setConfirmRelease(true)}
          onPage={onPage}
          onInspectPayroll={() => {
            document.getElementById("payroll-assurance")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      )}

      {visibleReleaseReceipt?.runId === run.id && (
        <article className="card" data-release-receipt style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">RELEASE RECEIPT</div>
              <h2>Payroll released successfully</h2>
              <p>{visibleReleaseReceipt.periodLabel} is locked and available for downstream payout and employee self-service.</p>
            </div>
            <span className="status status-released"><Check size={12} /> Released</span>
          </div>
          <div className="run-stats" style={{ marginTop: 0 }}>
            <div>
              <span>Employees</span>
              <strong>{visibleReleaseReceipt.employeeCount}</strong>
              <small>payslips available</small>
            </div>
            <div>
              <span>Total net payroll</span>
              <strong className="green-number">{money(visibleReleaseReceipt.totalNetPay)}</strong>
              <small>released register total</small>
            </div>
            <div>
              <span>Released</span>
              <strong style={{ fontSize: 14 }}>{displayReleaseTimestamp(visibleReleaseReceipt.releasedAt)}</strong>
              <small>server-recorded release time</small>
            </div>
          </div>
          <div className="card-body" style={{ paddingTop: 0, display: "grid", gap: 8 }}>
            <div className="exception-row" style={{ alignItems: "flex-start" }}>
              <span
                className={`status ${visibleReleaseReceipt.bankExport.status === "generated" ? "status-approved" : "status-review"}`}
                style={{ minWidth: 72, justifyContent: "center" }}
              >
                {visibleReleaseReceipt.bankExport.status === "generated" ? "Generated" : "Waiting"}
              </span>
              <div>
                <strong>Bank-file fallback</strong>
                <p>{visibleReleaseReceipt.bankExport.label}</p>
              </div>
              <button className="secondary-button" onClick={() => setExportsOpen(true)}>Open exports</button>
            </div>
            {visibleReleaseReceipt.payout && (
              <div className="exception-row" style={{ alignItems: "flex-start" }} data-payout-status={visibleReleaseReceipt.payout.status}>
                <span
                  className={`status ${visibleReleaseReceipt.payout.status === "completed" ? "status-approved" : "status-review"}`}
                  style={{ minWidth: 72, justifyContent: "center" }}
                >
                  {visibleReleaseReceipt.payout.status === "completed"
                    ? "Completed"
                    : visibleReleaseReceipt.payout.status === "submitted"
                      ? "Submitted"
                      : visibleReleaseReceipt.payout.status === "ready"
                        ? "Ready"
                        : "Preflight"}
                </span>
                <div>
                  <strong>Payout status</strong>
                  <p>
                    {visibleReleaseReceipt.payout.label}
                    {visibleReleaseReceipt.payout.reference ? ` · Ref ${visibleReleaseReceipt.payout.reference}` : ""}
                  </p>
                </div>
                {visibleReleaseReceipt.payout.status !== "completed" && (
                  <button className="secondary-button" onClick={() => onPage("Exports")}>Finish payout</button>
                )}
              </div>
            )}
            <div className="exception-row" style={{ alignItems: "flex-start" }}>
              <span className={`status ${visibleReleaseReceipt.payslips.status === "ready" ? "status-approved" : "status-review"}`} style={{ minWidth: 72, justifyContent: "center" }}>
                {visibleReleaseReceipt.payslips.status === "ready" ? "Ready" : "Check"}
              </span>
              <div>
                <strong>Payslip delivery</strong>
                <p>{visibleReleaseReceipt.payslips.label}. {visibleReleaseReceipt.payslips.available} payslip(s) are available in self-service.</p>
                {(visibleReleaseReceipt.payslips.noticesSent !== undefined
                  || visibleReleaseReceipt.payslips.noticesFailed !== undefined) && (
                  <small>
                    {visibleReleaseReceipt.payslips.noticesSent ?? 0} sent · {visibleReleaseReceipt.payslips.noticesQueued} queued · {visibleReleaseReceipt.payslips.noticesFailed ?? 0} failed · {visibleReleaseReceipt.payslips.missingEmail} missing email
                  </small>
                )}
              </div>
            </div>
          </div>
        </article>
      )}

      {recoveryStates.length > 0 && (
        <section aria-label="Payroll recovery actions" style={{ display: "grid", gap: 10, marginBottom: 16 }}>
          {recoveryStates.map((item) => (
            <div className="notice notice-amber" key={item.key} data-recovery-state={item.key}>
              <AlertTriangle size={16} className="i-red" />
              <div style={{ flex: 1 }}>
                <strong>{item.title}</strong>
                <p style={{ margin: "4px 0 0" }}>{item.detail}</p>
              </div>
              <button className="secondary-button" onClick={item.onAction}>{item.actionLabel}</button>
            </div>
          ))}
        </section>
      )}

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
          {!ownerMode && <div className="run-stats">
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
          </div>}

          {/* Run progress */}
          {!ownerMode && <div className="card-body" style={{ paddingTop: 0 }}>
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
          </div>}

          <div id="payroll-assurance">
            <PayrollAssurancePanel runId={run.id} employees={data.employees} onExplainEmployee={setExplainEmployeeId} />
          </div>

          {!payrollOfficerMode && !ownerMode && releaseChecklist && calculated && (
            <div className="card-body" id="release-checklist" style={{ paddingTop: 0 }}>
              <div className="line-title" style={{ margin: 0 }}>
                <div>
                  <strong>Release checklist</strong>
                  <span>{releaseChecklist.ready ? "All release controls currently pass" : "Resolve every blocking control before release"}</span>
                </div>
                <span className={`status ${releaseChecklist.ready ? "status-approved" : "status-review"}`}>
                  {releaseChecklist.ready ? "Ready" : "Blocked"}
                </span>
              </div>
              <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                {releaseChecklist.items.map((item) => (
                  <div key={item.key} className="exception-row" style={{ alignItems: "flex-start" }}>
                    <span className={`status ${item.passed ? "status-approved" : "status-review"}`} style={{ minWidth: 72, justifyContent: "center" }}>
                      {item.passed ? "Pass" : "Action"}
                    </span>
                    <div>
                      <strong>{item.label}</strong>
                      <p>{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Exceptions */}
          {!payrollOfficerMode && !ownerMode && exceptionRows.length > 0 && (
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

          {/* Stage rail: owner/admin/bookkeeper keep the broader lifecycle controls. */}
          {!payrollOfficerMode && !ownerMode && (
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
                      : hardChecklistBlocked
                        ? "Release checklist still has hard blockers. Open the checklist above and resolve them first."
                        : checklistAcknowledgementNeeded || exceptionRows.length > 0
                          ? "Review the remaining exceptions and acknowledge them explicitly in the release confirmation."
                          : "Locks the register, makes the stored payslips available and fires the payroll.released webhook."
                }
                action={
                  released ? (
                    <span className="status status-released" style={{ height: 30, padding: "0 12px" }}>
                      Released
                    </span>
                  ) : (
                    <button className="primary-button brand" disabled={busy || !calculated || relatedTask?.status !== "Approved" || hardChecklistBlocked} onClick={() => setConfirmRelease(true)}>
                      <Send size={14} className="i-pink" /> Release
                    </button>
                  )
                }
              />
              <StageCard
                no={4}
                title="Validate / Export"
                state={released ? "now" : calculated ? "now" : "locked"}
                copy={
                  released
                    ? "Final bank files, payslips, accounting journals and government worksheet drafts are available."
                    : "Run payout validation before release. Final bank files and payslip downloads stay locked until release."
                }
                action={
                  <button className="secondary-button" disabled={!calculated} onClick={() => setExportsOpen(true)}>
                    <Download size={14} className="i-teal" /> {released ? "Open exports" : "Validate payout"}
                  </button>
                }
              />
            </div>
          )}

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

          {exportsOpen && (
            <ExportPanel
              run={run}
              templates={data.templates}
              notify={notify}
              onRefresh={onRefresh}
              onClose={() => setExportsOpen(false)}
            />
          )}

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
                        {open && (
                          <PayslipDetail
                            entry={entry}
                            runId={run.id}
                            periodLabel={run.periodLabel}
                            released={released}
                            notify={notify}
                            onExplain={() => setExplainEmployeeId(entry.employeeId)}
                          />
                        )}
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

      {explainEmployeeId != null && (
        <ExplainPayDrawer
          runId={run.id}
          employeeId={explainEmployeeId}
          employeeName={(() => {
            const employee = data.employees.find((item) => item.id === explainEmployeeId);
            return employee ? `${employee.firstName} ${employee.lastName}` : `Employee #${explainEmployeeId}`;
          })()}
          onClose={() => setExplainEmployeeId(null)}
        />
      )}

      {confirmRelease && (
        <ReleaseDialog
          run={run}
          exceptions={exceptionRows.length || run.exceptions}
          checklist={releaseChecklist?.items ?? []}
          busy={busy}
          onClose={() => setConfirmRelease(false)}
          onConfirm={async (acknowledge) => {
            const result = await onRelease(run.id, acknowledge);
            if (result.receipt) {
              setReleaseReceipt(result.receipt);
              setReleaseFailure(null);
              setConfirmRelease(false);
              return;
            }
            if (result.error) {
              setReleaseFailure({ runId: run.id, error: result.error });
              setConfirmRelease(false);
            }
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
  released,
  notify,
  onExplain,
}: {
  entry: PayrollEntry;
  runId: number;
  periodLabel: string;
  released: boolean;
  notify: Notify;
  onExplain: () => void;
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
        <button className="secondary-button" onClick={onExplain}>
          <BookOpen size={14} className="i-purple" /> Explain this pay
        </button>
        <button
          className="secondary-button"
          disabled={!released}
          title={released ? "Download released payslip" : "Payslip download unlocks after payroll release"}
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
  onRefresh,
  onClose,
}: {
  run: PayrollRun;
  templates: BankTemplate[];
  notify: Notify;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [template, setTemplate] = useState(templates[0]?.name ?? "BDO DAT");
  const [dryRun, setDryRun] = useState(true);
  const [draft, setDraft] = useState<string>(GOVERNMENT_DRAFTS[0].value);
  const [exportFailure, setExportFailure] = useState<{ url: string; label: string; error: string } | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const released = run.status === "Released";

  async function download(url: string, label: string) {
    setExporting(label);
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const error = payload.error ?? `${label} failed with status ${response.status}.`;
        setExportFailure({ url, label, error });
        notify(error, "err");
        return;
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? label.replace(/\s+/g, "-").toLowerCase();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
      setExportFailure(null);
      notify(`${label} generated and audit-logged.`, "info");
      await onRefresh();
    } catch {
      const error = `${label} could not be generated because the export service could not be reached.`;
      setExportFailure({ url, label, error });
      notify(error, "err");
    } finally {
      setExporting(null);
    }
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
          {exportFailure && (
            <div className="notice notice-red" data-recovery-state="export-failed" style={{ marginBottom: 12 }}>
              <AlertTriangle size={15} className="i-red" />
              <div style={{ flex: 1 }}>
                <strong>Export failed</strong>
                <p style={{ margin: "4px 0 0" }}>{exportFailure.error}</p>
              </div>
              <button className="secondary-button" disabled={Boolean(exporting)} onClick={() => void download(exportFailure.url, exportFailure.label)}>
                {exporting ? "Retrying…" : "Retry export"}
              </button>
            </div>
          )}
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
                    <input
                      type="checkbox"
                      checked={dryRun}
                      disabled={!released}
                      onChange={(event) => setDryRun(event.target.checked)}
                    />
                    <i aria-hidden />
                    <span>{released ? "Validate only (dry run)" : "Dry run only until payroll is released"}</span>
                  </label>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      void download(
                        `/api/payroll-runs/${run.id}/exports?kind=bank&template=${encodeURIComponent(template)}&dryRun=${dryRun}`,
                        dryRun ? `${template} dry-run validation` : `${template} file`,
                      )
                    }
                  >
                    <Download size={14} className="i-teal" /> {dryRun ? "Run validation" : "Generate released file"}
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
                  disabled={!released}
                  onClick={() => void download(`/api/payroll-runs/${run.id}/exports?kind=journal`, "Journal CSV")}
                >
                  <Download size={14} className="i-teal" /> {released ? "Journal CSV" : "Available after release"}
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
                      {GOVERNMENT_DRAFTS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      void download(
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
  checklist,
  busy,
  onClose,
  onConfirm,
}: {
  run: PayrollRun;
  exceptions: number;
  checklist: ReleaseChecklistItem[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (acknowledgeExceptions: boolean) => Promise<void>;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const hardFailures = checklist.filter((item) => item.blocking && !item.passed && !item.acknowledgeable);
  const acknowledgementItems = checklist.filter((item) => item.blocking && !item.passed && item.acknowledgeable);
  const needsAcknowledgement = exceptions > 0 || acknowledgementItems.length > 0;
  const blocked = hardFailures.length > 0 || (needsAcknowledgement && !acknowledged);

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

        {hardFailures.length > 0 && (
          <div className="notice notice-red" style={{ margin: "0 0 12px" }}>
            <AlertTriangle size={15} className="i-red" />
            <div>
              <strong>{hardFailures.length} hard release blocker{hardFailures.length === 1 ? "" : "s"} remain.</strong>
              <p style={{ margin: "4px 0 0" }}>{hardFailures.map((item) => item.label).join(" · ")}</p>
            </div>
          </div>
        )}

        {needsAcknowledgement && (
          <div className="notice notice-amber" style={{ margin: 0 }}>
            <AlertTriangle size={15} className="i-red" />
            <div>
              <strong>
                Review acknowledgement required before release.
              </strong>
              <p style={{ margin: "4px 0 8px" }}>
                {exceptions > 0 ? `${exceptions} engine exception(s). ` : ""}
                {acknowledgementItems.length > 0 ? acknowledgementItems.map((item) => item.label).join(" · ") : ""}
                {" "}Your acknowledgement is recorded with the release audit event.
              </p>
              <label className="switch">
                <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
                <i aria-hidden />
                <span>I reviewed these exceptions and accept them for this release</span>
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

function readReleaseReceipt(events: DashboardData["auditEvents"], runId: number): PayrollReleaseReceipt | null {
  const event = events
    .filter((item) => item.action === "Payroll release receipt")
    .find((item) => {
      if (!item.metadata || typeof item.metadata !== "object") return false;
      return Number((item.metadata as Record<string, unknown>).runId) === runId;
    });
  if (!event?.metadata || typeof event.metadata !== "object") return null;
  const raw = event.metadata as Record<string, unknown>;
  const bankExport = raw.bankExport;
  const payslips = raw.payslips;
  if (
    typeof raw.periodLabel !== "string" ||
    typeof raw.totalNetPay !== "string" ||
    typeof raw.releasedAt !== "string" ||
    !bankExport || typeof bankExport !== "object" ||
    !payslips || typeof payslips !== "object"
  ) return null;

  const bank = bankExport as Record<string, unknown>;
  const slips = payslips as Record<string, unknown>;
  if (typeof bank.label !== "string" || typeof slips.label !== "string") return null;

  const payout = derivePayrollPayoutState(events, runId);
  return {
    runId,
    periodLabel: raw.periodLabel,
    employeeCount: Number(raw.employeeCount ?? 0),
    totalNetPay: raw.totalNetPay,
    releasedAt: raw.releasedAt,
    bankExport: payout.bankFile.status === "generated"
      ? {
          status: "generated",
          label: `${payout.bankFile.filename ?? "Fallback bank file"} generated and audit-logged`,
          filename: payout.bankFile.filename,
          generatedAt: payout.bankFile.generatedAt,
        }
      : {
          status: "waiting",
          label: bank.label,
        },
    payout: payout.payout,
    payslips: {
      status: slips.status === "attention" ? "attention" : "ready",
      label: slips.label,
      available: Number(slips.available ?? 0),
      noticesQueued: Number(slips.noticesQueued ?? 0),
      noticesSent: Number(slips.noticesSent ?? 0),
      noticesFailed: Number(slips.noticesFailed ?? 0),
      missingEmail: Number(slips.missingEmail ?? 0),
      warningCount: Number(slips.warningCount ?? 0),
    },
  };
}

function displayReleaseTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(parsed);
}

const monthOf = (date: string) => {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleDateString("en-PH", { month: "short" }).toUpperCase();
};

const dayOf = (date: string) => {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? "-" : String(parsed.getDate());
};
