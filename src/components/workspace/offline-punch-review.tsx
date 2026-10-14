"use client";

import { useEffect, useState } from "react";

type Claim = {
  id: number; employeeName: string; employeeId: number; claimedAt: string;
  createdAt: string; actionType: string; status: string; reviewNote: string | null;
};
export function OfflinePunchReviewQueue({ organizationId }: { organizationId: number }) {
  const [rows, setRows] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState<"pending_review"|"all">("pending_review");
  useEffect(() => {
    let alive = true;
    (async () => {
      await Promise.resolve();
      if (!alive) return;
      setLoading(true); setError("");
      try {
        const r = await fetch("/api/attendance/offline-claims?organizationId=" + organizationId,
          { cache: "no-store" });
        const payload = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(payload.error ?? "Could not load offline claims.");
        if (alive) { setRows(payload.claims ?? []); setLoading(false); }
      } catch (e) {
        if (alive) { setError(e instanceof Error ? e.message : "Offline queue failed."); setLoading(false); }
      }
    })();
    return () => { alive = false; };
  }, [organizationId, reload]);
  const visible = filter==="all" ? rows : rows.filter(row=>row.status==="pending_review");
  async function decide(action: "flag"|"dismiss") {
    if (!selected || !note.trim() || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch("/api/attendance/offline-claims", {
        method: "PATCH", headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ organizationId, id:selected, action, note }),
      });
      const payload = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(payload.error ?? "Reviewer action failed.");
      setNotice(action==="flag" ? "Flagged for a governed attendance correction. No punch or payroll record changed."
        : "Claim dismissed without changing attendance.");
      setSelected(null); setNote(""); setReload(x=>x+1);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not record review."); }
    finally { setBusy(false); }
  }
  return <article className="card" style={{ padding:16, marginTop:16 }} aria-label="Offline attendance claim reviewer queue">
    <div className="card-kicker">HR ATTENDANCE REVIEW</div>
    <h2>Unverified offline punch claims</h2>
    <p>These device timestamps are claims only. They never enter the authoritative time ledger automatically.
      Flag items for the existing approval-based attendance correction workflow.</p>
    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
      <label>Show <select value={filter} onChange={e=>setFilter(e.target.value as typeof filter)}>
        <option value="pending_review">Pending HR review</option><option value="all">All claims</option>
      </select></label>
      <button className="secondary-button" type="button" disabled={busy}
        onClick={()=>setReload(n=>n+1)}>Refresh</button>
    </div>
    {loading && <p role="status">Loading offline claims…</p>}
    {error && <div role="alert">{error} <button type="button" onClick={()=>setReload(n=>n+1)}>Retry</button></div>}
    {notice && <p role="status">{notice}</p>}
    {!loading && !error && visible.length===0 && <p className="empty-state">No offline claims match this filter.</p>}
    {!loading && visible.length>0 && <div className="data-table-wrap" style={{ maxWidth:"100%", overflowX:"auto" }}>
      <table className="data-table" aria-label="Offline punch review queue">
        <thead><tr><th>Employee</th><th>Device claim</th><th>Received</th><th>Status</th><th>Review</th></tr></thead>
        <tbody>{visible.map(row => <tr key={row.id}>
          <td>{row.employeeName} · #{row.employeeId}</td>
          <td>{row.actionType.replaceAll("_"," ")} · {new Date(row.claimedAt).toLocaleString("en-PH")}</td>
          <td>{new Date(row.createdAt).toLocaleString("en-PH")}</td><td>{row.status}</td>
          <td>{row.status==="pending_review" && <button type="button" className="secondary-button"
            onClick={()=>{setSelected(row.id);setNote("");setError("");}}>Review claim #{row.id}</button>}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {selected && <section className="card" role="dialog" aria-label="Review unverified punch" style={{ padding:14, marginTop:10 }}>
      <h3>Review claim #{selected}</h3>
      <p>HR may flag or dismiss a claim. Neither action records a clock-in or approves payroll time.</p>
      <label>Reviewer evidence and rationale
        <textarea rows={3} minLength={12} maxLength={400} value={note}
          onChange={e=>setNote(e.target.value)} placeholder="Describe observed evidence and the next correction step"/>
      </label>
      <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:10 }}>
        <button className="primary-button" type="button" disabled={busy || note.trim().length<12}
          onClick={()=>void decide("flag")}>Flag for HR correction</button>
        <button className="secondary-button" type="button" disabled={busy || note.trim().length<12}
          onClick={()=>void decide("dismiss")}>Dismiss unverified claim</button>
        <button className="secondary-button" type="button" onClick={()=>setSelected(null)}>Cancel</button>
      </div>
    </section>}
  </article>;
}
