"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";

type Row = { id: number; status?: string; [key: string]: unknown };
type Payload = { records?: Row[]; events?: Row[]; cases?: Row[]; officers?: Array<{ userId: number; name: string }> };
type Flags = { dole: boolean; osh: boolean; cases: boolean };
const control = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const action = "rounded-md bg-emerald-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
const section = "rounded-xl border border-slate-200 bg-white p-5 shadow-sm";
const label = "mb-1 block text-xs font-medium text-slate-700";

function Input({ name, title, type = "text", required = false, hint, placeholder, maxLength, minLength, defaultValue }: {
  name: string; title: string; type?: string; required?: boolean; hint?: string; placeholder?: string;
  maxLength?: number; minLength?: number; defaultValue?: string;
}) {
  return <label className="block min-w-0">
    <span className={label}>{title}</span>
    <input className={control} name={name} type={type} required={required} placeholder={placeholder}
      maxLength={maxLength} minLength={minLength} defaultValue={defaultValue} aria-description={hint} />
    {hint ? <small className="mt-1 block text-slate-500">{hint}</small> : null}
  </label>;
}
function Pick({ name, title, options }: { name: string; title: string; options: Array<{ value: string; label: string }> }) {
  return <label className="block">
    <span className={label}>{title}</span>
    <select className={control} name={name} required defaultValue={options[0]?.value}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </label>;
}
function WorkflowForm({ organizationId, endpoint, method = "POST", onSaved, title, children }: {
  organizationId: number; endpoint: string; method?: "POST" | "PATCH";
  onSaved: () => Promise<void>; title: string; children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const body: Record<string, unknown> = Object.fromEntries(new FormData(form).entries());
    body.organizationId = organizationId;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(endpoint, {
        method, headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        cache: "no-store", body: JSON.stringify(body),
      });
      const result: { error?: string } = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Request rejected by the server.");
      form.reset();
      setNotice("Saved. Review the updated records below.");
      await onSaved();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Could not complete the action.");
    } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 p-4">
    <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
    <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    <button className={action} type="submit" disabled={busy}>{busy ? "Checking…" : "Save with audit"}</button>
    {notice ? <p role="status" className="text-sm text-slate-700">{notice}</p> : null}
  </form>;
}
function Records({ rows, fields }: { rows?: Row[]; fields: string[] }) {
  return <div className="mt-3 overflow-auto rounded-lg border border-slate-200">
    <table className="w-full min-w-[540px] text-left text-sm">
      <thead className="bg-slate-50 text-xs uppercase text-slate-600">
        <tr>{fields.map(f => <th key={f} className="px-3 py-2">{f.replaceAll(/([A-Z])/g, " $1")}</th>)}</tr>
      </thead>
      <tbody>{rows?.length ? rows.map((r, i) =>
        <tr key={r.id ?? i} className="border-t border-slate-200">
          {fields.map(f => <td key={f} className="px-3 py-2 text-slate-800">
            {r[f] == null ? "—" : String(r[f]).slice(0, 140)}</td>)}
        </tr>) : <tr><td colSpan={fields.length} className="px-3 py-5 text-slate-600">No accessible records yet.</td></tr>}
      </tbody>
    </table>
  </div>;
}
const reportOptions = [
  { value: "wair", label: "Work Accident / Illness Report" },
  { value: "telecommuting", label: "Telecommuting Report" },
  { value: "flexible_work", label: "Flexible Work Arrangements Report" },
  { value: "construction_safety", label: "Construction Safety and Health Program" },
  { value: "labor_inspection", label: "Labor Inspection supporting record" },
  { value: "other", label: "Other DOLE reporting evidence" },
];
const topics = [
  { value: "osh_orientation", label: "OSH orientation" },
  { value: "fire_safety", label: "Fire safety" },
  { value: "first_aid", label: "First aid" },
  { value: "harassment_prevention", label: "Harassment prevention" },
  { value: "other", label: "Other employer-reviewed training" },
];

export function WorkplaceComplianceConsole({ organizationId, enabled }: {
  organizationId: number; enabled: Flags;
}) {
  const [data, setData] = useState<Record<string, Payload>>({});
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState("");
  const reload = useCallback(async () => {
    setFailure("");
    const routes = [
      ...(enabled.dole ? [["dole", "/api/compliance/dole-extended"]] : []),
      ...(enabled.osh ? [
        ["osh", "/api/compliance/osh-events"], ["training", "/api/compliance/osh-training"],
      ] : []),
      ...(enabled.cases ? [
        ["cases", "/api/workplace/protected-cases"], ["officers", "/api/workplace/case-officers"],
      ] : []),
    ];
    try {
      const values = await Promise.all(routes.map(async ([key, endpoint]) => {
        const response = await fetch(endpoint + "?organizationId=" + organizationId, {
          cache: "no-store", credentials: "same-origin",
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(key + ": " + (result.error || "Access rejected"));
        return [key, result] as const;
      }));
      setData(Object.fromEntries(values));
    } catch (e) { setFailure(e instanceof Error ? e.message : "Could not verify permissions."); }
    finally { setLoading(false); }
  }, [organizationId, enabled.dole, enabled.osh, enabled.cases]);
  useEffect(() => { void reload(); }, [reload]);
  return <div className="space-y-5">
    <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      Pilot only. Confirm applicability and deadlines with Philippine counsel/OSH officers.
      Government files are submitted by the employer through official portals. Never enter
      medical diagnoses, government identifiers or allegation narratives in the ordinary event fields.
    </p>
    <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
      onClick={() => { setLoading(true); void reload(); }}>Refresh authorized records</button>
    {loading ? <p role="status">Checking enabled modules and employer access…</p> : null}
    {failure ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{failure}</p> : null}

    {enabled.dole ? <section className={section} aria-labelledby="ph-dole-title">
      <h2 id="ph-dole-title" className="mb-1 text-xl font-semibold">1 · DOLE reporting evidence</h2>
      <p className="mb-4 text-sm text-slate-600">Record source and submission evidence. Not a DOLE-authorized uploader.</p>
      <WorkflowForm title="New employer report" organizationId={organizationId}
        endpoint="/api/compliance/dole-extended" onSaved={reload}>
        <Pick name="reportType" title="Report type" options={reportOptions} />
        <Input name="statutoryBasisUrl" title="Reviewed official government source (HTTPS)" required type="url"
          placeholder="https://reports.dole.gov.ph/" />
        <Input name="periodStart" title="Period start" type="date" required />
        <Input name="periodEnd" title="Period end" type="date" required />
      </WorkflowForm>
      <Records rows={data.dole?.records} fields={["id", "reportType", "periodStart", "periodEnd", "status", "reviewedByUserId"]} />
      <div className="mt-4">
        <WorkflowForm title="Record an agency outcome or independent review" organizationId={organizationId}
          endpoint="/api/compliance/dole-extended" method="PATCH" onSaved={reload}>
          <Input name="id" title="Existing report ID" type="number" required />
          <Pick name="status" title="Next state" options={[
            { value: "submitted_recorded", label: "Submitted (operator-recorded)" },
            { value: "accepted_recorded", label: "Accepted (operator-recorded)" },
            { value: "rejected_recorded", label: "Rejected (operator-recorded)" },
            { value: "independently_reviewed", label: "Independently reviewed" },
          ]} />
          <Input name="portalReference" title="Actual portal acknowledgement reference" required />
          <Input name="receiptSha256" title="Receipt SHA-256 (private original)" required minLength={64} maxLength={64} />
        </WorkflowForm>
      </div>
    </section> : null}

    {enabled.osh ? <section className={section} aria-labelledby="osh-title">
      <h2 id="osh-title" className="mb-1 text-xl font-semibold">2 · OSH incidents and corrective actions</h2>
      <p className="mb-4 text-sm text-slate-600">
        Minimal safety metadata; store medical information and any evidence in separately controlled private storage.
      </p>
      <WorkflowForm title="Record a workplace safety event" organizationId={organizationId}
        endpoint="/api/compliance/osh-events" onSaved={reload}>
        <Input name="worksiteLabel" title="Worksite name (no personal details)" required maxLength={120} />
        <Input name="occurredOn" title="Event date" type="date" required />
        <Pick name="eventKind" title="Event category" options={[
          { value: "hazard", label: "Hazard" }, { value: "near_miss", label: "Near miss" },
          { value: "injury", label: "Injury (no diagnosis)" }, { value: "illness", label: "Illness (no diagnosis)" },
          { value: "other", label: "Other" },
        ]} />
        <Pick name="severity" title="Initial risk" options={["low","moderate","high","critical"].map(x => ({value:x,label:x}))} />
      </WorkflowForm>
      <Records rows={data.osh?.events} fields={["id","worksiteLabel","occurredOn","eventKind","severity","status"]} />
      <div className="mt-4">
        <WorkflowForm title="Update corrective action (independent closure)" organizationId={organizationId}
          endpoint="/api/compliance/osh-events" method="PATCH" onSaved={reload}>
          <Input name="id" title="Safety event ID" type="number" required />
          <Pick name="status" title="Next status" options={[
            { value: "mitigating", label: "Mitigating" }, { value: "resolved", label: "Resolved after review" },
          ]} />
          <Input name="correctiveActionRef" title="Private corrective-action reference" />
          <Input name="evidenceSha256" title="Private evidence SHA-256" maxLength={64} />
        </WorkflowForm>
      </div>
      <h2 className="mb-3 mt-8 text-lg font-semibold">Mandatory training records</h2>
      <WorkflowForm title="Record a reviewed training completion" organizationId={organizationId}
        endpoint="/api/compliance/osh-training" onSaved={reload}>
        <Input name="employeeId" title="Employee ID in this legal employer" type="number" required />
        <Pick name="topic" title="Training topic" options={topics} />
        <Input name="courseTitle" title="Course or briefing title" required />
        <Input name="providerName" title="Training provider (optional)" />
        <Input name="completedOn" title="Completion date" type="date" required />
        <Input name="expiresOn" title="Expiry date, only if verified" type="date" />
        <Input name="evidenceSha256" title="Private training proof SHA-256" maxLength={64} />
        <Input name="requirementSource" title="Applicable source (HTTPS, optional)" type="url" />
      </WorkflowForm>
      <Records rows={data.training?.records} fields={["id","employeeId","topic","courseTitle","completedOn","expiresOn","verifiedAt"]} />
      <div className="mt-4">
        <WorkflowForm title="Independent verification of existing training proof" organizationId={organizationId}
          endpoint="/api/compliance/osh-training" method="PATCH" onSaved={reload}>
          <input name="action" type="hidden" value="verify" />
          <Input name="id" title="Training record ID" type="number" required />
        </WorkflowForm>
      </div>
    </section> : null}

    {enabled.cases ? <section className={section} aria-labelledby="cases-title">
      <h2 id="cases-title" className="mb-1 text-xl font-semibold">3 · Confidential workplace investigations</h2>
      <p className="mb-3 text-sm text-slate-600">
        Only complaint creators and named, active case officers see their own case contents.
        Ordinary HR access is insufficient. Human CODI governance and due process remain outside this pilot.
      </p>
      <p className="mb-4 text-sm"><Link href="/self/workplace-concern"
        className="font-semibold text-emerald-800 underline">Open the employee confidential intake page</Link></p>
      <h3 className="text-base font-semibold">Appointed intake officers</h3>
      <p className="my-2 text-sm text-slate-600">{data.officers?.officers?.length
        ? data.officers.officers.map(p => p.name + " (#" + p.userId + ")").join(" · ")
        : "No eligible officers on record."}</p>
      <WorkflowForm title="Owner/admin officer appointment" organizationId={organizationId}
        endpoint="/api/workplace/case-officers" onSaved={reload}>
        <Input name="userId" title="Existing active employer user ID" type="number" required />
        <Pick name="action" title="Officer action" options={[
          { value: "appoint", label: "Appoint" }, { value: "revoke", label: "Revoke, if no open cases" },
        ]} />
      </WorkflowForm>
      <p className="mb-2 mt-6 text-xs font-semibold uppercase text-slate-700">Assigned/private case list</p>
      <Records rows={data.cases?.cases} fields={["id","caseKind","status","investigatorUserId","reviewerUserId","createdAt"]} />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <WorkflowForm title="Investigator assigns independent reviewer" organizationId={organizationId}
          endpoint="/api/workplace/protected-cases" method="PATCH" onSaved={reload}>
          <input type="hidden" name="action" value="assign_reviewer" />
          <Input name="id" title="Assigned case ID" type="number" required />
          <Input name="reviewerUserId" title="Independent appointed reviewer user ID" type="number" required />
        </WorkflowForm>
        <WorkflowForm title="Record the authorized case step" organizationId={organizationId}
          endpoint="/api/workplace/protected-cases" method="PATCH" onSaved={reload}>
          <input type="hidden" name="action" value="transition" />
          <Input name="id" title="Assigned case ID" type="number" required />
          <Pick name="status" title="Next case state" options={[
            { value: "investigating", label: "Investigating" },
            { value: "review_pending", label: "Review pending" }, { value: "closed", label: "Closed by reviewer" },
          ]} />
          <Input name="evidenceSha256" title="Private external evidence SHA-256" maxLength={64} />
        </WorkflowForm>
      </div>
      {data.cases?.cases?.length ? <div className="mt-4 rounded-lg border border-amber-200 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Private statements — assigned access only</h3>
        <p className="my-2 text-xs text-slate-600">Only disclose on a trusted screen. Never copy into shared audit tickets.</p>
        {data.cases.cases.map(r => <details className="my-2 rounded-md border p-3" key={r.id}>
          <summary className="cursor-pointer text-sm font-semibold">Case #{r.id} · restricted statement</summary>
          <p className="mt-3 whitespace-pre-wrap text-sm text-slate-800">{String(r.statement ?? "")}</p>
        </details>)}
      </div> : null}
    </section> : null}
  </div>;
}
