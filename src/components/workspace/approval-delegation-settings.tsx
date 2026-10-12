"use client";

import { useCallback, useEffect, useState } from "react";

/** Existing audited delegation API is the source of truth; no implicit new permission. */
type Delegation = {
  id: number; fromApprover: string; toApprover: string; startsOn: string;
  endsOn: string; active: boolean; reason: string;
};
export function ApprovalDelegationSettings({ organizationId }: { organizationId: number }) {
  const [storedRows, setStoredRows] = useState<{ organizationId: number; rows: Delegation[] }>({ organizationId, rows: [] });
  const rows = storedRows.organizationId === organizationId ? storedRows.rows : [];
  const [fromApprover, setFromApprover] = useState("");
  const [toApprover, setToApprover] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [reason, setReason] = useState("Out of office");
  const [state, setState] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/delegations?organizationId=" + organizationId, {
        cache: "no-store", signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (signal?.aborted) return;
      if (!response.ok) throw new Error(payload.error ?? "Cannot view delegations with this role.");
      setStoredRows({ organizationId, rows: payload.delegations ?? [] });
      setError("");
      setState("ready");
    } catch (e) {
      if (signal?.aborted) return;
      setError(e instanceof Error ? e.message : "Delegations unavailable.");
      setState("error");
    }
  }, [organizationId]);
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    return () => abort.abort();
  }, [load]);

  async function write(method: "POST" | "PATCH", payload: Record<string, unknown>) {
    setState("saving"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/delegations", {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, ...payload }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Delegation change rejected.");
      setNotice(method === "POST" ? "Delegation saved with server authorization and audit." : "Delegation state updated.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save delegation."); setState("ready");
    }
  }
  return <section className="card" style={{ marginTop: 18, padding: 14 }} aria-label="Approval delegation settings">
    <h3>Delegation settings</h3>
    <p>Only existing approval-capable members may delegate. Delegation cannot bypass maker-checker, expiry or payroll authority.</p>
    {state === "loading" && <p role="status">Loading delegations…</p>}
    {state === "error" && <div role="alert">{error}<button className="secondary-button" onClick={() => { setState("loading"); setError(""); void load(); }}>Retry</button></div>}
    {state !== "error" && state !== "loading" && rows.length === 0 && <p>No delegations recorded for your accessible approvals.</p>}
    {rows.length > 0 && <div className="data-table-wrap" style={{ overflowX: "auto" }}><table className="data-table">
      <thead><tr><th>From</th><th>Delegate</th><th>Dates</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}><td>{row.fromApprover}</td><td>{row.toApprover}</td>
        <td>{row.startsOn} – {row.endsOn}</td><td>{row.active ? "Active" : "Revoked"}</td>
        <td><button type="button" disabled={state === "saving"} className="secondary-button"
          onClick={() => void write("PATCH", { id: row.id, active: !row.active })}>
          {row.active ? "Revoke" : "Enable"}</button></td>
      </tr>)}</tbody>
    </table></div>}
    <div className="setting-form" style={{ marginTop: 12 }}>
      <label>Approver name<input value={fromApprover} onChange={e=>setFromApprover(e.target.value)} placeholder="Existing authorized approver"/></label>
      <label>Delegate name<input value={toApprover} onChange={e=>setToApprover(e.target.value)} placeholder="Authorized checker"/></label>
      <label>Effective from<input type="date" value={startsOn} onChange={e=>setStartsOn(e.target.value)}/></label>
      <label>Until<input type="date" min={startsOn || undefined} value={endsOn} onChange={e=>setEndsOn(e.target.value)}/></label>
      <label>Reason<input maxLength={200} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    </div>
    {error && state !== "error" && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <button type="button" className="primary-button" disabled={state === "saving" ||
      !fromApprover.trim() || !toApprover.trim() || !startsOn || !endsOn || endsOn < startsOn}
      onClick={() => void write("POST", { fromApprover, toApprover, startsOn, endsOn, reason })}>
      {state === "saving" ? "Saving…" : "Create audited delegation"}
    </button>
  </section>;
}
