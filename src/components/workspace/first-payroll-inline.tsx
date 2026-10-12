"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApprovalsView } from "@/components/workspace/approvals";
import { ExportsView } from "@/components/workspace/exports";
import { PeopleView } from "@/components/workspace/people";
import { SettingsPage } from "@/components/workspace/panels";
import { TimeView } from "@/components/workspace/time";
import { WorkforceTimesheetPanel } from "@/components/workspace/workforce-timesheet-panel";
import { AttendanceLockControl } from "@/components/workspace/attendance-lock-control";
import { buildFirstPayrollJourney, type FirstPayrollJourneyStep } from "@/lib/first-payroll-journey";
import { FIRST_PAYROLL_OWNER, type FirstPayrollKey } from "@/lib/first-payroll-ownership";
import { validFirstPayrollPreviewDates, type FirstPayrollPreview } from "@/lib/first-payroll-preview-contract";
import type { DashboardData, Notify } from "@/components/workspace/types";
import type { FirstPayrollReadiness } from "@/lib/first-payroll-readiness";
import { manilaCalendarDate } from "@/lib/payroll-period-ui";

type Assignment = { caseId?: number; id: number; step: FirstPayrollKey | null; ownerTeam: string; status: string };
type Employer = { id: number; code: string; displayName: string; primaryEntity: boolean };
type Props = {
  data: DashboardData;
  readiness: FirstPayrollReadiness;
  notify: Notify;
  onRefresh: () => Promise<void>;
  onAddEmployee: () => void;
  onOpenBundy: () => void;
  onDecide: (id: number, decision: "Approved" | "Declined") => Promise<void>;
  onCreatePayroll: (input: {
    periodStart: string; periodEnd: string; payDate: string; scopeOrgUnitId: number | null;
    legalEntityId: number; processNow?: boolean; stayOnJourney?: boolean;
  }) => Promise<void>;
  busy: boolean;
  canManagePeople: boolean;
  canManageTime: boolean;
  canManagePayroll: boolean;
  allowedPages: readonly string[];
  canDecideApprovals: boolean;
  canManageDelegations: boolean;
};

function defaultDates() {
  const today = manilaCalendarDate();
  const day = Number(today.slice(8,10));
  const yearMonth = today.slice(0,7);
  const lastDay = new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7)),0))
    .toISOString().slice(0,10);
  return {
    start: day <= 15 ? yearMonth + "-01" : yearMonth + "-16",
    end: day <= 15 ? yearMonth + "-15" : lastDay,
    payDate: day <= 15 ? yearMonth + "-15" : lastDay,
  };
}

export function FirstPayrollInlineJourney({
  data, readiness, notify, onRefresh, onAddEmployee, onOpenBundy,
  onDecide, onCreatePayroll, busy, canManagePeople, canManageTime,
  canManagePayroll, canDecideApprovals, canManageDelegations, allowedPages,
}: Props) {
  const orgId = data.selectedOrganization.id;
  const role = data.access?.role ?? "";
  const companyWide = data.access?.companyWide === true;
  const steps = useMemo(() => buildFirstPayrollJourney(readiness), [readiness]);
  const [opened, setOpened] = useState<FirstPayrollKey | null>(
    steps.find(step => step.state !== "complete")?.key ?? "company",
  );
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assignmentLoading, setAssignmentLoading] = useState(true);
  const [assignmentError, setAssignmentError] = useState("");
  const [handoffBusy, setHandoffBusy] = useState<string | null>(null);
  const [settingNotice, setSettingNotice] = useState("");
  const [preview, setPreview] = useState<FirstPayrollPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [employers, setEmployers] = useState<Employer[]>([]);
  const [employersLoading, setEmployersLoading] = useState(true);
  const [employersError, setEmployersError] = useState("");
  const [legalEntityId, setLegalEntityId] = useState<number | null>(null);
  const [periodStart, setPeriodStart] = useState(() => defaultDates().start);
  const [periodEnd, setPeriodEnd] = useState(() => defaultDates().end);
  const [payDate, setPayDate] = useState(() => defaultDates().payDate);
  const [scopeOrgUnitId, setScopeOrgUnitId] = useState<number | null>(null);
  const [confirmDraft, setConfirmDraft] = useState(false);
  const [reloadProgress, setReloadProgress] = useState(0);

  const canHandoff = companyWide && ["owner", "admin", "bookkeeper", "hr"].includes(role);
  const canManageTeam = companyWide && ["owner", "admin", "bookkeeper"].includes(role);
  const canManageCompany = canManageTeam;
  const canViewApprovals = allowedPages.includes("Approvals") && ["owner", "admin", "bookkeeper", "payroll", "checker"].includes(role);
  const canViewExports = allowedPages.includes("Exports") && ["owner", "admin", "bookkeeper", "payroll", "checker"].includes(role);

  useEffect(() => {
    let active = true;
    (async () => {
      setAssignmentLoading(true); setAssignmentError("");
      try {
        const response = await fetch("/api/first-payroll/progress?organizationId=" + orgId,
          { cache:"no-store" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "Could not load journey assignments.");
        if (active) setAssignments(body.assignments ?? []);
      } catch (e) {
        if (active) setAssignmentError(e instanceof Error ? e.message : "Assignments unavailable.");
      } finally { if (active) setAssignmentLoading(false); }
    })();
    return () => { active = false; };
  }, [orgId, reloadProgress]);

  useEffect(() => {
    let active = true;
    (async () => {
      setEmployersLoading(true); setEmployersError("");
      try {
        const response = await fetch("/api/legal-entities?organizationId=" + orgId + "&mode=selector",
          { cache:"no-store" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "Could not load authorized legal employers.");
        if (active) {
          const rows = (body.legalEntities ?? []) as Employer[];
          setEmployers(rows);
          setLegalEntityId(rows.find(item=>item.primaryEntity)?.id ?? rows[0]?.id ?? null);
        }
      } catch (e) { if (active) setEmployersError(e instanceof Error ? e.message : "Employer selector failed."); }
      finally { if (active) setEmployersLoading(false); }
    })();
    return () => { active = false; };
  }, [orgId]);

  // Preview is invalidated when ANY input changes. Never reuse stale costs.
  useEffect(() => {
    setPreview(null); setPreviewError(""); setConfirmDraft(false);
  }, [periodStart, periodEnd, payDate, scopeOrgUnitId, orgId]);

  async function handoff(step: FirstPayrollKey) {
    setHandoffBusy(step); setAssignmentError("");
    try {
      const response = await fetch("/api/first-payroll/progress", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ organizationId:orgId, step }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not send this step.");
      setReloadProgress(n=>n+1);
      notify("Sent to existing " + body.role + " role for review; no approval or permission was granted.", "info");
    } catch (error) {
      setAssignmentError(error instanceof Error ? error.message : "Handoff failed.");
    } finally { setHandoffBusy(null); }
  }

  async function calculatePreview() {
    setPreviewLoading(true); setPreview(null); setPreviewError(""); setConfirmDraft(false);
    try {
      const response = await fetch("/api/first-payroll/preview", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ organizationId:orgId, periodStart, periodEnd, payDate, scopeOrgUnitId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Payroll preview unavailable.");
      setPreview(body as FirstPayrollPreview);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Payroll preview failed.");
    } finally { setPreviewLoading(false); }
  }

  async function draftPayroll() {
    if (!canManagePayroll || !preview?.previewReady || !confirmDraft || !legalEntityId) return;
    await onCreatePayroll({ periodStart, periodEnd, payDate, scopeOrgUnitId, legalEntityId,
      processNow:false, stayOnJourney:true });
    await onRefresh();
    setConfirmDraft(false);
    // Do not claim this created a released run. Maker-checker remains separate.
  }

  const selectedEmployer = employers.find(item=>item.id===legalEntityId);
  const datesValid = validFirstPayrollPreviewDates(periodStart,periodEnd,payDate);
  const counts = { done:steps.filter(step=>step.state==="complete").length, total:steps.length };

  function inner(step: FirstPayrollJourneyStep) {
    if (step.key !== "payroll" && !allowedPages.includes(step.page)) {
      return <p role="status">This step belongs to {FIRST_PAYROLL_OWNER[step.key].role}.
        Your role cannot open the underlying {step.page} records. Ask the assigned role to review them.</p>;
    }
    switch(step.key) {
      case "company":
        return <div>
          <p>Update the registered employer, statutory registration identifiers and pay calendar right here.
            The existing settings API requires appropriate administrator authority and MFA.</p>
          {canManageCompany
            ? <SettingsPage key={"inline-company-" + orgId}
                data={data} initialTab="organization" setNotice={message=>{setSettingNotice(message);notify(message,"info");}}/>
            : <p role="status">Read-only: registered employer setup is managed by the company owner or authorized administrator.</p>}
          {settingNotice && <p role="status">{settingNotice}</p>}
          <button type="button" className="secondary-button"
            onClick={()=>void onRefresh()}>Refresh company readiness</button>
        </div>;
      case "people":
        return <div>
          <p>Add a worker, upload a CSV or select an existing employee to correct payout information. Uses the same authorized People and import endpoints.</p>
          {canManagePeople && <button type="button" className="primary-button" onClick={onAddEmployee}>
            Add employee inline
          </button>}
          <PeopleView data={data} canManage={canManagePeople} onRefresh={onRefresh}
            onAddEmployee={onAddEmployee}
            onPage={()=>notify("This action is outside basic first-payroll setup; use the appropriate authorized workflow.", "info")}/>
        </div>;
      case "time":
        return <div>
          <p><strong>Human attendance review is mandatory.</strong> Review worker punches, timesheets and cutoff locks below.
            This drawer cannot mark time approved by a checkbox.</p>
          <TimeView data={data} notify={notify} onOpenBundy={onOpenBundy} canManage={canManageTime}/>
          <WorkforceTimesheetPanel key={orgId + "-" + periodStart + "-" + periodEnd}
            data={data} notify={notify} canManage={canManageTime}
            initialPeriod={{ periodStart, periodEnd }}/>
          {["owner","admin","bookkeeper","hr"].includes(role) && <AttendanceLockControl
            organizationId={orgId} startDate={periodStart} endDate={periodEnd} notify={notify}/>}
        </div>;
      case "reviewers":
        return <div>
          <p>Invite or assign a payroll maker and an independent checker. Existing team settings enforce role permissions.
            One person cannot approve their own payroll run.</p>
          {canManageTeam
            ? <SettingsPage key={"inline-reviewers-" + orgId}
                data={data} initialTab="team" setNotice={message=>{setSettingNotice(message);notify(message,"info");}}/>
            : <p role="status">Only a company-wide owner, administrator or bookkeeper can edit team access; the payroll checker must remain independent.</p>}
          {settingNotice && <p role="status">{settingNotice}</p>}
          <button type="button" className="secondary-button" onClick={()=>void onRefresh()}>Refresh maker-checker readiness</button>
        </div>;
      case "payroll":
        return <div>
          <h3>First payroll — zero-write preview</h3>
          <p>Preview is a read-only calculation using the existing payroll engine. Nothing here creates payroll runs,
            ledger items, approvals or government files until you explicitly create a separate draft.</p>
          {employersLoading && <p role="status">Loading legal employers…</p>}
          {employersError && <p role="alert">{employersError}
            <button type="button" onClick={()=>window.location.reload()}>Retry</button></p>}
          {!employersLoading && employers.length===0 && <p role="status">No active legal employer is available. Complete company setup.</p>}
          <div className="setting-form" style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,210px),1fr))",gap:12 }}>
            <label>Legal employer
              <select value={legalEntityId ?? ""} disabled={true} aria-label="Preview legal employer">
                <option value={legalEntityId ?? ""}>{selectedEmployer?.displayName ?? "No primary employer"}</option>
              </select>
            </label>
            <label>Period start <input type="date" value={periodStart} onChange={e=>setPeriodStart(e.target.value)}/></label>
            <label>Period end <input type="date" value={periodEnd} onChange={e=>setPeriodEnd(e.target.value)}/></label>
            <label>Pay date <input type="date" value={payDate} onChange={e=>setPayDate(e.target.value)}/></label>
            <label>Payroll unit <select value={scopeOrgUnitId ?? ""} onChange={e=>setScopeOrgUnitId(e.target.value?Number(e.target.value):null)}>
              {companyWide && <option value="">All authorized units</option>}
              {(data.orgUnits ?? [])
                .map(unit=><option key={unit.id} value={unit.id}>{unit.name}</option>)}
            </select></label>
          </div>
          {!datesValid && <p role="alert">Choose a real pay period of 16 days or fewer, with pay date on or after the end.</p>}
          <button type="button" className="primary-button"
            disabled={previewLoading||!datesValid||employersLoading||!legalEntityId} onClick={()=>void calculatePreview()}>
            {previewLoading?"Calculating without writes…":"Preview employee payroll (no writes)"}
          </button>
          {previewError && <div role="alert" className="notice notice-amber">{previewError}
            <button type="button" className="secondary-button" onClick={()=>void calculatePreview()}>Retry</button></div>}
          {preview && <section aria-label="First payroll per-employee preview" style={{marginTop:16}}>
            <div className="card-kicker">READ-ONLY PREVIEW · {preview.ruleVersion}</div>
            <strong>{preview.previewReady ? "Preview calculations ready for human review" : "Preview has blockers"}</strong>
            <p>This is a first-cutoff estimate, not the final payable payroll, and requires independent time and checker approval.</p>
            {preview.blockers.length>0 && <ul role="status">{preview.blockers.map((reason,i)=><li key={i}>{reason}</li>)}</ul>}
            {preview.rows.length===0 && <p>No active employees. Add at least one employee and payout details.</p>}
            <div style={{maxWidth:"100%",overflowX:"auto"}}>
              <table className="data-table" aria-label="Payroll preview values and blockers">
                <thead><tr><th>Employee</th><th>Gross</th><th>SSS</th><th>PhilHealth</th><th>Pag-IBIG</th>
                  <th>Withholding</th><th>Net</th><th>Blockers</th></tr></thead>
                <tbody>{preview.rows.map(row=><tr key={row.employeeId}>
                  <th>{row.employeeName}<small style={{display:"block"}}>{row.employeeNo}</small></th>
                  {(["gross","sss","philHealth","pagIbig","withholding","net"] as const)
                    .map(key=><td key={key}>{row[key]===null?"—":"₱"+row[key]}</td>)}
                  <td>{row.blockers.length===0?"None":<ul>{row.blockers.map((text,i)=><li key={i}>{text}</li>)}</ul>}</td>
                </tr>)}</tbody>
                {preview.totals && <tfoot><tr><th>Preview totals</th>
                  {(["gross","sss","philHealth","pagIbig","withholding","net"] as const)
                    .map(key=><th key={key}>₱{preview.totals?.[key]}</th>)}<th>Not released</th></tr></tfoot>}
              </table>
            </div>
            <ul>{preview.limitations.map((line,i)=><li key={i}>{line}</li>)}</ul>
            {canManagePayroll && <div className="card" style={{padding:12,boxShadow:"none"}}>
              <label style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                <input type="checkbox" checked={confirmDraft} onChange={e=>setConfirmDraft(e.target.checked)}/>
                <span>I understand creating a <strong>draft</strong> is a separate database write and not a payroll approval.</span>
              </label>
              <button type="button" className="secondary-button"
                disabled={busy || !preview.previewReady || !readiness.ready || !confirmDraft || !legalEntityId}
                onClick={()=>void draftPayroll()}>
                {busy?"Creating draft…":"Create first payroll DRAFT (no release)"}
              </button>
              {!readiness.ready && <p>Finish company, payout, and reviewer setup before creating a run.</p>}
            </div>}
          </section>}
        </div>;
      case "approval":
        return <div>
          <p>The existing checker screen below requires a separate human, immutable run snapshot and approval rules.
            This journey never approves or releases automatically.</p>
          {!canViewApprovals ? <p role="status">Only authorized payroll checkers can view payroll decisions.</p> :
            <ApprovalsView data={data} busy={busy} canDecide={canDecideApprovals}
              canManageDelegations={canManageDelegations} onDecide={onDecide} onRefresh={onRefresh} notify={notify}/>}
        </div>;
      case "exports":
        return <div>
          <p>After release, download the authorized payslips and filing worksheets and record external agency evidence.
            File download alone does not prove government acceptance.</p>
          {!canViewExports ? <p role="status">Payroll record exports are restricted to authorized payroll roles.</p> :
            <ExportsView data={data} notify={notify} onRefresh={onRefresh}/>}
        </div>;
    }
  }
  return <section aria-label="Inline first-payroll journey" className="first-payroll-card" style={{width:"100%",maxWidth:"100%"}}>
    <div className="first-payroll-head">
      <div><div className="first-payroll-kicker">FIRST PAYROLL · SEVEN STEPS</div>
        <h2>Complete your first payroll here</h2>
        <p>Use each step without leaving this workspace. Progress and handoffs are saved for other authorized team members.</p>
      </div>
      <div className="first-payroll-progress" aria-label={counts.done+" of "+counts.total+" steps complete"}>
        <strong>{counts.done}/{counts.total}</strong><span>steps</span>
      </div>
    </div>
    {assignmentLoading && <p role="status">Loading team handoffs…</p>}
    {assignmentError && <div role="alert" className="notice notice-amber">
      {assignmentError} <button type="button" className="secondary-button" onClick={()=>setReloadProgress(n=>n+1)}>Retry</button>
    </div>}
    <ol style={{listStyle:"none",padding:0,display:"grid",gap:10,marginTop:14}}>
      {steps.map((step,index)=>{
        const owner = FIRST_PAYROLL_OWNER[step.key];
        const handoff=assignments.find(row=>row.step===step.key);
        const isOpen=opened===step.key;
        return <li key={step.key} style={{border:"1px solid var(--line)",borderRadius:12,
          padding:12,background:"var(--canvas-subtle)",minWidth:0}}>
          <div style={{display:"flex",gap:8,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
            <div style={{minWidth:0}}><strong>{index+1}. {step.title}</strong>
              <p style={{fontSize:12,marginTop:5}}>{step.detail}</p>
              <small>Owner: {owner.role} · {step.state==="complete"?"Setup recorded":step.state==="review"?"Human review":step.state==="available"?"Ready for action":"Upcoming"}</small>
              {handoff && <p role="status" style={{fontSize:12}}>Sent to {handoff.ownerTeam}; case #{handoff.id} · {handoff.status}.</p>}
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {canHandoff && step.state!=="complete" && <button type="button" className="secondary-button"
                disabled={handoffBusy===step.key} onClick={()=>void handoff(step.key)}>
                {handoffBusy===step.key?"Sending…":"Send to "+owner.role}
              </button>}
              <button type="button" className="primary-button" aria-expanded={isOpen} aria-controls={"first-payroll-step-"+step.key}
                onClick={()=>setOpened(current=>current===step.key?null:step.key)}>
                {isOpen?"Close step":"Open step"}
              </button>
            </div>
          </div>
          {isOpen && <div id={"first-payroll-step-"+step.key} style={{marginTop:14,borderTop:"1px solid var(--line)",
            paddingTop:12,minWidth:0,maxWidth:"100%"}}>
            {inner(step)}
          </div>}
        </li>;
      })}
    </ol>
  </section>;
}
