"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, RefreshCcw, ShieldAlert } from "lucide-react";
import type { Notify } from "./types";
import { parseRemittanceMonthCloseRead, type VerifiedRemittanceMonthClose } from "@/lib/remittance-month-close-read";
import { Spinner, Status } from "./ui";

type MonthCloseProps = {
  organizationId: number;
  legalEntityId?: number | null;
  applicableMonth: string;
  notify: Notify;
};

export function StatutoryRemittanceMonthClose(props: MonthCloseProps) {
  // A certification snapshot must never carry across employer/entity/month scopes.
  return <StatutoryRemittanceMonthCloseContent key={`${props.organizationId}:${props.legalEntityId ?? "all"}:${props.applicableMonth}`} {...props} />;
}

function StatutoryRemittanceMonthCloseContent({
  organizationId,
  legalEntityId,
  applicableMonth,
  notify,
}: MonthCloseProps) {
  const [state, setState] = useState<VerifiedRemittanceMonthClose | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState("");
  const activeRead = useRef<AbortController | null>(null);

  const load = useCallback(async (): Promise<VerifiedRemittanceMonthClose | null> => {
    activeRead.current?.abort();
    const controller = new AbortController();
    activeRead.current = controller;
    // Withdraw any prior readiness/certification until a new scoped GET passes.
    setState(null);
    setLoading(true);
    setReadError("");
    try {
      const response = await fetch(
        `/api/compliance/remittance-month-close?organizationId=${organizationId}${legalEntityId ? `&legalEntityId=${legalEntityId}` : ""}&applicableMonth=${applicableMonth}`,
        { cache: "no-store", signal: controller.signal },
      );
      const body = await response.json().catch(() => ({}));
      if (controller.signal.aborted) return null;
      if (!response.ok) throw new Error(body.error ?? "Could not load remittance month close.");
      const verified = parseRemittanceMonthCloseRead(
        body, organizationId, legalEntityId || null, applicableMonth,
      );
      if (!verified) throw new Error("Remittance certification evidence was incomplete or belonged to a different employer or month.");
      setState(verified);
      return verified;
    } catch (error) {
      if (!controller.signal.aborted) {
        setState(null);
        setReadError(error instanceof Error ? error.message : "Remittance month-close evidence could not be verified.");
      }
      return null;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [applicableMonth, legalEntityId, organizationId]);

  useEffect(() => {
    const controller = new AbortController();
    const onChanged = () => {
      if (!controller.signal.aborted) void load();
    };
    // Strict Mode cleanup can cancel the first read before it starts.
    queueMicrotask(onChanged);
    window.addEventListener("statutory-remittance-changed", onChanged);
    return () => {
      controller.abort();
      activeRead.current?.abort();
      window.removeEventListener("statutory-remittance-changed", onChanged);
    };
  }, [load]);

  async function certify() {
    if (busy || !state?.evaluation.ready || state.certificationValid) return;
    const requestedSnapshot = state.evaluation.snapshotHash;
    setBusy(true);
    try {
      const response = await fetch("/api/compliance/remittance-month-close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, legalEntityId: legalEntityId ?? undefined, applicableMonth }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const blockers = Array.isArray(body.blockers) ? body.blockers.join(" · ") : "";
        notify([body.error ?? "Could not certify remittance month.", blockers].filter(Boolean).join(" "), "err");
        return;
      }
      // POST is not a full read contract. Re-read the SAME snapshot before success.
      const verified = await load();
      if (verified?.certificationValid && verified.closure?.snapshotHash === requestedSnapshot) {
        notify(`${applicableMonth} statutory remittance cycle certified.`, "ok");
      } else {
        notify("The certification request may have succeeded, but its exact evidence could not be verified. Review the month-close record before retrying.", "err");
      }
    } catch {
      notify("The certification response is uncertain. Check the month-close record before attempting another certification.", "err");
      void load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <article className="card" style={{ marginBottom: 16 }} data-remittance-month-close>
        <div className="card-header"><div><div className="card-kicker">REMITTANCE MONTH CLOSE</div><h2>Verifying certification evidence…</h2></div></div>
      </article>
    );
  }
  if (!state) {
    return (
      <article className="card" style={{ marginBottom: 16 }} data-remittance-month-close>
        <div className="card-header">
          <div><div className="card-kicker">REMITTANCE MONTH CLOSE</div><h2>Certification status unavailable</h2><p role="alert">{readError || "Remittance evidence could not be verified."} No readiness or certification can be assumed.</p></div>
          <button className="secondary-button" onClick={() => void load()} disabled={busy}><RefreshCcw size={14} /> Retry</button>
        </div>
      </article>
    );
  }

  return (
    <article className="card" style={{ marginBottom: 16 }} data-remittance-month-close>
      <div className="card-header">
        <div>
          <div className="card-kicker">REMITTANCE MONTH CLOSE</div>
          <h2>{applicableMonth} mandatory contribution cycle</h2>
          <p>
            Independent certification proves the current SSS, PhilHealth and Pag-IBIG remittance evidence was fully reconciled at this snapshot. The certifier cannot be an actor who recorded, confirmed, or approved a correction in the same evidence set.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={busy}>
          <RefreshCcw size={14} /> Refresh
        </button>
      </div>

      <div className="card-body" style={{ paddingTop: 0, display: "grid", gap: 12 }}>
        {state.certificationValid ? (
          <div className="notice notice-green" style={{ margin: 0 }}>
            <BadgeCheck size={15} />
            <span>
              <strong>Certified and still valid.</strong>{" "}
              Independent reviewer {state.closure?.certifiedByName} certified this exact evidence snapshot.
            </span>
          </div>
        ) : state.closure ? (
          <div className="notice notice-red" style={{ margin: 0 }}>
            <ShieldAlert size={15} />
            <span>
              <strong>Previous certification is no longer current.</strong> The prior immutable certification remains in history, but the live remittance evidence now has a different snapshot and must be independently certified again.
            </span>
          </div>
        ) : null}

        <div className="run-stats" style={{ margin: 0 }}>
          <div><span>Agencies reconciled</span><strong>{state.evaluation.agencyCount}</strong></div>
          <div><span>Employee postings</span><strong>{state.evaluation.memberCount}</strong></div>
          <div>
            <span>Close readiness</span>
            <strong>{state.evaluation.ready ? "Ready" : "Blocked"}</strong>
            <small><Status value={state.evaluation.ready ? "Ready" : "Needs attention"} /></small>
          </div>
        </div>

        {!state.evaluation.ready && (
          <div className="notice notice-amber" style={{ margin: 0 }}>
            <ShieldAlert size={15} />
            <span>
              <strong>Cannot certify.</strong>{" "}
              {state.evaluation.blockers.slice(0, 5).join(" · ")}
            </span>
          </div>
        )}

        {state.evaluation.ready && !state.certificationValid && (
          <div className="run-actions">
            <button className="primary-button brand" disabled={busy} onClick={() => void certify()}>
              {busy ? <Spinner label="Certifying" /> : <BadgeCheck size={14} />}
              Certify remittance month
            </button>
          </div>
        )}

        {(state.certificationHistory?.length ?? 0) > 0 && (
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 12 }}>
              Certification history ({state.certificationHistory?.length ?? 0})
            </summary>
            <div className="policy-lines" style={{ marginTop: 8 }}>
              {(state.certificationHistory ?? []).slice(0, 8).map((item) => (
                <span key={item.id}>
                  <b>{item.certifiedByName}</b>
                  <small style={{ display: "block", color: "var(--muted)" }}>
                    {new Date(item.certifiedAt).toLocaleString("en-PH")} · snapshot {item.snapshotHash.slice(0, 12)}…
                  </small>
                </span>
              ))}
            </div>
          </details>
        )}
      </div>
    </article>
  );
}
