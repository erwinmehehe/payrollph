"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  BookOpen,
  Building2,
  Database,
  Download,
  FileSpreadsheet,
  Info,
  ShieldCheck,
  Users,
  Check,
  Clock3,
} from "lucide-react";
import { derivePayrollPayoutState } from "@/lib/payroll-payout-state";
import { FilingEvidencePanel } from "./filing-evidence";
import { Bir1601cRemittancePanel } from "./bir-1601c-remittance-panel";
import { BookkeeperPayrollClose } from "./bookkeeper-payroll-close";
import { ManagedPayrollControlRoom } from "./managed-payroll-control-room";
import type { DashboardData, Notify } from "./types";
import { EmptyState, PageHeading, Segmented, Status, formatDate, money } from "./ui";

// `kind` is what generateGovernmentDraft accepts. The visible `template` is only
// a label: sending the label made every Draft button here fail as an unsupported export.
const GOVERNMENT_DRAFTS = [
  { template: "1601-C", kind: "bir-1601c", detail: "Monthly remittance return of income taxes withheld on compensation" },
  { template: "Alphalist/2316", kind: "bir-1604c-source", detail: "Annual alphalist source extract, to validate in BIR's ADES" },
  { template: "SSS R-3", kind: "sss-r3", detail: "Monthly contribution collection list, recomputed from the full monthly MSC" },
  { template: "PhilHealth RF-1", kind: "philhealth-rf1", detail: "Employer remittance report" },
  { template: "Pag-IBIG MCRF", kind: "pagibig-mcrf", detail: "Membership contribution remittance form" },
] as const;

// Forms with a recorded-evidence flow. Each one renders its own card.
const EVIDENCE_FORMS = [
  { agency: "BIR", form: "1601-C" },
  { agency: "SSS", form: "R-3" },
  { agency: "BIR", form: "1604-C" },
  { agency: "PhilHealth", form: "RF-1" },
  { agency: "Pag-IBIG", form: "MCRF" },
] as const;

export function ExportsView({
  data,
  notify,
  onRefresh,
}: {
  data: DashboardData;
  notify: Notify;
  onRefresh: () => Promise<void>;
}) {
  const runs = data.payrollRuns;
  const [runId, setRunId] = useState<number | undefined>(runs[0]?.id);
  const [template, setTemplate] = useState(data.templates[0]?.name ?? "BDO DAT");
  const [mode, setMode] = useState<"dry" | "live">("dry");
  const [exportFailure, setExportFailure] = useState<{ url: string; label: string; error: string } | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [payoutReference, setPayoutReference] = useState("");
  const [recordingPayout, setRecordingPayout] = useState(false);
  const [preflightingPayout, setPreflightingPayout] = useState(false);
  const [submittingPayout, setSubmittingPayout] = useState(false);
  const [reconcilingPayout, setReconcilingPayout] = useState(false);
  const [retryingFailedPayouts, setRetryingFailedPayouts] = useState(false);
  const [treasuryStatus, setTreasuryStatus] = useState<{ enabled: boolean; assigned: boolean } | null>(null);

  const run = runs.find((item) => item.id === runId) ?? runs[0];
  const organizationId = data.selectedOrganization.id;
  const payoutState = run ? derivePayrollPayoutState(data.auditEvents, run.id) : null;
  const bookkeeperMode = data.access?.role === "bookkeeper";
  const treasuryStatusEligible = ["owner", "admin", "bookkeeper", "payroll"].includes(data.access?.role ?? "");
  const canRecordManualPayout = treasuryStatus
    ? treasuryStatus.enabled ? treasuryStatus.assigned : data.access?.role === "owner"
    : data.access?.role === "owner";
  const canGenerateLiveBankFile = treasuryStatus
    ? treasuryStatus.enabled
      ? treasuryStatus.assigned
      : ["owner", "admin", "bookkeeper", "payroll"].includes(data.access?.role ?? "")
    : ["owner", "admin", "bookkeeper", "payroll"].includes(data.access?.role ?? "");

  useEffect(() => {
    if (!treasuryStatusEligible) {
      setTreasuryStatus({ enabled: false, assigned: false });
      return;
    }
    let cancelled = false;
    void fetch(`/api/treasury-controls?organizationId=${organizationId}&view=current-user`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (cancelled || !response.ok) return;
        setTreasuryStatus({
          enabled: Boolean(payload.policy?.enabled),
          assigned: Boolean(payload.currentUserAssigned),
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [organizationId, treasuryStatusEligible]);

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
      notify(`${label} generated and written to the audit trail.`, "info");
      await onRefresh();
    } catch {
      const error = `${label} could not be generated because the export service could not be reached.`;
      setExportFailure({ url, label, error });
      notify(error, "err");
    } finally {
      setExporting(null);
    }
  }

  async function recordPayoutCompletion() {
    if (!run) return;
    const reference = payoutReference.trim();
    if (reference.length < 4) {
      notify("Enter the bank confirmation or transaction reference first.", "err");
      return;
    }

    setRecordingPayout(true);
    try {
      const response = await fetch(`/api/payroll-runs/${run.id}/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "complete-manual",
          reference,
          confirmed: true,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(payload.error ?? "Payout completion could not be recorded.", "err");
        return;
      }
      notify(
        payload.alreadyRecorded
          ? "Payout completion was already recorded."
          : "Payout completion recorded in the audit trail.",
        "ok",
      );
      setPayoutReference("");
      await onRefresh();
    } catch {
      notify("Payout completion could not be recorded because the server could not be reached.", "err");
    } finally {
      setRecordingPayout(false);
    }
  }


  async function runPaymongoPreflight() {
    if (!run) return;
    setPreflightingPayout(true);
    try {
      const response = await fetch(`/api/payroll-runs/${run.id}/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "preflight" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(payload.error ?? "PayMongo preflight failed.", "err");
        await onRefresh();
        return;
      }
      notify(
        payload.ready
          ? payload.message ?? "PayMongo preflight passed without moving money."
          : payload.message ?? "PayMongo preflight found a funding or bank-mapping issue.",
        payload.ready ? "ok" : "err",
      );
      await onRefresh();
    } catch {
      notify("PayMongo preflight could not be reached.", "err");
    } finally {
      setPreflightingPayout(false);
    }
  }

  async function submitPaymongoPayout() {
    if (!run) return;
    const confirmed = window.confirm(
      `Submit ${money(run.netPay)} for ${run.employeeCount} employee(s) through PayMongo? This can move real money.`,
    );
    if (!confirmed) return;

    setSubmittingPayout(true);
    try {
      const response = await fetch(`/api/payroll-runs/${run.id}/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "disburse", confirm: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(payload.error ?? "PayMongo payout could not be submitted.", "err");
        await onRefresh();
        return;
      }
      notify(
        payload.completed
          ? "PayMongo reports every transfer settled."
          : `PayMongo batch ${payload.batchId ?? ""} submitted. Reconcile until every transfer settles.`,
        payload.completed ? "ok" : "info",
      );
      await onRefresh();
    } catch {
      notify("PayMongo payout could not be submitted because the server could not be reached.", "err");
    } finally {
      setSubmittingPayout(false);
    }
  }


  async function reconcilePaymongoPayout(action: "reconcile" | "retry-failed") {
    if (!run) return;
    const retry = action === "retry-failed";
    if (retry) setRetryingFailedPayouts(true);
    else setReconcilingPayout(true);

    try {
      const response = await fetch(`/api/payroll-runs/${run.id}/payout-reconciliation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          confirm: retry,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(payload.error ?? (retry ? "Failed payouts could not be retried." : "Payout status could not be refreshed."), "err");
        await onRefresh();
        return;
      }

      if (retry) {
        notify(payload.message ?? "Failed transfers were resubmitted without touching pending or settled payouts.", "ok");
      } else {
        const reconciliation = payload.reconciliation as {
          succeeded?: number;
          pending?: number;
          failed?: number;
          unknown?: number;
        } | undefined;
        notify(
          reconciliation
            ? `PayMongo checked: ${reconciliation.succeeded ?? 0} settled, ${reconciliation.pending ?? 0} pending, ${reconciliation.failed ?? 0} failed.`
            : "PayMongo payout status refreshed.",
          reconciliation?.failed ? "err" : reconciliation?.pending || reconciliation?.unknown ? "info" : "ok",
        );
      }
      await onRefresh();
    } catch {
      notify(retry ? "Failed payouts could not be retried because the server could not be reached." : "Payout status could not be refreshed because the server could not be reached.", "err");
    } finally {
      if (retry) setRetryingFailedPayouts(false);
      else setReconcilingPayout(false);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow={bookkeeperMode ? data.selectedOrganization.legalName + " · Bookkeeper" : "Exports"}
        title={bookkeeperMode ? "Close payroll." : "Files that leave a paper trail."}
        copy={
          bookkeeperMode
            ? "Reconcile payout, journal, statutory liabilities and filing evidence, then record the accounting close."
            : "Every export is generated by the API from stored payroll rows, tagged with its template version, and recorded as an audit event attributed to you."
        }
      />

      <div className="notice notice-blue">
        <Info size={15} className="i-blue" />
        <span>
          PayMongo is Linaw&apos;s primary payroll payout rail when the production wallet is connected. Bank files below are an
          optional fallback and stay fail-closed until their exact bank-provided template has passed UAT. Government worksheets
          remain draft-only until agency acceptance evidence is recorded. See <a className="link-button" href="/api/readiness">/api/readiness</a>.
        </span>
      </div>
      {treasuryStatus?.enabled && (
        <div className="notice notice-slate" data-treasury-separation-active>
          <ShieldCheck size={15} className="i-purple" />
          <span>
            Treasury separation is active. Live payout actions require an assigned treasury operator, and the person who released this payroll cannot also move or confirm its funds.
          </span>
        </div>
      )}
      {data.access?.companyWide && ["owner", "admin", "bookkeeper", "payroll"].includes(data.access?.role ?? "") && (
        <ManagedPayrollControlRoom data={data} run={run} notify={notify} />
      )}
      {exportFailure && (
        <div className="notice notice-red" data-recovery-state="export-failed" style={{ marginTop: 12 }}>
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

      {!run ? (
        <article className="card">
          <EmptyState icon={<FileSpreadsheet size={22} className="i-teal" />} title="No payroll runs to export">
            Bank files, journals and worksheets are all derived from a calculated run. Create and calculate one first.
          </EmptyState>
        </article>
      ) : (
        <>
          <article className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div>
                <div className="card-kicker">Source run</div>
                <h2>Which run are we exporting?</h2>
                <p>Bank, journal and worksheet exports all read this run&apos;s stored entries.</p>
              </div>
              <Status value={run.status} />
            </div>
            <div className="setting-form">
              <label>
                Payroll run
                <select value={run.id} onChange={(event) => setRunId(Number(event.target.value))}>
                  {runs.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.periodLabel} · {item.scopeLabel} · {item.status}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Pay date
                <input value={formatDate(run.payDate)} readOnly />
              </label>
            </div>
            <div className="run-stats" style={{ marginTop: 0 }}>
              <div>
                <span>Employees</span>
                <strong>{run.employeeCount}</strong>
              </div>
              <div>
                <span>Gross</span>
                <strong>{money(run.grossPay)}</strong>
              </div>
              <div>
                <span>Net to disburse</span>
                <strong className="green-number">{money(run.netPay)}</strong>
              </div>
            </div>
          </article>

          {bookkeeperMode && (
            <BookkeeperPayrollClose
              data={data}
              run={run}
              notify={notify}
              onRefresh={onRefresh}
              onExportJournal={() =>
                download("/api/payroll-runs/" + run.id + "/exports?kind=journal", "Journal CSV")
              }
            />
          )}

          {run.status === "Released" && payoutState && (
            <article className="card" data-payout-operations style={{ marginBottom: 16 }}>
              <div className="card-header">
                <div>
                  <div className="card-kicker">PAYOUT COMPLETION</div>
                  <h2>Close the loop after release</h2>
                  <p>Release, PayMongo preflight, submission and provider settlement are separate audited milestones. Bank files are optional fallback.</p>
                </div>
                <Status value={payoutState.payout.status === "completed" ? "Completed" : "In progress"} />
              </div>
              <div className="card-body" style={{ paddingTop: 0 }}>
                <div className="payout-steps">
                  <div className="payout-step done" data-payout-stage="released">
                    <span className="payout-step-icon"><Check size={13} /></span>
                    <div>
                      <strong>1. Payroll released</strong>
                      <p>The approved register is locked before any payout is submitted.</p>
                    </div>
                  </div>
                  <div
                    className={`payout-step ${payoutState.payout.method === "PayMongo" && payoutState.payout.status !== "awaiting-preflight" ? "done" : "current"}`}
                    data-payout-stage="paymongo-preflight"
                  >
                    <span className="payout-step-icon">
                      {payoutState.payout.method === "PayMongo" && payoutState.payout.status !== "awaiting-preflight"
                        ? <Check size={13} />
                        : <Clock3 size={13} />}
                    </span>
                    <div>
                      <strong>2. PayMongo preflight</strong>
                      <p>
                        {payoutState.payout.status === "awaiting-preflight"
                          ? payoutState.payout.label
                          : payoutState.payout.method === "PayMongo"
                            ? "Provider credentials, bank mappings and available wallet funding passed the no-money check."
                            : "PayMongo was not used for this payout; a validated bank-file fallback is available."}
                      </p>
                    </div>
                  </div>
                  <div
                    className={`payout-step ${payoutState.payout.status === "completed" ? "done" : payoutState.payout.status === "submitted" || payoutState.payout.status === "ready" ? "current" : "pending"}`}
                    data-payout-stage="completed"
                    data-payout-status={payoutState.payout.status}
                  >
                    <span className="payout-step-icon">
                      {payoutState.payout.status === "completed" ? <Check size={13} /> : <Clock3 size={13} />}
                    </span>
                    <div>
                      <strong>3. Provider settlement</strong>
                      <p>{payoutState.payout.label}</p>
                      {payoutState.payout.reference && (
                        <small>Reference: {payoutState.payout.reference}</small>
                      )}
                    </div>
                  </div>
                </div>

                {payoutState.reconciliation.provider !== "PayMongo" && payoutState.payout.method !== "bank-file" && (
                  <div className="payout-confirm" data-paymongo-primary-actions>
                    <div>
                      <strong>Primary payout: PayMongo</strong>
                      <p className="field-help">
                        Preflight is read-only. It checks the final released payroll, employee bank mappings and available wallet funds without creating a transfer.
                      </p>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        className="secondary-button"
                        disabled={preflightingPayout || submittingPayout}
                        onClick={() => void runPaymongoPreflight()}
                      >
                        <ShieldCheck size={14} />
                        {preflightingPayout ? "Checking PayMongo…" : "Run PayMongo preflight"}
                      </button>
                      {canRecordManualPayout && payoutState.payout.status === "ready" && payoutState.payout.method === "PayMongo" && (
                        <button
                          className="primary-button brand"
                          disabled={preflightingPayout || submittingPayout}
                          onClick={() => void submitPaymongoPayout()}
                        >
                          <Banknote size={14} />
                          {submittingPayout ? "Submitting payout…" : "Submit via PayMongo"}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {payoutState.reconciliation.provider === "PayMongo" && (
                  <div data-payout-reconciliation style={{ marginTop: 14, display: "grid", gap: 12 }}>
                    <div className="line-title" style={{ margin: 0 }}>
                      <div>
                        <strong>PayMongo reconciliation</strong>
                        <span>
                          {payoutState.reconciliation.checkedAt
                            ? `Last checked ${formatDate(payoutState.reconciliation.checkedAt)}`
                            : "Refresh provider status to confirm settlement"}
                        </span>
                      </div>
                      <Status
                        value={
                          payoutState.reconciliation.status === "settled"
                            ? "Settled"
                            : payoutState.reconciliation.status === "attention"
                              ? "Needs attention"
                              : payoutState.reconciliation.status === "pending"
                                ? "Pending"
                                : "Submitted"
                        }
                      />
                    </div>

                    <div className="run-stats" style={{ margin: 0 }}>
                      <div>
                        <span>Settled</span>
                        <strong className="green-number">{payoutState.reconciliation.succeeded}</strong>
                        <small>provider status: succeeded</small>
                      </div>
                      <div>
                        <span>Pending</span>
                        <strong>{payoutState.reconciliation.pending}</strong>
                        <small>never retried while pending</small>
                      </div>
                      <div>
                        <span>Failed</span>
                        <strong className={payoutState.reconciliation.failed ? "red-number" : undefined}>
                          {payoutState.reconciliation.failed}
                        </strong>
                        <small>eligible for failed-only retry</small>
                      </div>
                    </div>

                    {payoutState.reconciliation.settlementRegressed && (
                      <div className="notice notice-red" data-payout-settlement-regressed style={{ margin: 0 }}>
                        <AlertTriangle size={15} className="i-red" />
                        <span>
                          A verified PayMongo update changed a previously settled transfer to failed. Treat this as a returned or reversed payout until the bank/provider issue is reviewed.
                        </span>
                      </div>
                    )}

                    {payoutState.reconciliation.unknown > 0 && (
                      <div className="notice notice-amber" style={{ margin: 0 }}>
                        <AlertTriangle size={15} className="i-amber" />
                        <span>
                          PayMongo returned {payoutState.reconciliation.unknown} unrecognized transfer state(s). Linaw will not retry those transfers automatically.
                        </span>
                      </div>
                    )}

                    {canRecordManualPayout && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        className="secondary-button"
                        disabled={reconcilingPayout || retryingFailedPayouts}
                        onClick={() => void reconcilePaymongoPayout("reconcile")}
                      >
                        <Clock3 size={14} />
                        {reconcilingPayout ? "Checking PayMongo…" : "Refresh PayMongo status"}
                      </button>
                      <button
                        className="secondary-button"
                        disabled={Boolean(exporting)}
                        onClick={() => void download(
                          `/api/payroll-runs/${run.id}/payout-reconciliation?format=csv`,
                          "Payout reconciliation CSV",
                        )}
                      >
                        <Download size={14} /> Reconciliation CSV
                      </button>
                      {payoutState.reconciliation.canRetryFailed && (
                        <button
                          className="primary-button brand"
                          disabled={reconcilingPayout || retryingFailedPayouts}
                          onClick={() => void reconcilePaymongoPayout("retry-failed")}
                        >
                          <AlertTriangle size={14} />
                          {retryingFailedPayouts
                            ? "Retrying failed only…"
                            : `Retry ${payoutState.reconciliation.failed} failed only`}
                        </button>
                      )}
                    </div>}

                    {payoutState.reconciliation.transfers.length > 0 && (
                      <div className="audit-list" data-payout-transfer-list>
                        {payoutState.reconciliation.transfers.map((transfer) => (
                          <div className="audit-row" key={transfer.referenceNumber}>
                            <span
                              className={`audit-dot ${transfer.status === "succeeded" ? "dot-green" : transfer.status === "failed" ? "dot-red" : ""}`}
                              aria-hidden
                            />
                            <div style={{ minWidth: 0 }}>
                              <strong>{transfer.employeeNo}</strong>
                              <p>
                                {money(transfer.amountCents / 100)} · {transfer.referenceNumber}
                                {transfer.providerReferenceNumber ? ` · Provider ref ${transfer.providerReferenceNumber}` : ""}
                              </p>
                              {(transfer.providerErrorCode || transfer.providerError) && (
                                <small className="error-text">
                                  {transfer.providerErrorCode ? `${transfer.providerErrorCode}: ` : ""}
                                  {transfer.providerError ?? "Provider reported a transfer failure."}
                                </small>
                              )}
                            </div>
                            <Status
                              value={
                                transfer.status === "succeeded"
                                  ? "Settled"
                                  : transfer.status === "failed"
                                    ? "Failed"
                                    : transfer.status === "pending"
                                      ? "Pending"
                                      : "Check"
                              }
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {canRecordManualPayout
                  && payoutState.bankFile.status === "generated"
                  && payoutState.payout.status !== "completed"
                  && payoutState.reconciliation.provider !== "PayMongo" && (
                  <div className="payout-confirm">
                    <label className="field">
                      <span>Bank / payment confirmation reference</span>
                      <input
                        value={payoutReference}
                        onChange={(event) => setPayoutReference(event.target.value)}
                        placeholder="e.g. BDO batch 004821"
                        maxLength={120}
                      />
                    </label>
                    <div>
                      <button
                        className="primary-button brand"
                        disabled={recordingPayout || payoutReference.trim().length < 4}
                        onClick={() => void recordPayoutCompletion()}
                      >
                        {recordingPayout ? "Recording…" : "Mark payout complete"}
                      </button>
                      <p className="field-help">
                        Use this only after the bank or payment provider shows the payout as completed. Linaw records your confirmation; it does not independently verify the bank transfer.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </article>
          )}

          <section data-filing-evidence-section>
            {EVIDENCE_FORMS.map((item) => (
              <FilingEvidencePanel
                key={`${organizationId}-${run.id}-${item.agency}-${item.form}`}
                organizationId={organizationId}
                agency={item.agency}
                form={item.form}
                run={{ id: run.id, periodLabel: run.periodLabel, periodEnd: run.periodEnd }}
                notify={notify}
                onRefresh={onRefresh}
              />
            ))}
          </section>

          <Bir1601cRemittancePanel
            organizationId={organizationId}
            notify={notify}
          />

          <section className="integration-grid">
            <article className="export-card">
              <span className="inline-icon blue" aria-hidden>
                <Building2 size={16} />
              </span>
              <div>
                <h3>
                  Bank-file fallback <Status value="Optional" />
                </h3>
                <p>
                  Use only when PayMongo is unavailable or the employer explicitly uses its corporate-bank upload flow.
                  Proprietary formats require the exact bank-provided mapping and recorded portal UAT; Linaw will not guess one.
                </p>
                <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                  <label className="field">
                    <span>Template</span>
                    <select value={template} onChange={(event) => setTemplate(event.target.value)}>
                      {(data.templates.length ? data.templates : [{ id: 0, name: "BDO DAT", version: "", format: "" }]).map(
                        (item) => (
                          <option key={item.id} value={item.name}>
                            {item.name}
                            {item.version ? ` · ${item.version}` : ""}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <Segmented
                    label="Bank export mode"
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: "dry", label: "Validate" },
                      { value: "live", label: "Generate file" },
                    ]}
                  />
                  <button
                    className={mode === "live" ? "primary-button" : "secondary-button"}
                    disabled={mode === "live" && !canGenerateLiveBankFile}
                    title={mode === "live" && !canGenerateLiveBankFile ? "An assigned treasury operator must generate the final bank file when treasury separation is enabled." : undefined}
                    onClick={() =>
                      void download(
                        `/api/payroll-runs/${run.id}/exports?kind=bank&template=${encodeURIComponent(template)}&dryRun=${mode === "dry"}`,
                        mode === "dry" ? `${template} validation` : `${template} disbursement file`,
                      )
                    }
                  >
                    <Download size={14} className="i-teal" /> {mode === "dry" ? "Run validation" : `Generate ${template}`}
                  </button>
                </div>
              </div>
            </article>

            <article className="export-card">
              <span className="inline-icon purple" aria-hidden>
                <BookOpen size={16} />
              </span>
              <div>
                <h3>
                  Accounting journal <Status value="Ready" />
                </h3>
                <p>Journal CSV for Xero and QuickBooks Online, balanced against this run&apos;s gross, deductions and net.</p>
                <button
                  className="secondary-button"
                  style={{ marginTop: 12 }}
                  onClick={() => void download(`/api/payroll-runs/${run.id}/exports?kind=journal`, "Journal CSV")}
                >
                  <Download size={14} className="i-teal" /> Journal CSV
                </button>
              </div>
            </article>

            <article className="export-card">
              <span className="inline-icon amber" aria-hidden>
                <ShieldCheck size={16} />
              </span>
              <div>
                <h3>
                  Government worksheets <Status value="Draft only" />
                </h3>
                <p>
                  Computed from the same rule engine as payroll, but <strong>not</strong> byte-validated against the
                  agencies&apos; own import tools. Every file is labelled DRAFT.
                </p>
                <div className="worksheet-list" style={{ padding: "12px 0 0" }}>
                  {GOVERNMENT_DRAFTS.map((item) => (
                    <div className="leave-request" key={item.template} style={{ padding: "10px 12px" }}>
                      <div>
                        <strong>{item.template}</strong>
                        <p>{item.detail}</p>
                      </div>
                      <button
                        className="secondary-button"
                        style={{ height: 28, fontSize: 11 }}
                        onClick={() =>
                      void download(
                            `/api/payroll-runs/${run.id}/exports?kind=government&template=${encodeURIComponent(item.kind)}`,
                            `${item.template} draft`,
                          )
                        }
                      >
                        <Download size={13} className="i-teal" /> Draft
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </article>

            <article className="export-card">
              <span className="inline-icon green" aria-hidden>
                <Banknote size={16} />
              </span>
              <div>
                <h3>Payslip PDFs</h3>
                <p>
                  One PDF per released entry, written by the built-in generator with no PDF dependency. Available once the
                  run is released.
                </p>
                <button
                  className="secondary-button"
                  style={{ marginTop: 12 }}
                  disabled={run.status !== "Released"}
                  onClick={() => void download(`/api/payroll-runs/${run.id}/exports?kind=payslip`, "Payslip index")}
                >
                  <Download size={14} className="i-teal" /> List payslips
                </button>
              </div>
            </article>

            <article className="export-card">
              <span className="inline-icon slate" aria-hidden>
                <Users size={16} />
              </span>
              <div>
                <h3>Employee roster</h3>
                <p>The full directory as CSV, the same column set the bulk importer accepts back.</p>
                <button
                  className="secondary-button"
                  style={{ marginTop: 12 }}
                  onClick={() => void download(`/api/exports?organizationId=${organizationId}&kind=employees`, "Employee roster CSV")}
                >
                  <Download size={14} className="i-teal" /> employees.csv
                </button>
              </div>
            </article>

            <article className="export-card">
              <span className="inline-icon slate" aria-hidden>
                <Database size={16} />
              </span>
              <div>
                <h3>Full company export</h3>
                <p>
                  Data-portability JSON covering the organization, people, runs and audit events, the Data Privacy Act
                  portability path.
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button
                    className="secondary-button"
                    onClick={() => void download(`/api/exports?organizationId=${organizationId}&kind=all`, "Full JSON export")}
                  >
                    <Download size={14} className="i-teal" /> JSON
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => void download(`/api/exports?organizationId=${organizationId}&kind=audit`, "Audit trail CSV")}
                  >
                    <Download size={14} className="i-teal" /> Audit CSV
                  </button>
                </div>
              </div>
            </article>
          </section>
        </>
      )}
    </>
  );
}
