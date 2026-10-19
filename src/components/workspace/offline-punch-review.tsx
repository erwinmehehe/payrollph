"use client";

import { useEffect, useState } from "react";
import {
  isVerifiedOfflinePunchReviewReceipt, readVerifiedOfflinePunchClaims,
  type OfflinePunchReviewRow,
} from "@/lib/offline-punch-review-read";

/** A changed employer unmounts prior HR rows, selection and reviewer notes immediately. */
export function OfflinePunchReviewQueue({ organizationId }: { organizationId: number }) {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return <article className="card" role="status">Select a valid employer before reviewing offline claims.</article>;
  }
  return <ScopedOfflinePunchReviewQueue key={organizationId} organizationId={organizationId} />;
}

function ScopedOfflinePunchReviewQueue({ organizationId }: { organizationId: number }) {
  const [snapshot, setSnapshot] = useState<{
    reload: number; rows: OfflinePunchReviewRow[] | null; error: string;
  } | null>(null);
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState<"pending_review" | "all">("pending_review");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      // Defer loading until after render; abort and request identity guard stale responses.
      await Promise.resolve();
      if (controller.signal.aborted) return;
      try {
        const payload = await readVerifiedOfflinePunchClaims(organizationId, fetch, controller.signal);
        if (!controller.signal.aborted) setSnapshot({ reload, rows: payload.claims, error: "" });
      } catch (cause) {
        if (!controller.signal.aborted) setSnapshot({
          reload, rows: null,
          error: cause instanceof Error ? cause.message : "Offline claim queue unavailable.",
        });
      }
    })();
    return () => controller.abort();
  }, [organizationId, reload]);

  const current = snapshot?.reload === reload ? snapshot : null;
  const loading = current === null;
  const error = current?.error ?? "";
  const rows = current?.rows ?? [];
  const visible = filter === "all" ? rows : rows.filter(row => row.status === "pending_review");
  const selectedRow = !loading && !error && !actionError
    ? rows.find(row => row.id === selected && row.status === "pending_review") ?? null
    : null;

  function refresh() {
    if (busy) return;
    setSelected(null); setNote(""); setActionError(""); setNotice("");
    setReload(value => value + 1);
  }

  async function decide(action: "flag" | "dismiss") {
    const claim = selectedRow;
    if (!claim || note.trim().length < 12 || note.trim().length > 400 || busy) return;
    setBusy(true); setActionError(""); setNotice("");
    try {
      const response = await fetch("/api/attendance/offline-claims", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, id: claim.id, action, note: note.trim() }),
      });
      const receipt: unknown = await response.json().catch(() => null);
      if (!response.ok) throw Error("Could not confirm the HR review. Reload the claim before deciding again.");
      if (!isVerifiedOfflinePunchReviewReceipt(receipt, organizationId, claim, action)) {
        throw Error("The review receipt was incomplete or mismatched. Reload the queue; do not resubmit blindly.");
      }
      setNotice(action === "flag"
        ? "Flagged for a governed attendance correction. No punch or payroll record changed."
        : "Claim dismissed without changing attendance.");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Review result is unverified; reload the queue.");
    } finally {
      // Even on an ambiguous write outcome, re-read the authoritative queue;
      // never keep approval buttons or an obsolete claim selected.
      setSelected(null); setNote(""); setReload(value => value + 1); setBusy(false);
    }
  }

  return <article className="card" style={{ padding: 16, marginTop: 16 }} aria-label="Offline attendance claim reviewer queue">
    <div className="card-kicker">HR ATTENDANCE REVIEW</div>
    <h2>Unverified offline punch claims</h2>
    <p>These device timestamps are claims only. They never enter the authoritative time ledger automatically.
      Flag items for the existing approval-based attendance correction workflow.</p>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <label>Show <select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
        <option value="pending_review">Pending HR review</option><option value="all">All claims</option>
      </select></label>
      <button className="secondary-button" type="button" disabled={busy || loading} onClick={refresh}>
        Refresh
      </button>
    </div>
    {loading && <p role="status">Loading offline claims…</p>}
    {error && <div role="alert">{error} <button type="button" onClick={refresh}>Retry</button></div>}
    {actionError && <p role="alert">{actionError} Refresh before attempting any other review.</p>}
    {notice && <p role="status">{notice}</p>}
    {!loading && !error && !actionError && visible.length === 0 &&
      <p className="empty-state">No offline claims match this filter within the latest 100 returned records.
        This does not verify that every historical claim has been reviewed.</p>}
    {!loading && !error && !actionError && visible.length > 0 &&
      <div className="data-table-wrap" style={{ maxWidth: "100%", overflowX: "auto" }}>
        <table className="data-table" aria-label="Offline punch review queue">
          <thead><tr><th>Employee</th><th>Device claim</th><th>Received</th><th>Status</th><th>Review</th></tr></thead>
          <tbody>{visible.map(row => <tr key={row.id}>
            <td>{row.employeeName} · #{row.employeeId}</td>
            <td>{row.actionType.replaceAll("_", " ")} · {new Date(row.claimedAt).toLocaleString("en-PH")}</td>
            <td>{new Date(row.createdAt).toLocaleString("en-PH")}</td><td>{row.status}</td>
            <td>{row.status === "pending_review" && <button type="button" className="secondary-button"
              disabled={busy} onClick={() => { setSelected(row.id); setNote(""); setActionError(""); }}>
                Review claim #{row.id}
              </button>}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    {selectedRow && <section className="card" role="dialog" aria-label="Review unverified punch"
      style={{ padding: 14, marginTop: 10 }}>
      <h3>Review claim #{selectedRow.id}</h3>
      <p>HR may flag or dismiss a claim. Neither action records a clock-in or approves payroll time.</p>
      <label>Reviewer evidence and rationale
        <textarea rows={3} minLength={12} maxLength={400} value={note}
          onChange={event => setNote(event.target.value)}
          placeholder="Describe observed evidence and the next correction step"/>
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        <button className="primary-button" type="button" disabled={busy || note.trim().length < 12}
          onClick={() => void decide("flag")}>Flag for HR correction</button>
        <button className="secondary-button" type="button" disabled={busy || note.trim().length < 12}
          onClick={() => void decide("dismiss")}>Dismiss unverified claim</button>
        <button className="secondary-button" type="button" onClick={() => setSelected(null)}>Cancel</button>
      </div>
    </section>}
  </article>;
}
