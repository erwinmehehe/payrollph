"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Fingerprint, RefreshCcw, ShieldCheck, XCircle } from "lucide-react";
import { ESS_IDENTIFIER_FIELDS, isEssIdentifierKind, type EssIdentifierKind } from "@/lib/ess-identifiers";

type ReviewRequest = {
  id: number;
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  kind: EssIdentifierKind;
  currentMasked: string | null;
  proposedMasked: string | null;
  requestedAt: string;
  status: string;
};

export function EmployeeIdentifierReviewPanel({ organizationId, onRefresh }: {
  organizationId: number;
  onRefresh: () => Promise<void>;
}) {
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [verifiedValue, setVerifiedValue] = useState("");
  const [verified, setVerified] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/employee-identifier-requests?organizationId=" + organizationId, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Could not load employee ID requests.");
    return (body.requests || []).filter((row: ReviewRequest) => isEssIdentifierKind(row.kind)) as ReviewRequest[];
  }, [organizationId]);

  useEffect(() => {
    let live = true;
    void load().then((rows) => {
      if (live) { setRequests(rows); setError(""); setLoading(false); }
    }).catch((cause: unknown) => {
      if (live) {
        setError(cause instanceof Error ? cause.message : "Unable to load ID requests.");
        setLoading(false);
      }
    });
    return () => { live = false; };
  }, [load]);

  function closeReview() {
    setSelected(null);
    setVerifiedValue("");
    setVerified(false);
    setNote("");
    setError("");
  }

  async function decide(id: number, action: "approve" | "reject") {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/employee-identifier-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          requestId: id,
          action,
          verifiedValue: action === "approve" ? verifiedValue : undefined,
          verifiedAgainstDocument: action === "approve" ? verified : undefined,
          reviewNote: note,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "ID request could not be reviewed.");
      closeReview();
      setRequests(await load());
      if (action === "approve") await onRefresh();
      setNotice(action === "approve" ? "Verified ID applied to the employee record." : "ID request returned to the employee.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save the review.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="ess-hr-review" aria-label="Employee ID verification">
      <div className="ess-hr-review-heading">
        <div>
          <span className="card-kicker">IDENTITY DATA</span>
          <h3><Fingerprint size={19} /> Employee ID verification requests</h3>
          <p>Employee-submitted changes are encrypted and do not change payroll or HR records until separately verified.</p>
        </div>
        <button className="secondary-button" type="button" disabled={loading || saving} onClick={() => { setLoading(true); void load().then((rows) => { setRequests(rows); setLoading(false); setError(""); }).catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : "Could not refresh."); setLoading(false); }); }}>
          <RefreshCcw size={15} /> Refresh
        </button>
      </div>
      {error && <div className="notice notice-amber" role="alert"><span>{error}</span></div>}
      {notice && <div className="notice notice-green" role="status"><CheckCircle2 size={16} /><span>{notice}</span></div>}
      {loading ? <p>Loading ID requests…</p> : requests.length === 0 ? (
        <p className="ess-hr-empty">No employee ID changes are awaiting verification.</p>
      ) : requests.map((row) => (
        <article className="ess-hr-request" key={row.id}>
          <div className="ess-hr-request-row">
            <div>
              <strong>{row.employeeName}</strong>
              <small>{row.employeeNo} · {ESS_IDENTIFIER_FIELDS[row.kind].label} · submitted {new Date(row.requestedAt).toLocaleDateString("en-PH")}</small>
            </div>
            <span className="employee-status-pill warn">Pending verification</span>
          </div>
          <div className="ess-hr-identifier-masks">
            <div><span>On file</span><strong>{row.currentMasked || "Not on file"}</strong></div>
            <div><span>Proposed</span><strong>{row.proposedMasked || "••••"}</strong></div>
          </div>
          {selected === row.id ? (
            <div className="ess-hr-review-form">
              <p><ShieldCheck size={17} /> Verify against a trusted document, then type the full number from that document. For privacy, the employee's submitted full number is never displayed in this review list.</p>
              <label>Full verified {ESS_IDENTIFIER_FIELDS[row.kind].label}
                <input type="password" value={verifiedValue} autoComplete="off" onChange={(event) => setVerifiedValue(event.target.value)} placeholder={ESS_IDENTIFIER_FIELDS[row.kind].hint} />
              </label>
              <label className="ess-hr-verify-check">
                <input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} />
                <span>I independently checked this ID against an appropriate employee document.</span>
              </label>
              <label>Review note (required when rejecting)
                <textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Explain any missing or mismatched evidence. Do not include ID numbers." />
              </label>
              <div className="ess-hr-actions">
                <button type="button" className="secondary-button" disabled={saving} onClick={closeReview}>Cancel</button>
                <button type="button" className="secondary-button" disabled={saving || note.trim().length < 8} onClick={() => void decide(row.id, "reject")}>
                  <XCircle size={16} /> Reject
                </button>
                <button type="button" className="primary-button brand" disabled={saving || !verified || !verifiedValue.trim()} onClick={() => void decide(row.id, "approve")}>
                  <CheckCircle2 size={16} /> {saving ? "Verifying…" : "Verify & apply"}
                </button>
              </div>
            </div>
          ) : (
            <button className="secondary-button" type="button" onClick={() => { setSelected(row.id); setVerified(false); setVerifiedValue(""); setNote(""); setError(""); }}>
              <ShieldCheck size={16} /> Review request
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
