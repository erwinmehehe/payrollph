"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import type { Notify } from "./types";
import { Status, money } from "./ui";

import { parseBir1601cRead, type Batch } from "@/lib/bir-1601c-read";

function previousMonth() {
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return month.toISOString().slice(0, 7);
}

export function Bir1601cRemittancePanel(props: {
  organizationId: number;
  notify: Notify;
}) {
  // Employer scope is tenant-private. Remount on a new organizationId so no
  // batch, payment or variance state from the previous employer can render.
  return <Bir1601cRemittancePanelContent key={props.organizationId} {...props} />;
}

function Bir1601cRemittancePanelContent({
  organizationId,
  notify,
}: {
  organizationId: number;
  notify: Notify;
}) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [readState, setReadState] = useState<"loading" | "ready" | "error">("loading");
  const [readError, setReadError] = useState("");
  const [month, setMonth] = useState(previousMonth());
  const [filingChannel, setFilingChannel] = useState<"non_efps" | "efps">("non_efps");
  const [efpsGroup, setEfpsGroup] = useState("A");
  const [busy, setBusy] = useState<string | null>(null);
  const [paymentBatchId, setPaymentBatchId] = useState<number | null>(null);
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentVarianceNote, setPaymentVarianceNote] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setReadState("loading");
    setReadError("");
    setBatches([]);
    setPaymentBatchId(null);
    try {
      const response = await fetch(
        `/api/compliance/bir-1601c-remittances?organizationId=${organizationId}`,
        { cache: "no-store", signal },
      );
      const body = await response.json().catch(() => ({}));
      if (signal?.aborted) return;
      if (!response.ok) throw new Error(body.error ?? "Could not load BIR 1601-C reconciliation.");
      const verified = parseBir1601cRead(body, organizationId);
      if (verified === null) throw new Error("BIR 1601-C evidence was incomplete or belonged to another employer.");
      setBatches(verified);
      setReadState("ready");
    } catch (error) {
      if (signal?.aborted) return;
      const message = error instanceof Error ? error.message : "BIR 1601-C evidence could not be verified.";
      setBatches([]);
      setReadError(message);
      setReadState("error");
      throw error;
    }
  }, [organizationId]);

  useEffect(() => {
    const controller = new AbortController();
    // The request runs after effect setup, never in its synchronous phase.
    // Strict Mode cleanup can cancel this scheduled read before it starts.
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      void load(controller.signal).catch((error) => {
        if (controller.signal.aborted) return;
        notify(
          error instanceof Error ? error.message : "Could not load BIR 1601-C reconciliation.",
          "err",
        );
      });
    });
    return () => controller.abort();
  }, [load, notify]);

  const monthBatch = useMemo(
    () => batches.find((batch) => batch.applicableMonth === month) ?? null,
    [batches, month],
  );

  async function mutate(action: string, payload: Record<string, unknown>, success: string) {
    if (readState !== "ready" || busy !== null) return false;
    setBusy(action);
    let submitted = false;
    try {
      const response = await fetch("/api/compliance/bir-1601c-remittances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, action, ...payload }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "BIR 1601-C reconciliation action failed.");
      submitted = true;
      await load();
      notify(success, "ok");
      return true;
    } catch (error) {
      notify(submitted
        ? "The action may have succeeded, but the updated BIR evidence is unverified. Check the record before retrying."
        : error instanceof Error ? error.message : "BIR 1601-C reconciliation action failed.", "err");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function createBatch() {
    await mutate("create_batch", {
      applicableMonth: month,
      filingChannel,
      efpsGroup: filingChannel === "efps" ? efpsGroup : null,
    }, "BIR 1601-C payroll withholding snapshot created.");
  }

  async function recordPayment(batch: Batch) {
    const expected = Math.max(0, Number(batch.expectedTaxWithheld));
    const paid = amountPaid === "" ? expected : Number(amountPaid);
    const ok = await mutate("record_payment", {
      batchId: batch.id,
      amountPaid: paid,
      paymentReference,
      paymentVarianceNote,
    }, "BIR 1601-C filing and payment reconciliation recorded.");
    if (ok) {
      setPaymentBatchId(null);
      setAmountPaid("");
      setPaymentReference("");
      setPaymentVarianceNote("");
    }
  }

  if (readState !== "ready") {
    return (
      <article className="card" data-bir-1601c-remittance style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">BIR 1601-C RECONCILIATION</div>
            <h2>{readState === "loading" ? "Verifying BIR 1601-C evidence…" : "BIR controls unavailable"}</h2>
            <p role="status">{readState === "error" ? readError : "Reconciliation actions are locked until the employer's complete evidence is verified."}</p>
          </div>
          {readState === "error" && (
            <button className="secondary-button" disabled={busy !== null}
              onClick={() => void load().catch((error) =>
                notify(error instanceof Error ? error.message : "BIR evidence could not be verified.", "err"))}>
              <RefreshCw size={14} /> Retry
            </button>
          )}
        </div>
      </article>
    );
  }

  return (
    <article className="card" data-bir-1601c-remittance style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">BIR 1601-C RECONCILIATION</div>
          <h2>Match payroll withholding, the filed return, and the BIR payment.</h2>
          <p>
            A clean payroll tax calculation is not enough. This closes the monthly loop from released-payroll withholding to accepted 1601-C filing evidence and payment confirmation.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void load().catch((error) => notify(error instanceof Error ? error.message : "BIR evidence could not be verified.", "err"))} disabled={busy !== null}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="card-body" style={{ paddingTop: 0, display: "grid", gap: 14 }}>
        <div className="notice notice-blue" style={{ margin: 0 }}>
          <ShieldCheck size={15} />
          <span>
            For non-eFPS filers, the normal monthly filing/payment control date is the 10th of the following month, except December which uses January 15. For eFPS, filing is staggered by Group E to A and payment is controlled to the 15th. Published BIR calendar extensions remain external to this nominal control.
          </span>
        </div>

        <div className="setting-form">
          <label>Applicable month
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
          <label>Filing channel
            <select value={filingChannel} onChange={(event) => setFilingChannel(event.target.value as "non_efps" | "efps")}>
              <option value="non_efps">eBIRForms / non-eFPS</option>
              <option value="efps">eFPS</option>
            </select>
          </label>
          {filingChannel === "efps" && (
            <label>eFPS filing group
              <select value={efpsGroup} onChange={(event) => setEfpsGroup(event.target.value)}>
                {["A", "B", "C", "D", "E"].map((group) => (
                  <option value={group} key={group}>Group {group}</option>
                ))}
              </select>
            </label>
          )}
          <div style={{ alignSelf: "end" }}>
            <button className="primary-button brand" disabled={busy !== null || Boolean(monthBatch)} onClick={() => void createBatch()}>
              {monthBatch ? "Month opened" : "Open 1601-C reconciliation"}
            </button>
          </div>
        </div>

        {monthBatch && (
          <section className="leave-request" style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <strong>BIR 1601-C · {monthBatch.applicableMonth}</strong>
                <p style={{ margin: "3px 0 0" }}>
                  Filing due {monthBatch.filingDueDate} · payment due {monthBatch.paymentDueDate} · {monthBatch.payrollRunCount} released payroll run{monthBatch.payrollRunCount === 1 ? "" : "s"}
                </p>
              </div>
              <Status value={monthBatch.displayStatus === "overdue" ? "Overdue" : monthBatch.status === "reconciled" ? "Reconciled" : "Open"} />
            </div>

            <div className="run-stats" style={{ margin: 0 }}>
              <div><span>Employees</span><strong>{monthBatch.employeeCount}</strong></div>
              <div><span>Payroll withholding</span><strong>{money(monthBatch.expectedTaxWithheld)}</strong></div>
              <div><span>Filing cross-check</span><strong>{monthBatch.filingCheck.matched ? "Matched" : "Not ready"}</strong></div>
            </div>

            <div className={monthBatch.filingCheck.matched ? "notice notice-green" : monthBatch.filingCheck.state === "mismatch" ? "notice notice-red" : "notice notice-amber"} style={{ margin: 0 }}>
              {monthBatch.filingCheck.matched ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              <span>
                <strong>{monthBatch.filingCheck.matched ? "Accepted 1601-C matches payroll." : "1601-C filing evidence needs attention."}</strong>{" "}
                {monthBatch.filingCheck.message}
                {monthBatch.filingCheck.comparison?.totalDifference != null && !monthBatch.filingCheck.comparison.totalMatches
                  ? ` Difference: ${money(monthBatch.filingCheck.comparison.totalDifference)}.`
                  : ""}
              </span>
            </div>

            {monthBatch.status === "open" && (
              <>
                <button
                  className="primary-button brand"
                  disabled={!monthBatch.filingCheck.matched}
                  onClick={() => {
                    setPaymentBatchId(paymentBatchId === monthBatch.id ? null : monthBatch.id);
                    setAmountPaid(String(Math.max(0, Number(monthBatch.expectedTaxWithheld))));
                  }}
                >
                  Record BIR payment / no-payment-due close
                </button>

                {paymentBatchId === monthBatch.id && (
                  <div className="setting-form">
                    <label>Amount paid
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={amountPaid}
                        onChange={(event) => setAmountPaid(event.target.value)}
                      />
                    </label>
                    <label>BIR payment confirmation / reference
                      <input
                        value={paymentReference}
                        onChange={(event) => setPaymentReference(event.target.value)}
                        placeholder={Number(amountPaid || 0) > 0 ? "eFPS / eBIRForms payment confirmation" : "Optional when no tax payment is due"}
                      />
                    </label>
                    <label>Surcharge / interest / variance note
                      <input
                        value={paymentVarianceNote}
                        onChange={(event) => setPaymentVarianceNote(event.target.value)}
                        placeholder="Required only if amount paid exceeds the payroll tax liability"
                      />
                    </label>
                    <div style={{ alignSelf: "end" }}>
                      <button className="primary-button brand" disabled={busy !== null} onClick={() => void recordPayment(monthBatch)}>
                        Reconcile 1601-C
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {monthBatch.status === "reconciled" && (
              <div className="notice notice-green" style={{ margin: 0 }}>
                <CheckCircle2 size={15} />
                <span>
                  <strong>Monthly withholding closed.</strong>{" "}
                  Filing {monthBatch.filingReference ? `reference ${monthBatch.filingReference}` : "evidence"} and BIR payment {monthBatch.amountPaid == null ? "" : money(monthBatch.amountPaid)} are locked to this payroll snapshot.
                </span>
              </div>
            )}
          </section>
        )}
      </div>
    </article>
  );
}
