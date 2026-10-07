"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Check,
  Clock3,
  Download,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { derivePayrollPayoutState } from "@/lib/payroll-payout-state";
import type { DashboardData, Notify } from "./types";
import { EmptyState, PageHeading, Status, formatDateTime, money } from "./ui";

export function PayoutControlCenter({
  data,
  notify,
  onRefresh,
  onPage,
}: {
  data: DashboardData;
  notify: Notify;
  onRefresh: () => Promise<void>;
  onPage: (page: string) => void;
}) {
  const releasedRuns = useMemo(
    () => data.payrollRuns.filter((run) => run.status === "Released"),
    [data.payrollRuns],
  );
  const [runId, setRunId] = useState<number | undefined>(releasedRuns[0]?.id);
  const [busy, setBusy] = useState<"preflight" | "submit" | "reconcile" | "retry" | null>(null);
  const run = releasedRuns.find((item) => item.id === runId) ?? releasedRuns[0];
  const state = run ? derivePayrollPayoutState(data.auditEvents, run.id) : null;
  const role = data.access?.role ?? data.user?.role ?? "";
  const canPreflight = ["owner", "admin", "bookkeeper", "payroll"].includes(role);
  const canMoveMoney = role === "owner";
  const canReconcile = role === "owner";

  async function postExport(mode: "preflight" | "disburse") {
    if (!run) return;
    if (mode === "disburse") {
      const confirmed = window.confirm(
        `Submit ${money(run.netPay)} for ${run.employeeCount} employee(s) through PayMongo? This can move real money.`,
      );
      if (!confirmed) return;
    }
    setBusy(mode === "preflight" ? "preflight" : "submit");
    try {
      const response = await fetch(`/api/payroll-runs/${run.id}/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "preflight" ? { mode } : { mode, confirm: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(payload.error ?? "Payout action could not be completed.", "err");
        return;
      }
      notify(
        mode === "preflight"
          ? payload.message ?? "Payout preflight completed."
          : payload.completed
            ? "Every payout transfer settled."
            : `Payout batch ${payload.batchId ?? ""} submitted. Reconcile until variance is zero.`,
        payload.ready === false ? "err" : payload.completed ? "ok" : "info",
      );
      await onRefresh();
    } catch {
      notify("The payout service could not be reached.", "err");
    } finally {
      setBusy(null);
    }
  }

  async function reconcile(action: "reconcile" | "retry-failed") {
    if (!run) return;
    const retry = action === "retry-failed";
    if (retry) {
      const confirmed = window.confirm(
        "Retry failed transfers only? Pending and succeeded transfers will not be resent.",
      );
      if (!confirmed) return;
    }
    setBusy(retry ? "retry" : "reconcile");
    try {
      const response = await fetch(`/api/payroll-runs/${run.id}/payout-reconciliation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirm: retry }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(payload.error ?? "Payout reconciliation failed.", "err");
        return;
      }
      notify(
        retry
          ? payload.message ?? "Failed transfers were resubmitted."
          : "Provider status refreshed and settlement totals reconciled.",
        "ok",
      );
      await onRefresh();
    } catch {
      notify("The payout reconciliation service could not be reached.", "err");
    } finally {
      setBusy(null);
    }
  }

  async function downloadReconciliation() {
    if (!run) return;
    const response = await fetch(`/api/payroll-runs/${run.id}/payout-reconciliation?format=csv`, { cache: "no-store" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      notify(payload.error ?? "Reconciliation CSV is not available.", "err");
      return;
    }
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `payroll-${run.id}-payout-reconciliation.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
  }

  if (!run || !state) {
    return (
      <>
        <PageHeading
          eyebrow="PAYOUTS"
          title="Payroll-to-bank control center."
          copy="Release a payroll run first. Payout operations only work from the exact locked employee net-pay register."
        />
        <article className="card">
          <EmptyState icon={<WalletCards size={22} />} title="No released payroll is ready for payout">
            Complete checker approval and release in Payroll before moving money.
          </EmptyState>
        </article>
      </>
    );
  }

  const expected = state.reconciliation.provider === "PayMongo"
    ? state.reconciliation.expectedAmountCents / 100
    : Number(run.netPay);
  const manuallyConfirmedBankFile =
    state.payout.method === "bank-file" && state.payout.status === "completed";
  const settled = state.reconciliation.provider === "PayMongo"
    ? state.reconciliation.settledAmountCents / 100
    : manuallyConfirmedBankFile
      ? Number(run.netPay)
      : 0;
  const pending = state.reconciliation.provider === "PayMongo"
    ? state.reconciliation.pendingAmountCents / 100
    : 0;
  const failed = state.reconciliation.failedAmountCents / 100;
  const variance = state.reconciliation.provider === "PayMongo"
    ? state.reconciliation.settlementVarianceCents / 100
    : manuallyConfirmedBankFile
      ? 0
      : Number(run.netPay);
  const employeeByNo = new Map(data.employees.map((employee) => [employee.employeeNo, employee]));

  return (
    <>
      <PageHeading
        eyebrow={data.selectedOrganization.legalName + " · PAYOUTS"}
        title="From released payroll to settled pesos."
        copy="Preflight funding and bank mappings, submit the approved payout, reconcile every employee transfer, and keep failed-only recovery separate from pending money."
        actions={
          <button className="secondary-button" onClick={() => onPage("Exports")}>
            <Download size={14} /> Bank-file fallback
          </button>
        }
      />

      <article className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">RELEASED PAYROLL</div>
            <h2>{run.periodLabel}</h2>
            <p>Only released runs can enter payout operations.</p>
          </div>
          <Status value={state.payout.status === "completed" ? "Settled" : state.payout.status === "submitted" ? "In progress" : "Ready"} />
        </div>
        <div className="setting-form">
          <label>
            Payroll run
            <select value={run.id} onChange={(event) => setRunId(Number(event.target.value))}>
              {releasedRuns.map((item) => (
                <option key={item.id} value={item.id}>{item.periodLabel} · {item.employeeCount} employees</option>
              ))}
            </select>
          </label>
          <label>
            Payout method
            <input readOnly value={state.payout.method === "bank-file" ? "Validated bank-file fallback" : "PayMongo · PESONet / InstaPay"} />
          </label>
        </div>

        <div className="run-stats" style={{ marginTop: 0 }}>
          <div>
            <span>Released net payroll</span>
            <strong>{money(expected)}</strong>
            <small>{run.employeeCount} employee(s)</small>
          </div>
          <div>
            <span>Settled</span>
            <strong className="green-number">{money(settled)}</strong>
            <small>{state.reconciliation.succeeded} succeeded</small>
          </div>
          <div>
            <span>Pending</span>
            <strong>{money(pending)}</strong>
            <small>{state.reconciliation.pending} transfer(s)</small>
          </div>
          <div>
            <span>Failed</span>
            <strong className={failed > 0 ? "red-number" : undefined}>{money(failed)}</strong>
            <small>{state.reconciliation.failed} retryable</small>
          </div>
          <div>
            <span>Settlement variance</span>
            <strong className={variance === 0 ? "green-number" : "red-number"}>{money(variance)}</strong>
            <small>{variance === 0 ? "released payroll fully settled" : "not yet settled"}</small>
          </div>
        </div>
      </article>

      <article className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">CONTROL SEQUENCE</div>
            <h2>Preflight → submit → reconcile</h2>
            <p>Money-moving submission remains Owner-only and MFA-protected on the server.</p>
          </div>
          <ShieldCheck size={20} />
        </div>

        <div className="payout-steps">
          <div className="payout-step done">
            <span className="payout-step-icon"><Check size={13} /></span>
            <div>
              <strong>1. Payroll released</strong>
              <p>{money(run.netPay)} is locked as the payout source of truth.</p>
            </div>
          </div>
          <div className={`payout-step ${state.payout.status === "awaiting-preflight" ? "current" : "done"}`}>
            <span className="payout-step-icon">{state.payout.status === "awaiting-preflight" ? <Clock3 size={13} /> : <Check size={13} />}</span>
            <div>
              <strong>2. No-money preflight</strong>
              <p>Validates receiving institutions, employee bank mappings and available wallet funds.</p>
            </div>
          </div>
          <div className={`payout-step ${state.payout.status === "submitted" ? "current" : state.payout.status === "completed" ? "done" : "pending"}`}>
            <span className="payout-step-icon">{state.payout.status === "completed" ? <Check size={13} /> : <Clock3 size={13} />}</span>
            <div>
              <strong>3. Provider settlement</strong>
              <p>{state.payout.label}</p>
              {state.reconciliation.checkedAt && <small>Last checked {formatDateTime(state.reconciliation.checkedAt)}</small>}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
          {canPreflight && state.reconciliation.provider !== "PayMongo" && (
            <button className="secondary-button" disabled={busy !== null} onClick={() => void postExport("preflight")}>
              <ShieldCheck size={14} /> {busy === "preflight" ? "Checking…" : "Run preflight"}
            </button>
          )}
          {canMoveMoney && state.payout.status === "ready" && state.payout.method === "PayMongo" && (
            <button className="primary-button brand" disabled={busy !== null} onClick={() => void postExport("disburse")}>
              <Banknote size={14} /> {busy === "submit" ? "Submitting…" : "Submit payout"}
            </button>
          )}
          {canReconcile && state.reconciliation.provider === "PayMongo" && state.reconciliation.status !== "settled" && (
            <button className="secondary-button" disabled={busy !== null} onClick={() => void reconcile("reconcile")}>
              <RefreshCw size={14} /> {busy === "reconcile" ? "Reconciling…" : "Refresh settlement"}
            </button>
          )}
          {canReconcile && state.reconciliation.canRetryFailed && (
            <button className="primary-button brand" disabled={busy !== null} onClick={() => void reconcile("retry-failed")}>
              <AlertTriangle size={14} /> {busy === "retry" ? "Retrying failed…" : `Retry ${state.reconciliation.failed} failed only`}
            </button>
          )}
          {state.reconciliation.provider === "PayMongo" && (
            <button className="secondary-button" onClick={() => void downloadReconciliation()}>
              <Download size={14} /> Reconciliation CSV
            </button>
          )}
        </div>
      </article>

      {state.reconciliation.settlementRegressed && (
        <div className="notice notice-red" style={{ marginBottom: 16 }}>
          <AlertTriangle size={15} />
          <span>A previously settled transfer later reported failure. Treat it as returned/reversed until provider review is complete.</span>
        </div>
      )}

      <article className="card">
        <div className="card-header">
          <div>
            <div className="card-kicker">EMPLOYEE SETTLEMENT</div>
            <h2>Every peso by employee</h2>
            <p>Pending transfers are never retried. Only explicit failures become retryable.</p>
          </div>
          <Status value={state.reconciliation.status === "settled" ? "Settled" : state.reconciliation.provider ? "Open" : "Not submitted"} />
        </div>

        {state.reconciliation.transfers.length === 0 ? (
          <EmptyState
            icon={<WalletCards size={22} />}
            title={manuallyConfirmedBankFile ? "Bank-file payout confirmed without employee-level provider statuses" : "No provider transfers yet"}
          >
            {manuallyConfirmedBankFile
              ? "The corporate-bank confirmation closes the payout at run level. Employee-level settlement remains unverified unless the bank supplies a result file that can be reconciled."
              : "Run the no-money preflight first. Once submitted, each employee transfer appears here with its provider status."}
          </EmptyState>
        ) : (
          <div className="audit-list">
            {state.reconciliation.transfers.map((transfer) => {
              const employee = employeeByNo.get(transfer.employeeNo);
              const name = employee ? `${employee.firstName} ${employee.lastName}` : transfer.employeeNo;
              return (
                <div className="audit-row" key={transfer.referenceNumber}>
                  <span
                    className={`audit-dot ${transfer.status === "succeeded" ? "dot-green" : transfer.status === "failed" ? "dot-red" : ""}`}
                    aria-hidden
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <strong>{name} · {transfer.employeeNo}</strong>
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
                  <Status value={transfer.status === "succeeded" ? "Settled" : transfer.status === "failed" ? "Failed" : transfer.status === "pending" ? "Pending" : "Check"} />
                </div>
              );
            })}
          </div>
        )}
      </article>
    </>
  );
}
