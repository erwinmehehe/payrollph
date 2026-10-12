"use client";
import { useEffect, useState } from "react";
import { EmployeeImportPreviewPanel } from "@/components/employee-import-preview-panel";
import type { FirstPayrollKey } from "@/lib/first-payroll-journey";
import type { DashboardData } from "./types";
const OWNERS:Record<FirstPayrollKey,string>={company:"owner",people:"hr",time:"hr",reviewers:"owner",payroll:"payroll",approval:"checker",exports:"bookkeeper"};
type Progress={stepOwners?:Record<string,string>;reviewedByUserId?:number|null;reviewedAt?:string|null};
type PreviewRow={employeeId:number;name:string;gross:number|null;sss:number|null;philHealth:number|null;pagIbig:number|null;withholding:number|null;net:number|null;blockers:string[]};
export function FirstPayrollInlinePanel({step,data,onRefresh}:{
 step:FirstPayrollKey;data:DashboardData;onRefresh:()=>Promise<void>;
}) {
 const organizationId=data.selectedOrganization.id;
 const [progress,setProgress]=useState<Progress|null>(null);
 const [error,setError]=useState("");const [notice,setNotice]=useState("");const [busy,setBusy]=useState(false);
 const [company,setCompany]=useState(data.selectedOrganization.legalName);
 const [schedule,setSchedule]=useState("ph_semi_monthly");
 const [email,setEmail]=useState("");const [role,setRole]=useState("payroll");
 const [target,setTarget]=useState(OWNERS[step]);
 const [start,setStart]=useState("");const [end,setEnd]=useState("");const [payDate,setPayDate]=useState("");
 const [preview,setPreview]=useState<{rows:PreviewRow[];blockers:string[];previewReady:boolean}|null>(null);
 useEffect(()=>{
  let cancelled=false;
  void fetch("/api/first-payroll/progress?organizationId="+organizationId,{cache:"no-store"})
    .then(r=>r.ok?r.json():null).then(x=>{if(!cancelled)setProgress(x?.progress??null);}).catch(()=>{});
  return ()=>{cancelled=true;};
 },[organizationId]);
 async function send(url:string,method:string,body:Record<string,unknown>) {
  setBusy(true);setError("");setNotice("");
  try {const response=await fetch(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,organizationId})});
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(result.error??"Could not complete action");
   if(result.progress)setProgress(result.progress);
   setNotice("Saved for this employer.");
   await onRefresh();
  }catch(e){setError(e instanceof Error?e.message:"Action failed");}finally{setBusy(false);}
 }
 async function dryRun(){
  setBusy(true);setError("");setPreview(null);
  try{const q=new URLSearchParams({organizationId:String(organizationId),periodStart:start,periodEnd:end,payDate});
   const response=await fetch("/api/first-payroll/preview?"+q,{cache:"no-store"});
   const result=await response.json();
   if(!response.ok)throw Error(result.error??"Preview unavailable");
   setPreview(result);
  }catch(e){setError(e instanceof Error?e.message:"Preview unavailable");}finally{setBusy(false);}
 }
 const handoff= <div className="mt-4 flex flex-wrap items-center gap-2"><label>Step owner <select value={target} onChange={e=>setTarget(e.target.value)}>
  {[...new Set([OWNERS[step],...(step==="people"?["owner","admin"]:[]),...(step==="payroll"?["owner","admin","bookkeeper"]:[]),...(step==="company"||step==="reviewers"?["admin"]:[])])].map(x=><option key={x} value={x}>{x}</option>)}
 </select></label>
 <button type="button" className="secondary-button" disabled={busy} onClick={()=>void send("/api/first-payroll/progress","PATCH",{key:step,action:"handoff",targetRole:target})}>Send to {target}</button>
 {progress?.stepOwners?.[step]&&<small>Assigned: {progress.stepOwners[step]}</small>}</div>;
 return <div className="mt-3 rounded-xl border p-4" aria-label={step+" inline setup"}>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {step==="company"&&<div className="grid gap-3">
   <label>Legal employer name<input value={company} onChange={e=>setCompany(e.target.value)}/></label>
   <label>Pay schedule<select value={schedule} onChange={e=>setSchedule(e.target.value)}><option value="ph_semi_monthly">Philippine semi-monthly</option><option value="flexible">Flexible</option></select></label>
   <button className="primary-button" disabled={busy} onClick={()=>void send("/api/organizations","PUT",{legalName:company,payrollCalendarMode:schedule})}>Save company and schedule</button>
  </div>}
  {step==="people"&&<div><p>Import employees here. All rows are previewed before any batch can commit.</p>
    {data.employeeImportPreviewEnabled?<EmployeeImportPreviewPanel organizationId={organizationId} onImported={()=>void onRefresh()}/>:<p role="alert">CSV import preview is not enabled for this employer. Enable EMPLOYEE_IMPORT_PREVIEW_ENABLED before using inline import.</p>}
  </div>}
  {step==="time"&&<div><p>Review actual attendance, missing punches, leave and approved timesheets before confirming. This records an onboarding review, not an attendance lock or timesheet approval.</p>
   <p>In-scope attendance punches: {data.punches?.length??0}. Existing attendance approval rules remain in force.</p>
   <button className="secondary-button" disabled={busy||!["hr","manager"].includes(data.access?.role??"")} onClick={()=>void send("/api/first-payroll/progress","PATCH",{key:"time",action:"time_review"})}>Record authorized human review</button>
   {progress?.reviewedByUserId&&<p>Reviewed by user #{progress.reviewedByUserId}</p>}
  </div>}
  {step==="reviewers"&&<div className="grid gap-3">
   <p>Invite distinct payroll and checker users. An invite is not a completed role assignment until accepted.</p>
   <label>Work email<input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
   <label>Role<select value={role} onChange={e=>setRole(e.target.value)}><option value="payroll">Payroll officer</option><option value="checker">Independent checker</option></select></label>
   <button className="primary-button" disabled={busy||!email} onClick={()=>void send("/api/invitations","POST",{email,role})}>Invite {role}</button>
  </div>}
  {(step==="payroll"||step==="approval"||step==="exports")&&<div>
   <p>{step==="payroll"?"Preview is read-only. It does not create a draft run, ledger, payslip or payout.":step==="approval"?"Independent checker approval must use the authorized server workflow; this panel cannot self-approve.":"Exports and agency evidence become available only after the appropriate payroll release gates."}</p>
   {step==="payroll"&&<div className="grid gap-3">
    <label>Period start<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label>
    <label>Period end<input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label>
    <label>Pay date<input type="date" value={payDate} onChange={e=>setPayDate(e.target.value)}/></label>
    <button type="button" className="primary-button" disabled={busy||!start||!end||!payDate} onClick={()=>void dryRun()}>First payroll preview (no writes)</button>
    {preview&&<><p role="status">{preview.previewReady?"Preview ready for human reconciliation":"Preview has blockers"}</p>
      {preview.blockers.map((b,i)=><p key={i}>{b}</p>)}
      <div className="overflow-x-auto"><table><thead><tr>{["Employee","Gross","SSS","PhilHealth","Pag-IBIG","Withholding","Net","Blockers"].map(h=><th key={h}>{h}</th>)}</tr></thead>
      <tbody>{preview.rows.map(row=><tr key={row.employeeId}><td>{row.name}</td>{[row.gross,row.sss,row.philHealth,row.pagIbig,row.withholding,row.net].map((n,i)=><td key={i}>{n==null?"—":n.toFixed(2)}</td>)}<td>{row.blockers.join("; ")}</td></tr>)}</tbody></table></div>
    </>}
   </div>}
  </div>}
  {handoff}
 </div>;
}
