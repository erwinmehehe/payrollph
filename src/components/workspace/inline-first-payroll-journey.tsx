"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { buildFirstPayrollJourney, FIRST_PAYROLL_STEPS, validJourneySchedule, journeyRoleCanReviewTime, type FirstPayrollJourneyStep, type JourneySchedule } from "@/lib/first-payroll-journey";
import type { FirstPayrollReadiness } from "@/lib/first-payroll-readiness";
import type { firstPayrollPreviewResult } from "@/lib/first-payroll-preview";
import { AttendanceLockControl } from "./attendance-lock-control";
import type { Notify } from "./types";

type StepKey = FirstPayrollJourneyStep["key"];
type Snapshot = {
  company: { name: string; legalName: string; birTin: string | null; payrollCalendarMode: string };
  role: string;
  timeReviewed: boolean;
  readiness: FirstPayrollReadiness;
  memberships: { name: string; role: string }[];
  progress: { step: string; ownerRole: string; updatedBy: string; updatedAt: string; data: { schedule?: JourneySchedule } }[];
};
type Preview = ReturnType<typeof firstPayrollPreviewResult>;

export function InlineFirstPayrollJourney({ organizationId, workflows, onRefresh, notify, revision }: {
  organizationId: number;
  revision: string;
  workflows: Partial<Record<StepKey, ReactNode>>;
  onRefresh: () => Promise<void>;
  notify: Notify;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [active, setActive] = useState<StepKey | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [birTin, setBirTin] = useState("");
  const [schedule, setSchedule] = useState<JourneySchedule>({ periodStart: "", periodEnd: "", payDate: "" });
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("payroll");
  const panelRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch(`/api/first-payroll-journey?organizationId=${organizationId}`, { cache: "no-store", signal });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Could not resume first payroll.");
    return body as Snapshot;
  }, [organizationId]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).then(body => {
      if (controller.signal.aborted) return;
      setSnapshot(body); setPreview(null);
      setName(body.company.name); setLegalName(body.company.legalName); setBirTin(body.company.birTin ?? "");
      setSchedule(body.progress.find(p => p.step === "company")?.data.schedule ?? { periodStart: "", periodEnd: "", payDate: "" });
      const assigned = body.progress.filter(p => p.ownerRole === body.role).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (assigned && FIRST_PAYROLL_STEPS.some(s => s.key === assigned.step)) setActive(current => current ?? assigned.step as StepKey);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [load, revision]);
  useEffect(() => { if (active) panelRef.current?.focus(); }, [active]);
  async function request(url: string, method: string, body?: object) {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify({ organizationId, ...body }) } : {}) });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error ?? "Action failed.");
    return payload;
  }
  async function mutate(action: () => Promise<unknown>) {
    setBusy(true); setError(""); setPreview(null);
    try { await action(); setSnapshot(await load()); await onRefresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Action failed."); }
    finally { setBusy(false); }
  }
  async function inspect() {
    setBusy(true); setError(""); setPreview(null);
    try { setPreview(await request(`/api/first-payroll-journey/preview?organizationId=${organizationId}`, "GET")); }
    catch (e) { setError(e instanceof Error ? e.message : "Preview failed."); }
    finally { setBusy(false); }
  }
  if (!snapshot) return <section aria-label="Inline first payroll"><p role="status">{error || "Loading tenant journey…"}</p></section>;
  const storedSchedule = snapshot.progress.find(p => p.step === "company")?.data.schedule;
  const steps = buildFirstPayrollJourney(snapshot.readiness).map(step => {
    if (step.key === "company" && !validJourneySchedule(storedSchedule)) return { ...step, state: "available" as const };
    if (step.key === "time" && snapshot.timeReviewed) return { ...step, state: "complete" as const };
    return step;
  });
  const canConfigure = ["owner", "admin", "bookkeeper"].includes(snapshot.role);
  const canInspect = ["owner", "admin", "bookkeeper", "payroll"].includes(snapshot.role);
  const selected = steps.find(s => s.key === active);
  return <section className="first-payroll-card" aria-label="Inline first payroll journey">
    <h2>Your first payroll</h2>
    <p>Work here with your team. Progress and handoffs are shared across this employer. Preview is a read-only dry run; payment needs independent approval.</p>
    <ol className="grid gap-3 md:grid-cols-2" style={{ listStyle: "none", padding: 0 }}>
      {steps.map(step => {
        const progress = snapshot.progress.find(p => p.step === step.key);
        const role = progress?.ownerRole ?? step.ownerRole;
        const names = snapshot.memberships.filter(m => m.role === role).map(m => m.name);
        return <li key={step.key} className="rounded-xl border p-4">
          <h3>{step.title}</h3><p>{step.detail}</p><p className="text-xs">{step.state === "complete" ? "Recorded" : step.key === "time" ? "Authorized human review needed" : "Remaining"}</p>
          <p className="text-sm">Owner: {role} · {names.join(", ") || "No member assigned"}</p>
          {progress && <p className="text-xs">Last updated by {progress.updatedBy}</p>}
          <button type="button" className="secondary-button" aria-expanded={active === step.key} aria-controls="first-payroll-panel" onClick={() => { setActive(step.key); setPreview(null); }}>{step.actionLabel}</button>
          {step.state !== "complete" && <button type="button" disabled={busy} className="first-payroll-link" onClick={() => void mutate(() => request("/api/first-payroll-journey", "PATCH", { step: step.key, ownerRole: step.ownerRole }))}>Send to {step.ownerRole}</button>}
        </li>;
      })}
    </ol>
    {error && <p role="alert">{error}</p>}
    {selected && <div id="first-payroll-panel" role="region" aria-label={selected.title} tabIndex={-1} ref={panelRef} className="rounded-xl border p-4">
      <button type="button" className="secondary-button" onClick={() => setActive(null)}>Close panel</button>
      <h3>{selected.title}</h3>
      {active === "company" && <form onSubmit={e => { e.preventDefault(); void mutate(async () => {
        if (!validJourneySchedule(schedule)) throw new Error("Choose a complete semi-monthly cutoff and a pay date on or after cutoff end.");
        await request("/api/organizations", "PUT", { name, legalName, birTin, payrollCalendarMode: "ph_semi_monthly" });
        await request("/api/first-payroll-journey", "PATCH", { step: "company", schedule });
      }); }}>
        <div className="setting-form">
          <label>Company name<input required value={name} onChange={e => setName(e.target.value)} /></label>
          <label>Legal employer name<input required value={legalName} onChange={e => setLegalName(e.target.value)} /></label>
          <label>Employer TIN<input value={birTin} onChange={e => setBirTin(e.target.value)} /></label>
          {(["periodStart", "periodEnd", "payDate"] as const).map(key => <label key={key}>{key === "periodStart" ? "Cutoff start" : key === "periodEnd" ? "Cutoff end" : "Pay date"}<input required type="date" value={schedule[key]} onChange={e => setSchedule({ ...schedule, [key]: e.target.value })} /></label>)}
        </div>
        <p>Philippine semi-monthly schedule: 1st–15th or 16th–month end.</p>
        {!canConfigure && <p>Send employer setup to the owner or administrator.</p>}
        <button disabled={busy || !canConfigure} className="primary-button">Save company and pay schedule</button>
      </form>}
      {active === "reviewers" && <form onSubmit={e => { e.preventDefault(); void mutate(async () => { await request("/api/invitations", "POST", { email: inviteEmail, role: inviteRole }); setInviteEmail(""); notify("Invitation created. Roles become ready after acceptance.", "ok"); }); }}>
        <p>Invite a Payroll Officer and a separate Checker. Existing maker-checker controls remain required.</p>
        <label>Work email<input required type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} /></label>
        <label>Role<select value={inviteRole} onChange={e => setInviteRole(e.target.value)}><option value="payroll">Payroll Officer</option><option value="checker">Independent Checker</option><option value="hr">HR</option><option value="bookkeeper">Finance / Bookkeeper</option></select></label>
        {!canConfigure && <p>Only a workspace administrator can invite reviewers.</p>}
        <button disabled={busy || !canConfigure} className="primary-button">Invite reviewer</button>
        <ul>{snapshot.memberships.map((m, i) => <li key={i}>{m.name}: {m.role}</li>)}</ul>
      </form>}
      {active === "time" && <>
        <p>Attendance must be reviewed and locked by an authorized human for this specific cutoff.</p>
        {workflows.time}
        {storedSchedule && journeyRoleCanReviewTime(snapshot.role) ? <AttendanceLockControl organizationId={organizationId} startDate={storedSchedule.periodStart} endDate={storedSchedule.periodEnd} notify={(message, tone) => { notify(message, tone); void load().then(setSnapshot).catch(e => setError(e.message)); }} /> : <p>{storedSchedule ? "Send to HR for an authorized cutoff review." : "Save the pay schedule in company setup first."}</p>}
      </>}
      {active === "people" && workflows.people}
      {active === "payroll" && <>
        <h4>First payroll preview</h4>
        <button className="primary-button" type="button" disabled={busy || !canInspect} onClick={() => void inspect()}>Calculate read-only preview</button>
        {!canInspect && <p>Send this step to payroll or finance to inspect employee pay.</p>}
        {preview && <>
          <p role="status">{preview.previewReady ? "Preview ready" : "Preview has blockers"}. No payroll run or ledger entry was created.</p>
          <ul aria-label="Preview blockers">{preview.blockers.map(b => <li key={b}>{b}</li>)}</ul>
          <div style={{ overflowX: "auto" }}><table><caption>Employee dry-run amounts (PHP)</caption><thead><tr>{["Employee", "Gross", "SSS", "PhilHealth", "Pag-IBIG", "Withholding tax", "Net"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{preview.rows.map(r => <tr key={r.employeeId}><th scope="row">{r.name}</th>{[r.gross, r.sss, r.philHealth, r.pagIbig, r.withholding, r.net].map((v, i) => <td key={i}>{v.toFixed(2)}</td>)}</tr>)}</tbody></table></div>
        </>}
        <p>Create a real draft only when you intend to enter the governed payroll workflow.</p>
        {workflows.payroll}
      </>}
      {active === "approval" && workflows.approval}
      {active === "exports" && workflows.exports}
    </div>}
  </section>;
}
