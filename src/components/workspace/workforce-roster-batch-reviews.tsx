"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { RefreshCcw, ShieldCheck } from "lucide-react";
import { Status } from "./ui";
import { useScopedAsyncResource } from "./use-scoped-async-resource";

type Batch = {
  id: number;
  workDate: string;
  shiftDefinitionId: number;
  reason: string;
  status: string;
  requestedBy: string;
  requestedByUserId: number;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  employees: Array<{ id: number; employeeNo: string; name: string }>;
  overrideCount: number;
};
type Props = {
  organizationId: number;
  currentUserId: number;
  enabled: boolean;
  refreshKey: number;
};

export function WorkforceRosterBatchReviews(props: Props) {
  return <ScopedRosterBatchReviews key={JSON.stringify([props.organizationId, props.currentUserId, props.enabled])} {...props}/>;
}

function ScopedRosterBatchReviews({
  organizationId,
  currentUserId,
  enabled,
  refreshKey,
}: Props) {
  const [decisionError, setDecisionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<{ employer: number; id: number } | null>(null);
  const [note, setNote] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(
      "/api/workforce/roster-batches?organizationId=" + organizationId,
      { cache: "no-store", signal },
    );
    const raw: unknown = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(response.status === 403
      ? "Company-wide People approval access is required." : "Could not load governed roster batches.");
    if (!raw || typeof raw !== "object" || !("batches" in raw) ||
      !Array.isArray(raw.batches) || raw.batches.length > 50) {
      throw new Error("Invalid roster approval response.");
    }
    return raw.batches as Batch[];
  }, [organizationId]);

  const scope = JSON.stringify([organizationId, currentUserId, refreshKey]);
  const { data, error: readError, loading, reload } = useScopedAsyncResource(scope, load, undefined, enabled);
  const batches = data ?? [];
  const error = decisionError || readError?.message || "";
  const chosen = selected?.employer === organizationId
    ? batches.find(batch => batch.id === selected.id && batch.status === "pending") : null;

  async function decide(action: "approve" | "reject") {
    if (!chosen || busy || !acknowledged || note.trim().length < 12 ||
      currentUserId === chosen.requestedByUserId) return;
    setBusy(true);
    try {
      const response = await fetch("/api/workforce/roster-batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action, organizationId, batchId: chosen.id,
          decisionNote: note.trim(), acknowledged: true,
        }),
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!mounted.current) return;
      const message = body && typeof body === "object" && "error" in body
        && typeof body.error === "string" ? body.error : "Roster batch decision could not be completed.";
      if (!response.ok) throw new Error(message);
      setSelected(null);
      setNote("");
      setAcknowledged(false);
      setDecisionError("");
      await reload();
    } catch (cause) {
      if (!mounted.current) return;
      setDecisionError(cause instanceof Error ? cause.message : "Roster decision unavailable.");
      await reload();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <article className="card" style={{ marginTop: 16 }} data-wfm-roster-batch-checker>
      <div className="card-header">
        <div>
          <div className="card-kicker">Independent maker/checker · default OFF</div>
          <h3>Governed roster batch review</h3>
          <p>A second company-wide People administrator must review source records before publication. One failed eligibility, lock, or race check stops the entire batch.</p>
        </div>
        <button type="button" className="secondary-button" disabled={!enabled || busy || loading} onClick={() => { setDecisionError(""); void reload(); }}>
          <RefreshCcw size={15} aria-hidden="true" /> Refresh
        </button>
      </div>
      {enabled && error && <div role="alert" className="notice notice-amber" style={{ margin: "0 18px 16px" }}>{error}</div>}
      {loading && <div role="status" className="notice notice-slate">Loading authorized review queue…</div>}
      {enabled && data && batches.length === 0 && <div className="notice notice-slate" style={{ margin: "0 18px 16px" }}>No staged roster batches in this employer.</div>}
      {enabled && batches.length > 0 && <div className="data-table-wrap slim-scroll">
        <table className="data-table" aria-label="Governed bulk roster batch queue">
          <thead><tr><th>Batch</th><th>Shift date</th><th>Proposed workers</th><th>Source review</th><th>Status</th><th>Review</th></tr></thead>
          <tbody>{batches.map(batch => <tr key={batch.id}>
            <td><strong>#{batch.id}</strong><div className="id">{batch.requestedBy}</div></td>
            <td>{batch.workDate}<div className="id">Shift #{batch.shiftDefinitionId}</div></td>
            <td><strong>{batch.employees.length}</strong><div className="id">{batch.employees.map(e => e.name + " (" + e.employeeNo + ")").join(", ")}</div></td>
            <td><small>{batch.reason}</small></td>
            <td><Status value={batch.status} /><div className="id">{batch.decidedBy ? "By " + batch.decidedBy : "Awaiting checker"}</div></td>
            <td>{batch.status === "pending"
              ? <button type="button" className="secondary-button"
                  disabled={busy || currentUserId === batch.requestedByUserId}
                  onClick={() => { setSelected({ employer: organizationId, id: batch.id }); setNote(""); setAcknowledged(false); }}>
                  {currentUserId === batch.requestedByUserId ? "Maker cannot decide" : "Review"}
                </button>
              : <span className="id">Recorded · {batch.overrideCount} published</span>}
            </td>
          </tr>)}</tbody>
        </table>
      </div>}
      {chosen && <div className="setting-form" style={{ padding: "18px" }}>
        <div className="notice notice-amber">
          <ShieldCheck size={15} aria-hidden="true"/>
          <span>Decision for batch #{chosen.id}, {chosen.workDate}. Approval revalidates live attendance, leave, payroll, HCM, scheduling and worksite sources in a transaction. It is not a payroll release.</span>
        </div>
        <label>Checker decision note
          <input required maxLength={240} value={note} onChange={e => setNote(e.target.value)}
            placeholder="Record evidence and rationale, 12–240 characters"/>
        </label>
        <label style={{ display: "flex", gap: 10, alignItems: "start" }}>
          <input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}/>
          <span>I independently reviewed the full batch, the potential time/pay consequences, and understand approval publishes all validated future shifts atomically.</span>
        </label>
        <div className="run-actions" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="primary-button brand"
            disabled={!acknowledged || note.trim().length < 12 || busy} onClick={() => void decide("approve")}>
            Approve and publish batch
          </button>
          <button type="button" className="secondary-button"
            disabled={!acknowledged || note.trim().length < 12 || busy} onClick={() => void decide("reject")}>
            Reject batch
          </button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => setSelected(null)}>
            Cancel review
          </button>
        </div>
      </div>}
    </article>
  );
}
