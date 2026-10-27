"use client";

import { useEffect, useId, useRef, useState } from "react";
import { readHcmCorrectionReason, verifyHcmCorrectionActionRead } from "@/lib/hcm-correction-action-read";

type Props = {
  organizationId: number; employeeId: number; userId: number;
  replacementId?: number;
  change: { id: number; status: string; movementType: string; requestedByUserId: number | null; effectiveDate: string; reason: string };
  onChanged: () => Promise<unknown>;
};
export function HcmEffectiveChangeCorrection(props: Props) {
  return <CorrectionForm key={`${props.organizationId}:${props.change.id}:${props.userId}`} {...props} />;
}
function CorrectionForm({ organizationId, employeeId, userId, change, replacementId, onChanged }: Props) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [note, setNote] = useState(""), [date, setDate] = useState(change.effectiveDate);
  const [error, setError] = useState("");
  const [returnReason, setReturnReason] = useState<string | null>(null), [loadingReason, setLoadingReason] = useState(false);
  const live = useRef(true), id = useId();
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const action = change.status === "returned_for_correction" && change.requestedByUserId === userId ? "resubmit"
    : change.status === "pending_approval" && change.requestedByUserId !== userId ? "return" : null;
  if (change.movementType !== "employment_type_change" || !action) return null;
  if (action === "resubmit" && replacementId) return <span className="text-xs">Resubmitted as request #{replacementId}; approvals restarted.</span>;
  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true); setError("");
    if (action !== "resubmit") return;
    setLoadingReason(true); setReturnReason(null);
    try {
      const response = await fetch(`/api/hcm/effective-change-corrections?organizationId=${organizationId}&changeId=${change.id}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const body: unknown = await response.json().catch(() => null);
      if (live.current) setReturnReason(readHcmCorrectionReason(response.ok, body, { organizationId, employeeId, changeId: change.id }));
    } catch { if (live.current) setError("The reviewer's return reason is unavailable. Close and reopen this form to retry."); }
    finally { if (live.current) setLoadingReason(false); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || (action === "resubmit" && returnReason === null)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/hcm/effective-change-corrections/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ organizationId, changeId: change.id, ...(action === "return" ? { note } : { reason: note, effectiveDate: date }) }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!live.current) return;
      verifyHcmCorrectionActionRead(response.ok, body, { organizationId, employeeId, changeId: change.id, userId, action });
      await onChanged();
      if (live.current) { setOpen(false); setNote(""); }
    } catch {
      if (live.current) setError("This correction could not be verified. Refresh the worker record and check your review assignment before retrying.");
    } finally { if (live.current) setBusy(false); }
  };
  return <div style={{ flexBasis: "100%", maxWidth: 420 }}>
    <button type="button" className="secondary-button" aria-expanded={open} aria-controls={id} disabled={busy || loadingReason} onClick={() => void toggle()}>
      {action === "return" ? "Return for correction" : "Correct and resubmit"}
    </button>
    {open ? <form id={id} onSubmit={event => void submit(event)} style={{ display: "grid", gap: 8, marginTop: 8 }} aria-busy={busy}>
      <p className="text-xs">{action === "return" ? "Only the assigned current reviewer can return an employment-type-only request. Its old approval run will be cancelled." : "Correct the reason or date. Use today or a future Philippine business date. This creates a new request with fresh independent approvals; prior approvals are not reused. To change other employment fields, submit a new governed request."}</p>
      {action === "resubmit" ? <p role="status">{loadingReason ? "Loading reviewer reason…" : returnReason === null ? "Reviewer reason unavailable." : `Reviewer requested: ${returnReason}`}</p> : null}
      <label htmlFor={`${id}-note`}>{action === "return" ? "What needs correction?" : "Corrected request reason"}</label>
      <textarea id={`${id}-note`} required minLength={10} maxLength={action === "return" ? 500 : 240} value={note} disabled={busy} onChange={event => setNote(event.target.value)} />
      {action === "resubmit" ? <><label htmlFor={`${id}-date`}>Corrected effective date</label><input id={`${id}-date`} type="date" required value={date} disabled={busy} onChange={event => setDate(event.target.value)} /></> : null}
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" className="primary-button" disabled={busy || note.trim().length < 10 || (action === "resubmit" && returnReason === null)}>{busy ? "Saving…" : action === "return" ? "Confirm return" : "Submit for fresh approval"}</button>
    </form> : null}
  </div>;
}
