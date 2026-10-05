"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, RefreshCcw, ShieldAlert } from "lucide-react";
import type { Notify } from "./types";
import { Spinner, Status } from "./ui";

type CloseState = {
  evaluation: {
    ready: boolean;
    blockers: string[];
    snapshotHash: string;
    agencyCount: number;
    memberCount: number;
  };
  closure: {
    id: number;
    status: string;
    certifiedByName: string;
    certifiedAt: string;
    snapshotHash: string;
  } | null;
  certificationValid: boolean;
};

export function StatutoryRemittanceMonthClose({
  organizationId,
  applicableMonth,
  notify,
}: {
  organizationId: number;
  applicableMonth: string;
  notify: Notify;
}) {
  const [state, setState] = useState<CloseState | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/compliance/remittance-month-close?organizationId=${organizationId}&applicableMonth=${applicableMonth}`,
      { cache: "no-store" },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Could not load remittance month close.");
    setState(body as CloseState);
  }, [applicableMonth, organizationId]);

  useEffect(() => {
    void load().catch((error) => notify(
      error instanceof Error ? error.message : "Could not load remittance month close.",
      "err",
    ));
    const onChanged = () => void load();
    window.addEventListener("statutory-remittance-changed", onChanged);
    return () => window.removeEventListener("statutory-remittance-changed", onChanged);
  }, [load, notify]);

  async function certify() {
    setBusy(true);
    try {
      const response = await fetch("/api/compliance/remittance-month-close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, applicableMonth }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const blockers = Array.isArray(body.blockers) ? body.blockers.join(" · ") : "";
        throw new Error([body.error, blockers].filter(Boolean).join(" "));
      }
      setState(body as CloseState);
      notify(`${applicableMonth} statutory remittance cycle certified.`, "ok");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not certify remittance month.", "err");
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  return (
    <article className="card" style={{ marginBottom: 16 }} data-remittance-month-close>
      <div className="card-header">
        <div>
          <div className="card-kicker">REMITTANCE MONTH CLOSE</div>
          <h2>{applicableMonth} mandatory contribution cycle</h2>
          <p>
            Certification proves the current SSS, PhilHealth and Pag-IBIG remittance evidence was fully reconciled at this snapshot.
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
              {state.closure?.certifiedByName} certified this evidence snapshot.
            </span>
          </div>
        ) : state.closure ? (
          <div className="notice notice-red" style={{ margin: 0 }}>
            <ShieldAlert size={15} />
            <span>
              <strong>Previous certification is no longer valid.</strong> The current remittance evidence no longer matches the certified snapshot.
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
      </div>
    </article>
  );
}
