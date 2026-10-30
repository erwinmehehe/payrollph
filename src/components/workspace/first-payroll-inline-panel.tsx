"use client";
import { useEffect, useState } from "react";
import { EmployeeImportPreviewPanel } from "@/components/employee-import-preview-panel";
import { AccountPanel } from "@/components/account-panel";
import { NewHireModal } from "@/components/new-hire-modal";
import { FIRST_PAYROLL_STEPS, type FirstPayrollKey } from "@/lib/first-payroll-journey";
import { INVITABLE_ROLES } from "@/lib/roles";
import { ApprovalsView } from "./approvals";
import { ExportsView } from "./exports";
import type { DashboardData, Notify } from "./types";
import { firstPayrollPreviewSourceHref, firstPayrollRunHref } from "@/lib/first-payroll-run-navigation";
import { parseFirstPayrollProgressRead, readVerifiedFirstPayrollProgress, type SavedFirstPayrollProgress } from "@/lib/first-payroll-progress-read";
import { isVerifiedFirstPayrollPreview, readVerifiedFirstPayrollPreview, type FirstPayrollPreview } from "@/lib/first-payroll-preview-read";
import { readVerifiedFirstPayrollLegalEmployer } from "@/lib/first-payroll-legal-employer-read";

function firstPayrollStep(key: FirstPayrollKey) {
  const found = FIRST_PAYROLL_STEPS.find(item => item.key === key);
  if (!found) throw new Error("Unknown journey step");
  return found;
}
type Progress = SavedFirstPayrollProgress;
type LegalEmployer = { id:number;primaryEntity:boolean;active:boolean;legalName:string;payrollCalendarMode:string;birTin?:string|null;sssEmployerNo?:string|null;philHealthEmployerNo?:string|null;pagIbigEmployerNo?:string|null };
type InlinePanelProps = {
 step:FirstPayrollKey;data:DashboardData;onRefresh:()=>Promise<void>;
 onProgressUpdate?:()=>Promise<void>;
 onOpenPeople?:()=>void;
 onDecide?:(id:number,status:"Approved"|"Declined")=>Promise<void>;
 canDecide?:boolean;canManageDelegations?:boolean;notify?:Notify;
};

// Remount rather than copy stale tenant/role state when the workspace changes.
// Loading defaults are fail-closed; retry resets are initiated by a user event,
// not by a synchronous setState inside the fetch effect.
export function FirstPayrollInlinePanel(props: InlinePanelProps) {
 const { data, step } = props;
 const scope = JSON.stringify([
   data.selectedOrganization.id, data.user?.id ?? null, data.access?.role ?? null,
   data.access?.companyWide === true, step,
 ]);
 return <ScopedFirstPayrollInlinePanel key={scope} {...props} />;
}

function ScopedFirstPayrollInlinePanel({
 step, data, onRefresh, onProgressUpdate, onOpenPeople, onDecide, canDecide = false, canManageDelegations = false, notify = () => {},
}: InlinePanelProps) {
 const organizationId=data.selectedOrganization.id;
 const defaultOwner=firstPayrollStep(step).owner;
 const permittedOwners: readonly string[]=firstPayrollStep(step).allowedOwners;
 const [progress,setProgress]=useState<Progress|null>(null);
 const [progressLoading,setProgressLoading]=useState(true);
 const [progressVerified,setProgressVerified]=useState(false);
 const [progressRevision,setProgressRevision]=useState(0);
 const [companyLoading,setCompanyLoading]=useState(step==="company");
 const [companyUnavailable,setCompanyUnavailable]=useState(false);
 const [companyRevision,setCompanyRevision]=useState(0);
 const [error,setError]=useState("");const [notice,setNotice]=useState("");const [busy,setBusy]=useState(false);
 const [company,setCompany]=useState(data.selectedOrganization.legalName);
 const [schedule,setSchedule]=useState("ph_semi_monthly");
 const [registrations,setRegistrations]=useState({birTin:"",sssEmployerNo:"",philHealthEmployerNo:"",pagIbigEmployerNo:""});
 const [employer,setEmployer]=useState<LegalEmployer|null>(null);
 const [peopleMode,setPeopleMode]=useState<"add"|"import">("add");
 const [showHire,setShowHire]=useState(false);
 const [showSecurity,setShowSecurity]=useState(false);
 const [email,setEmail]=useState("");const [role,setRole]=useState("payroll");
 const [target,setTarget]=useState<string>(defaultOwner);
 const [start,setStart]=useState("");const [end,setEnd]=useState("");const [payDate,setPayDate]=useState("");
 const [acknowledged,setAcknowledged]=useState(false);
 const [previewResult,setPreview]=useState<FirstPayrollPreview|null>(null);
 // A response may be valid for the request that started it but obsolete for
 // the dates currently on screen. Never display financial figures from an earlier scope.
 const preview=previewResult&&isVerifiedFirstPayrollPreview(previewResult,{
   organizationId,periodStart:start,periodEnd:end,payDate,
 })?previewResult:null;
 const [previewUnavailable,setPreviewUnavailable]=useState(false);
 useEffect(()=>{
  let cancelled=false;
  void readVerifiedFirstPayrollProgress(organizationId, fetch)
   .then(p=>{if(cancelled)return;setProgress(p);setProgressVerified(true);
      setAcknowledged(false);
      const reviewed=p?.completedSteps?.time;
      if(reviewed?.periodStart)setStart(reviewed.periodStart);
      if(reviewed?.periodEnd)setEnd(reviewed.periodEnd);
      const owner=p?.stepOwners?.[step];if(owner&&permittedOwners.includes(owner))setTarget(owner);
   }).catch(()=>{if(!cancelled){setProgress(null);setProgressVerified(false);setError("Saved progress unavailable for this employer. Retry before acting.");}})
   .finally(()=>{if(!cancelled)setProgressLoading(false);});
  return ()=>{cancelled=true;};
 },[organizationId,step,permittedOwners,progressRevision]);
 useEffect(()=>{
  if(step!=="company")return;
  let cancelled=false;
  void readVerifiedFirstPayrollLegalEmployer(organizationId,fetch)
   .then(entries=>{if(cancelled)return;
     const selected=entries.find(e=>e.active&&e.primaryEntity)??null;
     setEmployer(selected);if(selected){setCompany(selected.legalName);setSchedule(selected.payrollCalendarMode);setRegistrations({birTin:selected.birTin??"",sssEmployerNo:selected.sssEmployerNo??"",philHealthEmployerNo:selected.philHealthEmployerNo??"",pagIbigEmployerNo:selected.pagIbigEmployerNo??""});}
   }).catch(e=>{if(!cancelled){setEmployer(null);setCompanyUnavailable(true);setError(e instanceof Error?e.message:"Could not load legal employer");}})
   .finally(()=>{if(!cancelled)setCompanyLoading(false);});
  return ()=>{cancelled=true;};
 },[step,organizationId,companyRevision]);

 function retryProgress() {
  setProgressLoading(true);
  setProgressVerified(false);
  setProgress(null);
  setError("");
  setProgressRevision(value => value + 1);
 }
 function retryCompany() {
  setCompanyLoading(true);
  setCompanyUnavailable(false);
  setEmployer(null);
  setError("");
  setCompanyRevision(value => value + 1);
 }

 async function send(url:string,method:string,body:Record<string,unknown>,message:string) {
  if(!progressVerified){setError("Saved progress unavailable. Retry before acting.");return false;}
  setBusy(true);setError("");setNotice("");
  try {
    const headers: Record<string,string> = {"Content-Type":"application/json"};
    const response=await fetch(url,{method,headers,
      body:JSON.stringify({...body,organizationId})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(result.error??"Could not complete action");
    if(url==="/api/first-payroll/progress")setProgress(parseFirstPayrollProgressRead(result, organizationId));
    setNotice(message);
    // The mutation has already committed. A failed read refresh must not turn
    // it into an apparent failed write or leave an invitation ready to resend.
    try {
      if(result.progress)await onProgressUpdate?.();
      await onRefresh();
    }catch{
      setError("Changes were saved, but the workspace could not refresh. Refresh the page to load the latest records.");
    }
    return true;
  }catch(e){setError(e instanceof Error?e.message:"Action failed");return false;}
  finally{setBusy(false);}
 }
 async function companySave() {
  if(!employer){setError("No active primary legal employer found.");return;}
  // Legal employer is authoritative for payroll. Updating organization settings alone is insufficient.
  const entitySaved=await send("/api/legal-entities","PATCH",{
    action:"update_entity",legalEntityId:employer.id,legalName:company,payrollCalendarMode:schedule,...registrations,
  },"Legal employer updated.");
  if(!entitySaved)return;
  const projected=await send("/api/organizations","PUT",{
    legalName:company,payrollCalendarMode:schedule,
  },"Employer projection updated.");
  if(!projected)return;
  await send("/api/first-payroll/progress","PATCH",{
    key:"company",action:"company_confirm",
  },"Legal employer and pay schedule confirmed.");
 }
 async function dryRun() {
  setBusy(true);setError("");setPreview(null);setPreviewUnavailable(false);
  try {
    const result=await readVerifiedFirstPayrollPreview({organizationId,periodStart:start,periodEnd:end,payDate},fetch);
   setPreview(result);
  }catch(e){setPreview(null);setPreviewUnavailable(true);setError(e instanceof Error?e.message:"Preview unavailable");}
  finally{setBusy(false);}
 }
 const periodPunches=start&&end ? (data.punches??[]).filter(p=>p.workDate>=start&&p.workDate<=end) : [];
 const periodLeaves=start&&end ? (data.leaveRequests??[]).filter(l=>l.startDate<=end&&l.endDate>=start) : [];
 const employeeNames=new Map((data.employees??[]).map(person=>[person.id,person.firstName+" "+person.lastName]));
 const timeLabel=(value:Date|string|null)=>value
   ? new Date(value).toLocaleString("en-PH",{timeZone:"Asia/Manila",dateStyle:"short",timeStyle:"short"})
   : "—";
 const reviewed=progress?.completedSteps?.time;
 const activeRole=data.access?.role??"";
 const employeesMissingPayout=data.firstPayrollReadiness?.employeesMissingPayout;
 const companyWide=data.access?.companyWide===true;
 const reviewersCanEdit=companyWide&&["owner","admin"].includes(activeRole);
 const canAddPeople=companyWide&&["owner","admin","bookkeeper","hr"].includes(activeRole);
 const canPreviewPayroll=companyWide&&["owner","admin","bookkeeper","payroll","checker"].includes(activeRole);
 const currentOwner=progress?.stepOwners?.[step]??defaultOwner;
 const canHandoff=companyWide&&(reviewersCanEdit||currentOwner===activeRole);
 const handoff=<div className="mt-4 flex flex-wrap items-center gap-2">
   <label>Responsible role <select value={target} onChange={e=>setTarget(e.target.value)}>
     {permittedOwners.map(r=><option key={r} value={r}>{r}</option>)}
   </select></label>
   <button type="button" className="secondary-button" disabled={busy||progressLoading||!progressVerified||!canHandoff}
     onClick={()=>void send("/api/first-payroll/progress","PATCH",{key:step,action:"handoff",targetRole:target},"Handoff recorded for the selected role.")}>
     Send to {target}
   </button>
   <small>Current owner: {currentOwner}</small>
   {!canHandoff&&<small>Only the responsible role or a company administrator can reassign this step.</small>}
 </div>;
 return <div className="mt-3 min-w-0 max-w-full rounded-xl border p-4" aria-label={step+" inline setup"}
   aria-busy={progressLoading||companyLoading||busy}>
   {(progressLoading||companyLoading)&&<p role="status">Loading saved employer setup…</p>}
   {busy&&<p role="status">Processing this step…</p>}
   {error&&<p role="alert">{error}</p>}{!progressLoading&&!progressVerified&&<button type="button" className="secondary-button" onClick={retryProgress}>Retry saved progress</button>}{notice&&<p role="status">{notice}</p>}
   {step==="company"&&<div className="grid gap-3">
     {companyUnavailable&&<p role="alert">Legal employer details unavailable. <button type="button" className="secondary-button" onClick={retryCompany}>Retry legal employer</button></p>}
     <p>Update the primary legal employer. Its calendar, not the legacy organization projection, governs payroll.</p>
     <label>Legal employer name<input value={company} onChange={e=>setCompany(e.target.value)}/></label>
     <label>Employer BIR TIN<input value={registrations.birTin} inputMode="numeric" maxLength={9} pattern="[0-9]{9}" onChange={e=>setRegistrations(p=>({...p,birTin:e.target.value.replace(/\D/g,"")}))}/></label>
     <label>SSS employer registration<input value={registrations.sssEmployerNo} onChange={e=>setRegistrations(p=>({...p,sssEmployerNo:e.target.value}))}/></label>
     <label>PhilHealth employer registration<input value={registrations.philHealthEmployerNo} onChange={e=>setRegistrations(p=>({...p,philHealthEmployerNo:e.target.value}))}/></label>
     <label>Pag-IBIG employer registration<input value={registrations.pagIbigEmployerNo} onChange={e=>setRegistrations(p=>({...p,pagIbigEmployerNo:e.target.value}))}/></label>
     <label>Pay schedule<select value={schedule} onChange={e=>setSchedule(e.target.value)}>
       <option value="ph_semi_monthly">Philippine semi-monthly</option>
       <option value="flexible">Flexible (review required)</option>
     </select></label>
     <button type="button" className="primary-button" disabled={busy||!progressVerified||!employer||!reviewersCanEdit}
       onClick={()=>void companySave()}>Save legal employer and schedule</button>
     {reviewersCanEdit&&<div className="min-w-0 max-w-full rounded-lg border p-3">
       <p className="text-sm">Account security is personal to the signed-in administrator. MFA and session changes use the existing protected account endpoints.</p>
       <button type="button" className="secondary-button" aria-expanded={showSecurity}
         onClick={()=>setShowSecurity(current=>!current)}>
         {showSecurity?"Close account security":"Configure account security and MFA"}
       </button>
       {showSecurity&&<div className="mt-3 max-w-full overflow-x-auto" aria-label="Inline account security">
         <AccountPanel onNotice={message=>setNotice(message)}/>
       </div>}
     </div>}
     {progress?.completedSteps?.company&&<small>Confirmed by user #{progress.completedSteps.company.byUserId}</small>}
   </div>}
   {step==="people"&&<div>
     {typeof employeesMissingPayout==="number"&&employeesMissingPayout>0&&<section className="mb-3 grid min-w-0 gap-2 rounded-lg border p-3" aria-label="Existing employee payout setup">
       <h3 className="font-semibold">Complete existing employee payout details</h3>
       <p>Update the existing employee records in People, then return to first payroll.</p>
       {canAddPeople&&onOpenPeople
         ?<button type="button" className="secondary-button" style={{width:"100%",minWidth:0,height:"auto",whiteSpace:"normal"}} disabled={busy} onClick={onOpenPeople}>Open People to edit payout details</button>
         :<p>Ask an authorized People administrator to update the payout details.</p>}
     </section>}
     <div className="flex flex-wrap gap-2">
       <button type="button" className="secondary-button" onClick={()=>setPeopleMode("add")}>Add one employee</button>
       <button type="button" className="secondary-button" onClick={()=>setPeopleMode("import")}>Import CSV</button>
     </div>
     {peopleMode==="add"&&<div className="mt-3">
       <p>Create the employee and their pay profile using the same governed hire endpoint as People.</p>
       <button type="button" className="primary-button" disabled={!canAddPeople} onClick={()=>setShowHire(v=>!v)}>{showHire?"Close employee form":"Add employee inline"}</button>
       {showHire&&canAddPeople&&<NewHireModal inline everydayHrHireEnabled={data.everydayHrHireEnabled} organizationId={organizationId} onClose={()=>setShowHire(false)}
         onCreated={()=>{setShowHire(false);void onRefresh();}}/>}
     </div>}
     {peopleMode==="import"&&!canAddPeople&&<p role="status">Ask an authorized People administrator to import employees.</p>}
     {peopleMode==="import"&&canAddPeople&&(data.employeeImportPreviewEnabled
       ?<EmployeeImportPreviewPanel organizationId={organizationId} onImported={()=>void onRefresh()}/>
       :<p role="alert">Employee CSV preview is not enabled. Individual employee creation remains available; unsafe direct import is not exposed here.</p>)}
   </div>}
   {step==="time"&&<div className="grid min-w-0 grid-cols-1 gap-3">
     <p>An authorized HR reviewer must check missing punches, leave, schedule exceptions and the actual pay period. This attestation does not approve timesheets or bypass payroll attendance locks.</p>
     <label className="grid min-w-0 w-full max-w-sm gap-2 text-sm"><span>Pay period start</span><input className="block min-w-0 w-full" type="date" value={start} onChange={e=>{setStart(e.target.value);setAcknowledged(false);}}/></label>
     <label className="grid min-w-0 w-full max-w-sm gap-2 text-sm"><span>Pay period end</span><input className="block min-w-0 w-full" type="date" value={end} onChange={e=>{setEnd(e.target.value);setAcknowledged(false);}}/></label>
     {start&&end ? <>
       <p role="status">{periodPunches.length} recorded attendance punch{periodPunches.length===1?"":"es"} and {periodLeaves.length} leave request{periodLeaves.length===1?"":"s"} overlap this selected period. Review recorded exceptions before attesting. Absence of records does not prove attendance was completed.</p>
       {periodPunches.length===0
         ? <p>No time punches are recorded for this period. Confirm the employee schedule and any missing attendance records before reviewing.</p>
         : <div className="max-w-full overflow-x-auto" role="region" aria-label="Period attendance records" tabIndex={0}>
           <table className="min-w-[520px]"><caption>Recorded attendance for the selected period (first 50 rows)</caption>
             <thead><tr><th>Employee</th><th>Work date</th><th>Time in</th><th>Time out</th><th>Status</th></tr></thead>
             <tbody>{periodPunches.slice(0,50).map(p=><tr key={p.id}>
               <td>{employeeNames.get(p.employeeId)??"Worker #"+p.employeeId}</td>
               <td>{p.workDate}</td><td>{timeLabel(p.timeIn)}</td><td>{timeLabel(p.timeOut)}</td><td>{p.status}</td>
             </tr>)}</tbody>
           </table>
         </div>}
       {periodPunches.length>50&&<p>Additional attendance rows require review in the authoritative time workflow before attestation.</p>}
       {periodLeaves.length>0&&<div className="max-w-full overflow-x-auto" role="region" aria-label="Period leave records" tabIndex={0}>
         <table className="min-w-[460px]"><caption>Leave requests overlapping the period (first 50 rows)</caption>
           <thead><tr><th>Employee</th><th>Dates</th><th>Type</th><th>Status</th></tr></thead>
           <tbody>{periodLeaves.slice(0,50).map(l=><tr key={l.id}>
             <td>{employeeNames.get(l.employeeId)??"Worker #"+l.employeeId}</td>
             <td>{l.startDate} to {l.endDate}</td><td>{l.leaveType}</td><td>{l.status}</td>
           </tr>)}</tbody>
         </table>
       </div>}
       {periodLeaves.length>50&&<p>Additional leave records require review in the authoritative leave workflow before attestation.</p>}
     </> : <p>Select a pay period to load recorded attendance and leave context.</p>}
     <label className="flex items-start gap-2"><input type="checkbox" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)}/>
       I personally reviewed the time and HR inputs for this period and will resolve any independent approval requirements.</label>
     <button type="button" className="primary-button"
       disabled={busy||!progressVerified||!["hr"].includes(data.access?.role??"")||!start||!end||!acknowledged}
       onClick={()=>void send("/api/first-payroll/progress","PATCH",{key:"time",action:"time_review",periodStart:start,periodEnd:end,acknowledged:true},"Period-specific HR review recorded.")}>
       Record authorized human review
     </button>
     {reviewed&&<p>Reviewed by user #{reviewed.byUserId} for {reviewed.periodStart} to {reviewed.periodEnd}.</p>}
   </div>}
   {step==="reviewers"&&<div className="grid gap-3">
     <p>Invite HR for the time review, then a payroll officer, independent checker and finance/bookkeeper as needed. Invitations must be accepted before a role handoff.</p>
     <label>Work email<input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
     <label>Role<select value={role} onChange={e=>setRole(e.target.value)}>
       {INVITABLE_ROLES.filter(item=>["hr","payroll","checker","bookkeeper"].includes(item.id)).map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
     </select></label>
     <button type="button" className="primary-button" disabled={busy||!progressVerified||!email||!reviewersCanEdit}
       onClick={()=>void send("/api/invitations","POST",{email,role},`Invitation sent for ${role}; acceptance still required.`).then(ok=>{if(ok)setEmail("");})}>
       Invite {role}</button>
     <p>Active payroll officers: {data.firstPayrollReadiness?.payrollOfficerCount??0}; independent checkers: {data.firstPayrollReadiness?.checkerCount??0}.</p>
   </div>}
   {step==="payroll"&&<div className="grid min-w-0 grid-cols-1 gap-3">
     {data.firstPayrollConnectedEnabled && canPreviewPayroll && data.payrollRuns.length > 0 && <section aria-label="Saved payroll runs" className="grid gap-3 rounded-lg border p-3">
       <h3 className="font-semibold">Continue a saved payroll</h3>
       <p className="text-sm">Open the existing run to calculate, resolve exceptions and submit it to a separate checker. Refreshing this page does not require another draft.</p>
       {data.payrollRuns.map(run => <a key={run.id} className="first-payroll-link flex flex-wrap gap-2" href={firstPayrollRunHref(organizationId, run.id)}>
         <span>Open payroll run #{run.id}</span><span>{run.periodLabel} · {run.status}</span>
       </a>)}
     </section>}
     <p>This preview uses the same approved payroll inputs and calculator as the real run. It is strictly read-only and cannot lock attendance, create a draft, approve, release or pay anyone. Use the separate Payroll workspace for the gated workflow.</p>
     <label className="grid min-w-0 w-full max-w-sm gap-2 text-sm"><span>Period start</span><input className="block min-w-0 w-full" type="date" value={start} onChange={e=>{setStart(e.target.value);setPreview(null);}}/></label>
     <label className="grid min-w-0 w-full max-w-sm gap-2 text-sm"><span>Period end</span><input className="block min-w-0 w-full" type="date" value={end} onChange={e=>{setEnd(e.target.value);setPreview(null);}}/></label>
     <label className="grid min-w-0 w-full max-w-sm gap-2 text-sm"><span>Pay date</span><input className="block min-w-0 w-full" type="date" value={payDate} onChange={e=>{setPayDate(e.target.value);setPreview(null);}}/></label>
     <button type="button" className="primary-button" style={{minWidth:0,maxWidth:"100%",height:"auto",whiteSpace:"normal"}} disabled={busy||!progressVerified||!canPreviewPayroll||!start||!end||!payDate} onClick={()=>void dryRun()}>Preview first payroll (no writes)</button>
     {!canPreviewPayroll&&<p role="status">Only company-wide payroll viewers can inspect calculated preview amounts.</p>}
     {previewResult&&!preview&&<p role="status">Pay-period details changed. Recalculate this read-only preview before relying on any figures.</p>}
     {previewUnavailable&&<p role="alert">Payroll preview unavailable. No counts or amounts are verified. <button type="button" className="secondary-button" disabled={busy||!progressVerified} onClick={()=>void dryRun()}>Retry payroll preview</button></p>}
     {preview&&canPreviewPayroll&&<>
       <p role="status">{preview.previewReady?"Preview ready for reconciliation":"Preview has blockers"}</p>
       {preview.blockers.map((b,i)=><p key={i} role="alert">{b}</p>)}
       {preview.warnings?.map((b,i)=><p key={i}>{b}</p>)}
       <div className="min-w-0 w-full max-w-full overflow-x-auto" role="region" aria-label="First payroll per-employee preview" tabIndex={0}>
          <table className="min-w-[850px]">
            <thead><tr>{["Employee", "Gross", "Statutory deductions", "Other deductions", "Net", "Source records", "Blockers"].map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{preview.rows.map(row => <tr key={row.employeeId}>
              <td>{row.name} <small>({row.employeeNo})</small></td>
              <td>{row.gross == null ? "—" : row.gross.toFixed(2)}</td>
              <td>{row.statutoryDeductions == null ? "—" : <>
                <strong>{row.statutoryDeductions.toFixed(2)}</strong>
                <small className="block">SSS {row.sss?.toFixed(2)} · PhilHealth {row.philHealth?.toFixed(2)} · Pag-IBIG {row.pagIbig?.toFixed(2)} · WHT {row.withholding?.toFixed(2)}</small>
              </>}</td>
              <td>{row.otherDeductions == null ? "—" : row.otherDeductions.toFixed(2)}</td>
              <td>{row.net == null ? "—" : <strong>{row.net.toFixed(2)}</strong>}</td>
              <td><div className="flex flex-col gap-1">{row.sources.length === 0 ? "—" : row.sources.map(source =>
                <a key={source.page + "-" + source.recordId} className="first-payroll-link"
                  href={firstPayrollPreviewSourceHref(organizationId, source.page)}
                  title={source.page + " source record #" + source.recordId}>
                  {source.label} #{source.recordId}
                </a>)}</div></td>
              <td>{row.blockers.join("; ") || "None"}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="text-sm">Preview only. Source links open existing workspaces with their own authorization checks. No actions in this preview create or change a payroll run.</p>
     </>}
   </div>}
   {step==="approval"&&<div>
     <p>Complete independent payroll approval using the existing role-controlled workflow. This onboarding view cannot approve its own run.</p>
     {onDecide&&<ApprovalsView data={data} busy={busy} canDecide={canDecide} canManageDelegations={canManageDelegations}
       onDecide={onDecide} onRefresh={onRefresh} notify={notify}/>}
   </div>}
   {step==="exports"&&<div>
     <p>Review released outputs and official filing evidence through the existing controlled export workflow. An export is not government filing acceptance.</p>
     <ExportsView data={data} notify={notify} onRefresh={onRefresh}/>
   </div>}
   {handoff}
 </div>;
}
