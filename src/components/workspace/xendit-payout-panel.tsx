"use client";

import { useEffect, useState } from "react";

type Ledger = {
  batchId: number;
  status: string;
  totals: { amountCents: number; transferCount: number };
  counts: { prepared: number; submitted: number; succeeded: number;
    failed: number; reversed: number; unknown: number };
  rows: Array<{ employeeNo: string; referenceNumber: string; amountCents: number;
    providerPayoutId: string | null; status: string }>;
};
type Status = {
  provider: "xendit";
  selectedProvider: "xendit" | "paymongo";
  claimedProvider: "xendit" | "paymongo" | null;
  readiness: { ready: boolean; blockers: string[] };
  ledger: Ledger | null;
};

export function XenditPayoutPanel({
  runId, onRefresh, onPaymongoPreflight, onPaymongoSubmit,
  canSubmitPaymongo, allowPaymongoActions, paymongoPreflighting, paymongoSubmitting,
}: {
  runId: number;
  onRefresh: () => Promise<void>;
  onPaymongoPreflight: () => Promise<void>;
  onPaymongoSubmit: () => Promise<void>;
  canSubmitPaymongo: boolean;
  allowPaymongoActions: boolean;
  paymongoPreflighting: boolean;
  paymongoSubmitting: boolean;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [payoutId, setPayoutId] = useState("");
  const [reconcileCursor, setReconcileCursor] = useState(0);

  async function refresh() {
    const response = await fetch(`/api/payroll-runs/${runId}/xendit-payout`,
      { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "Xendit status unavailable.");
    setStatus(data as Status);
  }
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void fetch(`/api/payroll-runs/${runId}/xendit-payout`,
      { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (active && response.ok) setStatus(data as Status);
      })
      .catch(() => {});
    return () => { active = false; controller.abort(); };
  }, [runId]);

  async function command(action: string, extras: Record<string, unknown> = {}) {
    const response = await fetch(`/api/payroll-runs/${runId}/xendit-payout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extras }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Xendit operation rejected.");
    return payload;
  }

  async function preflight() {
    setBusy("preflight");
    setMessage("");
    try {
      const result = await command("preflight");
      setMessage(result.ready
        ? `Preflight passed for ${result.transferCount} employees. No money moved.`
        : `Xendit remains blocked: ${(result.blockers ?? []).join(" ")}`);
      await refresh(); await onRefresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Preflight failed."); }
    finally { setBusy(""); }
  }

  async function submit() {
    if (!window.confirm("Send released payroll through Xendit? This can move real money. Each employee transfer is irreversible once settled.")) return;
    setBusy("submit");
    setMessage("");
    let total = 0;
    try {
      for (let pass = 0; pass < 15; pass += 1) {
        const result = await command("submit", { confirm: true });
        total += Array.isArray(result.submitted) ? result.submitted.length : 0;
        setMessage(`Xendit accepted ${total} transfer(s) for processing. Check settlement status before closing payroll.`);
        if (result.complete || (result.ledger?.counts?.prepared ?? 0) === 0) break;
      }
      await refresh(); await onRefresh();
    } catch (error) {
      setMessage((error instanceof Error ? error.message : "Xendit submission interrupted.")
        + " Do not resend an uncertain payout. Reconcile it against Xendit first.");
      await refresh().catch(() => {});
      await onRefresh();
    } finally { setBusy(""); }
  }

  async function reconcile() {
    setBusy("reconcile");
    setMessage("");
    try {
      let checked = 0;
      let cursor = reconcileCursor;
      let hasMore = false;
      for (let page = 0; page < 10; page += 1) {
        const result = await command("reconcile", { cursor });
        checked += Number(result.checked ?? 0);
        hasMore = result.hasMore === true;
        if (!hasMore) {
          cursor = 0;
          setReconcileCursor(0);
          break;
        }
        const next = Number(result.nextCursor);
        if (!Number.isSafeInteger(next) || next <= cursor) {
          throw new Error("Invalid reconciliation continuation; no transfers were retried.");
        }
        cursor = next;
        setReconcileCursor(cursor);
      }
      setMessage(`Checked ${checked} Xendit transfer(s). ${hasMore ? "More records remain; click Refresh again to continue from the saved position." : "All pages checked."} Reversed, failed and uncertain transfers require review.`);
      await refresh(); await onRefresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Reconciliation failed."); }
    finally { setBusy(""); }
  }

  async function resolveUnknown() {
    if (!referenceNumber.trim() || !payoutId.trim()) return;
    if (!window.confirm("Have you independently checked this Xendit payout ID in your account? This only links and verifies an existing transfer; it does not send salary.")) return;
    setBusy("resolve");
    setMessage("");
    try {
      await command("resolve-unknown", {
        referenceNumber: referenceNumber.trim(), payoutId: payoutId.trim(), confirm: true,
      });
      setMessage("Existing payout verified by Xendit and linked. No new salary payment was created.");
      setReferenceNumber(""); setPayoutId("");
      await refresh(); await onRefresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not verify provider payout ID."); }
    finally { setBusy(""); }
  }

  const ledger = status?.ledger;
  const hasUncertain = Boolean(ledger?.counts.unknown);
  const claimedByPaymongo = status?.claimedProvider === "paymongo";
  const canSubmit = status?.selectedProvider === "xendit" && !claimedByPaymongo
    && status.readiness.ready && !hasUncertain
    && Boolean(ledger ? ledger.counts.prepared > 0 : true);
  return (
    <article className="card" data-xendit-payout-panel style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">PAYROLL PAYOUTS</div>
          <h2>{status?.selectedProvider === "paymongo" ? "PayMongo · explicitly selected" : "Xendit · default provider"}</h2>
          <p>{status?.selectedProvider === "paymongo"
              ? "PayMongo is explicitly selected. Existing disbursements stay with their original provider and require independent settlement verification."
              : "Bank and e-wallet salary payouts, protected by treasury approval. One individually tracked transfer per employee. PayMongo remains a separate legacy option."}</p>
        </div>
        <span className="status status-review">
          {ledger?.status ?? (status?.selectedProvider === "paymongo" ? "Legacy provider" : status?.readiness.ready ? "Ready for preflight" : "Activation required")}
        </span>
      </div>
      <div className="card-body" style={{ display: "grid", gap: 12 }}>
        {status?.selectedProvider === "paymongo" && (
          <div className="notice notice-amber">This deployment explicitly selected PayMongo. Xendit payouts are inactive here.</div>
        )}
        {status && status.selectedProvider === "xendit" && !status.readiness.ready && (
          <div className="notice notice-amber">
            Xendit money movement is disabled. {status.readiness.blockers.join(" ")}
          </div>
        )}
        {ledger && (
          <div className="run-stats">
            <div><span>Released transfers</span><strong>{ledger.totals.transferCount}</strong></div>
            <div><span>Awaiting submission</span><strong>{ledger.counts.prepared}</strong></div>
            <div><span>Submitted / processing</span><strong>{ledger.counts.submitted}</strong></div>
            <div><span>Settled</span><strong>{ledger.counts.succeeded}</strong></div>
            <div><span>Failed / reversed</span><strong>{ledger.counts.failed + ledger.counts.reversed}</strong></div>
            <div><span>Uncertain</span><strong>{ledger.counts.unknown}</strong></div>
          </div>
        )}
        {hasUncertain && (
          <div className="notice notice-red">
            Some Xendit payouts have unknown outcomes. No further payout can be sent until the provider reference is independently reconciled. Do not retry unknown transfers.
          </div>
        )}
        {claimedByPaymongo && (
          <div className="notice notice-amber">
            This run already has a PayMongo payout batch. Continue PayMongo reconciliation; Xendit cannot take ownership or resend those salaries.
          </div>
        )}
        {status?.selectedProvider === "paymongo" && !status.claimedProvider && allowPaymongoActions && (
          <div data-paymongo-legacy-controls style={{ display: "grid", gap: 8 }}>
            <p className="field-help">Complete the no-money PayMongo preflight and independent treasury authorization before any legacy payout submission.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button className="secondary-button" disabled={paymongoPreflighting || paymongoSubmitting}
                onClick={() => void onPaymongoPreflight()}>
                {paymongoPreflighting ? "Checking..." : "Run PayMongo preflight"}
              </button>
              <button className="primary-button brand" disabled={!canSubmitPaymongo || paymongoPreflighting || paymongoSubmitting}
                onClick={() => void onPaymongoSubmit()}>
                {paymongoSubmitting ? "Submitting..." : "Submit via PayMongo"}
              </button>
            </div>
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {status?.selectedProvider === "xendit" && !claimedByPaymongo && (<>
            <button className="secondary-button" disabled={Boolean(busy)}
              onClick={() => void preflight()}>{busy === "preflight" ? "Checking..." : "Run Xendit preflight"}</button>
            <button className="primary-button brand" disabled={Boolean(busy) || !canSubmit}
              onClick={() => void submit()}>{busy === "submit" ? "Submitting..." : "Submit / continue Xendit payroll"}</button>
          </>)}
          {ledger && (
            <button className="secondary-button" disabled={Boolean(busy)}
              onClick={() => void reconcile()}>{busy === "reconcile" ? "Checking..." : "Refresh provider settlement"}</button>
          )}
        </div>
        {hasUncertain && (
          <div style={{ display: "grid", gap: 8 }}>
            <strong>Resolve an unknown transfer using an existing Xendit payout ID</strong>
            <p className="field-help">Look up the payroll reference in your authorized Xendit account. If Xendit cannot find it, investigate with Xendit support; do not generate another transfer automatically.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <input aria-label="Payroll transfer reference" placeholder="PAY-123-E001" value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)} />
              <input aria-label="Existing Xendit payout ID" placeholder="po-..." value={payoutId}
                onChange={(e) => setPayoutId(e.target.value)} />
              <button className="secondary-button" disabled={Boolean(busy) || !referenceNumber || !payoutId}
                onClick={() => void resolveUnknown()}>{busy === "resolve" ? "Verifying..." : "Verify and link"}</button>
            </div>
          </div>
        )}
        {ledger?.rows && ledger.rows.length > 0 && (
          <div style={{ display: "grid", gap: 5 }}>
            <strong>Per-employee settlement record</strong>
            {ledger.rows.slice(0, 100).map((row) => (
              <div className="exception-row" key={row.referenceNumber}>
                <span>{row.employeeNo} · {row.referenceNumber}</span>
                <span>PHP {(row.amountCents / 100).toFixed(2)} · {row.status}</span>
              </div>
            ))}
            {ledger.rows.length > 100 && <small>Showing first 100 of {ledger.rows.length} records.</small>}
          </div>
        )}
        {message && <div role="status" className="notice notice-amber">{message}</div>}
        <p className="field-help">
          {status?.selectedProvider === "paymongo"
            ? "PayMongo payout submission requires a verified no-money preflight, independent treasury authorization and signed provider acceptance. An HTTP success does not prove final settlement."
            : "Xendit live access requires a dedicated MONEY-OUT key, approved legal employer and authorization, the reviewed database migration, and signed acceptance testing. Preflight does not reserve funds; an HTTP success does not prove final settlement."}
        </p>
      </div>
    </article>
  );
}
