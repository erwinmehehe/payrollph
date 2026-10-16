"use client";
import { useEffect, useRef, useState } from "react";
import { CERTIFICATE_ITEMS, CERTIFICATE_LABELS, CERTIFICATE_TEXT_FIELDS, type CertificateSource } from "@/lib/bir-2316-certificate";
export function Certificate2316Review({ organizationId, initialEmployeeId, initialTaxYear, separationId }: { organizationId: number; initialEmployeeId: string; initialTaxYear: string; separationId?: string }) {
  const [employeeId, setEmployeeId] = useState(initialEmployeeId), [year, setYear] = useState(initialTaxYear);
  const [source, setSource] = useState<CertificateSource | null>(null), [text, setText] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<Record<string, string>>({}), [previous, setPrevious] = useState<Record<string, string>>({ status: "" });
  const [pera, setPera] = useState(""), [type, setType] = useState(""), [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [download, setDownload] = useState("");
  const alert = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);
  useEffect(() => () => { if (download) URL.revokeObjectURL(download); }, [download]);
  const url = () => "/api/year-end/2316-certificate?" + new URLSearchParams({ organizationId: String(organizationId), employeeId, taxYear: year, ...(separationId ? { separationId } : {}) });
  const reset = () => { setSource(null); setDownload(""); setText({}); setDetails({}); setPrevious({ status: "" }); setPera(""); setType(""); setAck(false); setError(""); };
  async function load() {
    reset(); setBusy(true);
    try { const response = await fetch(url(), { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw Error(data.error + (data.code ? " (" + data.code + ")" : "")); setSource(data.source); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load source. Retry."); } finally { setBusy(false); }
  }
  async function generate(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setDownload("");
    try {
      const response = await fetch(url(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ review: { text, detailItems: details, previousEmployer: previous, peraCredit: pera, employerType: type, acknowledged: ack } }) });
      if (!response.ok) { const data = await response.json(); throw Error([data.error, ...(data.issues ?? []), data.code].filter(Boolean).join(" · ")); }
      setDownload(URL.createObjectURL(await response.blob()));
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to generate preview. Retry."); } finally { setBusy(false); }
  }
  const label = (name: string, key: string, value: string, update: (value: string) => void, required = true) => <label key={key} className="certificate-field">{name}<input name={key} value={value} required={required} maxLength={120} onChange={e => { update(e.target.value); setDownload(""); }} /></label>;
  return <main className="certificate-page">
    <style>{`.certificate-page{max-width:1080px;margin:32px auto;padding:24px;color:#142f50;background:white;font:16px/1.55 Arial,sans-serif}.certificate-page h1{font-size:30px}.certificate-page fieldset{border:1px solid #c6d5e2;border-radius:12px;margin:24px 0;padding:20px}.certificate-page legend{font-weight:700;padding:0 8px}.certificate-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.certificate-field{display:flex;flex-direction:column;gap:6px}.certificate-page input,.certificate-page select{min-height:44px;padding:8px;border:1px solid #879bb1;border-radius:6px;background:white;color:#142f50;font:inherit;min-width:0}.certificate-page button,.certificate-download{display:inline-block;min-height:44px;padding:10px 18px;border:0;border-radius:7px;background:#0069df;color:white;font:inherit;cursor:pointer}.certificate-page button:disabled{opacity:.6}.certificate-notice{padding:16px;background:#edf8f5;border-left:4px solid #008563}.certificate-error{padding:16px;border:2px solid #a21b2d;overflow-wrap:anywhere}.certificate-page :focus-visible{outline:3px solid #0069df;outline-offset:3px}.certificate-page input[type=checkbox]{min-height:auto}.certificate-summary{overflow-wrap:anywhere}@media(max-width:600px){.certificate-page{margin:0;padding:16px}.certificate-grid{grid-template-columns:1fr}.certificate-page h1{font-size:25px}.certificate-page fieldset{padding:14px}}`}</style>
    <a href={`/app?organizationId=${organizationId}`}>← Back to payroll workspace</a>
    <h1>Prepare an unsigned Form 2316</h1>
    <p className="certificate-notice">Uses the September 2021 BIR template. This is a preparer preview. It does not approve payroll, sign a certificate or elect substituted filing. Entries stay in memory and are cleared when you leave.</p>
    <fieldset disabled={busy}><legend>1. Select released payroll evidence</legend><div className="certificate-grid">
      {label("Employee ID", "employeeId", employeeId, v => { reset(); setEmployeeId(v); })}
      {label("Tax year", "taxYear", year, v => { reset(); setYear(v); })}
    </div><p><button type="button" onClick={load}>Load source records</button></p></fieldset>
    {busy && <p role="status">Checking records and preparing your preview…</p>}
    {error && <div className="certificate-error" tabIndex={-1} ref={alert} role="alert">{error}</div>}
    {!source && !busy && <p>Select an employee and year to begin. Recent MFA and company-wide payroll access are required.</p>}
    {source && <form onSubmit={generate}>
      <section className="certificate-summary" aria-label="Server payroll evidence"><h2>{source.employeeName}</h2><p>{source.employerName} · {source.periodFrom} to {source.periodTo}</p><p>Posted present-employer withholding: {source.withholding?.actualPresentWithheld ?? "UNVERIFIED"}</p><p>Source warnings: {source.withholding?.issues.join(", ") || "None reported"}</p><p>Review each figure against your source documents. Mapping entries never change payroll or the employee record.</p></section>
      <fieldset disabled={busy}><legend>2. Identity and supporting references</legend><div className="certificate-grid">
        {Object.entries(CERTIFICATE_TEXT_FIELDS).map(([key, name]) => label(name, key, text[key] ?? "", v => setText(s => ({ ...s, [key]: v })), !["foreignAddress", "44A", "44B", "51A", "51B"].includes(key)))}
        <label className="certificate-field">Employer type<select required value={type} onChange={e => { setType(e.target.value); setDownload(""); }}><option value="">Choose explicitly</option><option value="main">Main employer</option><option value="secondary">Secondary employer</option></select></label>
      </div></fieldset>
      <fieldset disabled={busy}><legend>3. Compensation categories — enter every amount, including zero</legend><div className="certificate-grid">
        {CERTIFICATE_ITEMS.map(key => label(`Item ${key}: ${CERTIFICATE_LABELS[key]} (PHP)`, "item" + key, details[key] ?? "", v => setDetails(s => ({ ...s, [key]: v }))))}
      </div></fieldset>
      <fieldset disabled={busy}><legend>4. Previous employer and PERA</legend><label className="certificate-field">Previous employer review<select required value={previous.status} onChange={e => { setPrevious({ status: e.target.value }); setDownload(""); }}><option value="">Review required</option><option value="none-confirmed">Confirmed no previous employer in this year</option><option value="verified">Previous 2316 reviewed</option></select></label>
        {previous.status === "verified" && <div className="certificate-grid">{Object.entries({ name: "Previous employer name", tin: "Previous employer TIN (9 digits-4 digits)", address: "Previous registered address", zip: "Previous ZIP", reference: "Previous 2316 evidence reference", taxableCompensation: "Previous taxable compensation (PHP)", taxWithheld: "Previous tax withheld (PHP)" }).map(([key, name]) => label(name, "previous" + key, previous[key] ?? "", v => setPrevious(s => ({ ...s, [key]: v }))))}</div>}
        <p>Prior compensation and PERA must reconcile to the existing annualization. This screen does not recompute tax or repair missing source intake.</p>
        {label("PERA tax credit (PHP; enter 0 only when confirmed)", "pera", pera, setPera)}
      </fieldset>
      <label><input type="checkbox" required checked={ack} onChange={e => { setAck(e.target.checked); setDownload(""); }} /> I checked the mapping and references. I understand this PDF is unsigned and still needs responsible employer and employee review.</label>
      <p><button disabled={busy} type="submit">Check totals and generate unsigned PDF</button></p>
      {download && <p role="status"><a className="certificate-download" href={download} download={`bir-2316-unsigned-${year}.pdf`}>Download unsigned PDF</a></p>}
    </form>}
  </main>;
}
