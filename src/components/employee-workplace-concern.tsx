"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { PrivateWorkplaceStatement } from "@/components/private-workplace-statement";
type Officer = { userId: number; name: string };
type CaseRecord = { id: number; status: string; caseKind: string; incidentOn: string | null;
  createdAt: string };
const fieldClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const kinds = [
  ["gender_based_harassment", "Gender-based harassment"],
  ["other_harassment", "Other workplace harassment"],
  ["retaliation", "Retaliation"],
  ["other", "Other workplace concern"],
] as const;

export function EmployeeWorkplaceConcern({ organizationId }: { organizationId: number }) {
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [kind, setKind] = useState("gender_based_harassment");
  const [officerId, setOfficerId] = useState("");
  const [incidentOn, setIncidentOn] = useState("");
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const reload = useCallback(async () => {
    const [officerResponse, caseResponse] = await Promise.all([
      fetch("/api/workplace/case-officers?organizationId=" + organizationId, { cache: "no-store" }),
      fetch("/api/workplace/protected-cases?organizationId=" + organizationId, { cache: "no-store" }),
    ]);
    const a = await officerResponse.json().catch(() => ({}));
    const b = await caseResponse.json().catch(() => ({}));
    if (!officerResponse.ok || !caseResponse.ok) throw new Error(a.error || b.error || "Could not verify access.");
    setOfficers(a.officers || []);
    setCases(b.cases || []);
  }, [organizationId]);
  useEffect(() => {
    let active = true;
    const handle = window.setTimeout(() => {
      void reload().catch(e => { if (active) setError(e instanceof Error ? e.message : "Failed to load."); });
    }, 0);
    return () => { active = false; window.clearTimeout(handle); };
  }, [reload]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/workplace/protected-cases", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({
          organizationId, caseKind: kind, investigatorUserId: Number(officerId),
          incidentOn: incidentOn || null, statement,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Case intake refused.");
      setStatement(""); setIncidentOn(""); setNotice("Your case #" + result.caseId +
        " was recorded. Please save this number and contact the appointed officer through your employer's protected channel.");
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not submit."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-5">
    <aside className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      Do not use this form if you require immediate emergency assistance. Follow your employer&apos;s
      safety and independent CODI reporting instructions. Sensitive attachments are not accepted
      here; use the approved private evidence channel. Submission is authenticated, not anonymous.
    </aside>
    <form onSubmit={submit} className="space-y-4 rounded-xl border bg-white p-5">
      <h2 className="text-lg font-semibold">New protected concern</h2>
      <label className="block text-sm">Type of concern
        <select className={fieldClass + " mt-1"} value={kind} onChange={e => setKind(e.target.value)} required>
          {kinds.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
        </select>
      </label>
      <label className="block text-sm">Appointed independent intake officer
        <select className={fieldClass + " mt-1"} value={officerId}
          onChange={e => setOfficerId(e.target.value)} required>
          <option value="">Choose a designated officer</option>
          {officers.map(o => <option key={o.userId} value={o.userId}>{o.name}</option>)}
        </select>
      </label>
      <label className="block text-sm">Incident date (optional)
        <input className={fieldClass + " mt-1"} type="date" value={incidentOn}
          onChange={e => setIncidentOn(e.target.value)} />
      </label>
      <label className="block text-sm">Confidential statement
        <textarea className={fieldClass + " mt-1"} value={statement} required minLength={20}
          maxLength={4000} rows={7} onChange={e => setStatement(e.target.value)}
          placeholder="Describe the concern in your own words. Do not include bank passwords or unnecessary government IDs." />
        <span className="mt-1 block text-xs text-slate-500">20–4000 characters. Protected before database storage.</span>
      </label>
      <button type="submit" className="rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
        disabled={busy || officers.length === 0}>{busy ? "Encrypting and recording…" : "Submit confidential case"}</button>
      {officers.length === 0 ? <p className="text-sm text-amber-900">
        No approved intake officer is available. Contact the employer&apos;s independent complaint channel.
      </p> : null}
      {notice ? <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm">{notice}</p> : null}
      {error ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    </form>
    <section className="rounded-xl border bg-white p-5">
      <h2 className="text-lg font-semibold">My submitted concerns</h2>
      <p className="my-2 text-xs text-slate-600">Only your own authorized cases. Open private statements on a trusted device.</p>
      {cases.length ? cases.map(c => <details key={c.id} className="my-2 rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-semibold">Case #{c.id} · {c.status}</summary>
        <PrivateWorkplaceStatement organizationId={organizationId} caseId={c.id} />
      </details>) : <p className="mt-2 text-sm text-slate-600">No case recorded in this account.</p>}
    </section>
  </div>;
}
