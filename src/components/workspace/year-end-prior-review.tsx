"use client";
import { useRef, useState } from "react";
import type { PriorEvidence } from "@/lib/year-end-prior-evidence";
export const blankPriorEvidence: PriorEvidence = { status: "none-confirmed", employerName: "", employerTin: "", periodFrom: "", periodTo: "", taxableIncome: "0.00", taxWithheld: "0.00", exemptBenefits: "0.00", sourceReference: "", sourceSha256: "", peraCredit: "0.00", peraReference: "", peraSha256: "" };
const fields: [keyof PriorEvidence, string][] = [
  ["employerName", "Previous employer registered name"], ["employerTin", "Previous employer TIN (9 digits-4 digits)"],
  ["periodFrom", "Previous employment start (YYYY-MM-DD)"], ["periodTo", "Previous employment end (YYYY-MM-DD)"],
  ["taxableIncome", "Previous employer taxable income (2316 item 21)"], ["taxWithheld", "Previous employer tax withheld (2316 item 25A)"],
  ["exemptBenefits", "Previous employer exempt 13th month / benefits (2316 item 34)"],
  ["sourceReference", "Private 2316 or no-prior-employer declaration reference"], ["sourceSha256", "SHA-256 of the reviewed source document"],
  ["peraCredit", "Verified PERA tax credit amount (not contribution)"], ["peraReference", "Private PERA tax credit evidence reference (if nonzero)"], ["peraSha256", "SHA-256 of PERA evidence (if nonzero)"],
];
type RecordState = { evidence: PriorEvidence; digest: string; revision: number; approved: boolean; makerUserId: number };
export function YearEndPriorReview({ organizationId, userId, employeeId: initialEmployeeId = "", taxYear: initialYear = "2026" }: { organizationId: number; userId: number; employeeId?: string; taxYear?: string }) {
  const [employeeId, setEmployeeId] = useState(initialEmployeeId), [taxYear, setTaxYear] = useState(initialYear);
  const [evidence, setEvidence] = useState<PriorEvidence>({ ...blankPriorEvidence });
  const [record, setRecord] = useState<RecordState | null>(null), [loadedScope, setLoadedScope] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const scope = `organizationId=${organizationId}&employeeId=${encodeURIComponent(employeeId)}&taxYear=${encodeURIComponent(taxYear)}`;
  const loaded = loadedScope === scope;
  const dirty = JSON.stringify(evidence) !== JSON.stringify(record?.evidence ?? blankPriorEvidence);
  async function act(action: "load" | "save" | "approve") {
    setBusy(true); setError(""); setNotice("");
    try {
      const url = `/api/year-end/prior-evidence?${scope}`;
      if (action !== "load") {
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, evidence, expectedDigest: record?.digest ?? "" }) });
        const body = await response.json(); if (!response.ok) throw new Error(body.code ?? body.error ?? "Unable to save evidence.");
      }
      const response = await fetch(url, { cache: "no-store" });
      const body = await response.json(); if (!response.ok) throw new Error(body.code ?? body.error ?? "Unable to load evidence.");
      setRecord(body.record); setEvidence(body.record?.evidence ?? { ...blankPriorEvidence }); setLoadedScope(scope);
      setNotice(action === "approve" ? "Approved. Annualization must be recomputed before this evidence can be bound to payroll." : action === "save" ? "Draft saved. A different payroll operator must approve this exact source." : body.record ? "Current source loaded." : "No evidence yet. Record an explicit declaration or previous-employer certificate.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to complete request."); requestAnimationFrame(() => errorRef.current?.focus()); }
    finally { setBusy(false); }
  }
  return <main className="prior-review">
    <a href="/workspace">← Payroll workspace</a><h1>Previous employer &amp; PERA review</h1>
    <p>For year-end annualization from 2023 onward. Use the employee’s reviewed previous 2316 and any PERA tax credit certificate. No document is uploaded here; keep evidence in your approved private store. A reference and hash identify it, but do not independently verify it.</p>
    <p>Sequential prior employment only. MWE, multi-entity and excess prior-credit cases require separate tax review. This is not certificate issuance or filing approval.</p>
    <div className="prior-grid"><label>Employee ID<input value={employeeId} onChange={e => setEmployeeId(e.target.value)} inputMode="numeric" disabled={busy} /></label><label>Tax year<input value={taxYear} onChange={e => setTaxYear(e.target.value)} inputMode="numeric" disabled={busy} /></label></div>
    <button disabled={busy} onClick={() => act("load")}>{busy ? "Working…" : "Load evidence"}</button>
    {error && <p role="alert" tabIndex={-1} ref={errorRef} className="prior-error">{error}</p>}
    <p role="status" aria-live="polite">{notice}</p>
    {loaded && <><p><strong>{record ? `Revision ${record.revision} · ${record.approved ? "Approved" : "Awaiting independent checker"}` : "New draft"}</strong></p>
      <fieldset disabled={busy}><legend>Source evidence</legend>
        <label>Previous-employer status<select value={evidence.status} onChange={e => setEvidence({ ...evidence, status: e.target.value as PriorEvidence["status"] })}><option value="none-confirmed">Confirmed no previous employer (declaration required)</option><option value="verified">Previous certificate reviewed</option></select></label>
        <div className="prior-grid">{fields.map(([key, label]) => <label key={key}>{label}<input value={evidence[key]} onChange={e => setEvidence({ ...evidence, [key]: e.target.value })} autoComplete="off" spellCheck={false} maxLength={key.toLowerCase().includes("sha256") ? 64 : 160} /></label>)}</div>
      </fieldset>
      <p>Saving a revision clears approval. Bound or settled adjustments cannot be changed here. Zero PERA must be explicit; leave its reference and hash empty.</p>
      <div className="prior-actions"><button disabled={busy || !loaded || (!dirty && !!record)} onClick={() => act("save")}>Save draft / revision</button><button disabled={busy || !record || record.approved || record.makerUserId === userId || dirty} onClick={() => act("approve")}>Approve exact source</button></div>
      {record?.makerUserId === userId && <p>A different authorized payroll operator must check your draft.</p>}</>}
    <style>{`.prior-review{max-width:960px;margin:40px auto;padding:24px;color:#122b45;background:#fff;font:16px/1.6 Arial,sans-serif}.prior-review *{box-sizing:border-box;min-width:0}.prior-review h1{font-size:30px;line-height:1.2}.prior-review a{color:#0059b3}.prior-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.prior-review label{display:flex;flex-direction:column;gap:6px;margin:10px 0;font-weight:600}.prior-review input,.prior-review select{width:100%;max-width:100%;padding:12px;border:1px solid #718398;border-radius:6px;background:white;color:#122b45;font:inherit}.prior-review fieldset{min-inline-size:0;border:1px solid #b3c4d4;padding:18px}.prior-review button{background:#0061c4;color:white;border:0;border-radius:6px;padding:12px 18px;font:inherit;cursor:pointer}.prior-review button:disabled{background:#dce4ed;color:#475a70;cursor:default}.prior-review :focus-visible{outline:3px solid #00856d;outline-offset:3px}.prior-error{background:#fff0ef;color:#8b180c;padding:14px}.prior-actions{display:flex;flex-wrap:wrap;gap:12px}@media(max-width:600px){.prior-review{margin:0;padding:20px}.prior-grid{grid-template-columns:1fr}.prior-review h1{font-size:26px}}`}</style>
  </main>;
}
