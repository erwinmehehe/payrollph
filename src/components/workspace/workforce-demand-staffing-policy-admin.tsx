"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Site = {id:number;code:string;name:string;active:boolean};
type Profile = {id:number;title:string;active:boolean};
type RecordRow = {
  id:number;version:number;status:string;effectiveFrom:string;effectiveUntil:string;
  productiveUnitsPerWorkerHour:number;serviceTargetCoveragePercent:number;
  rationale:string;contentSha256:string;approvalReceiptSha256:string|null;
  approvalIntegrity:"matches_hash"|"source_review";
};
const types = ["transactions","visits","orders","appointments","calls"] as const;
const root="/api/workforce/demand-staffing/policies";
export function WorkforceDemandStaffingPolicyAdmin({
  organizationId,worksites,jobProfiles,
}:{
  organizationId:number;worksites:Site[];jobProfiles:Profile[];
}) {
  const [siteId,setSiteId]=useState<number|null>(null);
  const [role,setRole]=useState("any");
  const [metric,setMetric]=useState<(typeof types)[number]>("transactions");
  const [interval,setInterval]=useState<15|30|60>(30);
  const [from,setFrom]=useState("");
  const [until,setUntil]=useState("");
  const [productivity,setProductivity]=useState("");
  const [target,setTarget]=useState("");
  const [reason,setReason]=useState("");
  const [decision,setDecision]=useState("");
  const [acknowledged,setAcknowledged]=useState(false);
  const [rows,setRows]=useState<{key:string;policies:RecordRow[]}|null>(null);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [status,setStatus]=useState("");
  const [refresh,setRefresh]=useState(0);
  const idempotency=useRef("");
  const currentSite=worksites.find(w=>w.active&&w.id===siteId)?siteId:
    worksites.find(w=>w.active)?.id??0;
  const scopeKey=[organizationId,currentSite,role,metric,interval,refresh].join(":");
  const refreshList=useCallback(()=>setRefresh(n=>n+1),[]);
  useEffect(()=>{
    if(!currentSite)return;
    const controller=new AbortController();
    async function load(){
      setLoading(true);
      try{
        const query=new URLSearchParams({
          organizationId:String(organizationId),worksiteId:String(currentSite),
          jobProfileId:role,metricKind:metric,intervalMinutes:String(interval),
          mode:"manage",
        });
        const response=await fetch(root+"?"+query,{cache:"no-store",signal:controller.signal});
        const data=await response.json().catch(()=>({}));
        if(!response.ok||data.readOnly!==true||data.scope?.organizationId!==organizationId||
          data.scope?.worksiteId!==currentSite)throw new Error(data.error??"Policy list unavailable.");
        if(!controller.signal.aborted)setRows({key:scopeKey,policies:data.policies??[]});
      }catch(error){
        if(!controller.signal.aborted){setRows(null);setStatus(error instanceof Error?
          error.message:"Policy list unavailable.");}
      }finally{if(!controller.signal.aborted)setLoading(false);}
    }
    void load();return()=>controller.abort();
  },[organizationId,currentSite,role,metric,interval,scopeKey]);
  const policies=rows?.key===scopeKey?rows.policies:[];
  async function create(){
    if(saving||!currentSite||!acknowledged)return;
    setSaving(true);setStatus("");
    try{
      const id=idempotency.current||crypto.randomUUID().replaceAll("-","");
      idempotency.current=id;
      const response=await fetch(root,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        organizationId,worksiteId:currentSite,jobProfileId:role==="any"?null:Number(role),
        metricKind:metric,intervalMinutes:interval,effectiveFrom:from,effectiveUntil:until,
        productiveUnitsPerWorkerHour:Number(productivity),
        serviceTargetCoveragePercent:Number(target),rationale:reason.trim(),idempotencyKey:id,
      })});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error??"Proposal not saved.");
      setStatus("Draft #"+data.id+" v"+data.version+" saved. Author must submit; independent owner/admin decides.");
      idempotency.current="";setAcknowledged(false);refreshList();
    }catch(error){setStatus(error instanceof Error?error.message:"Proposal could not be created.");}
    finally{setSaving(false);}
  }
  async function decide(policyId:number,action:"submit"|"approve"|"reject"){
    if(saving||!acknowledged)return;
    setSaving(true);setStatus("");
    try{
      const response=await fetch(root,{method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          organizationId,policyId,action,acknowledged:true,
          decisionNote:action==="submit"?"":decision.trim(),
        }),
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error??"Policy transition declined.");
      setStatus("Policy #"+policyId+" status: "+data.status+
        (data.approvalReceiptSha256?" · receipt "+data.approvalReceiptSha256.slice(0,12):""));
      setAcknowledged(false);setDecision("");refreshList();
    }catch(error){setStatus(error instanceof Error?error.message:"Could not decide policy.");}
    finally{setSaving(false);}
  }
  return (
    <section data-wfm-policy-admin id="wfm-staffing-policy-admin"
      style={{padding:"0 18px 18px"}}>
      <article className="card" style={{margin:0}}>
        <div className="card-header"><div>
          <div className="card-kicker">People admin · controlled staffing rules</div>
          <h3>Propose, submit and independently approve staffing assumptions</h3>
          <p>Policies are scoped by worksite, role and demand metric. Draft values never
            change a roster. Another owner/admin must approve the exact submitted version.</p>
        </div></div>
        <div className="setting-form" style={{padding:"0 18px 16px"}}>
          <label>Policy worksite
            <select aria-label="Policy worksite" value={currentSite||""}
              onChange={e=>{setSiteId(Number(e.target.value));setStatus("");}}>
              {worksites.filter(w=>w.active).map(w=>
                <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
            </select>
          </label>
          <label>Role / job profile
            <select aria-label="Policy role" value={role}
              onChange={e=>{setRole(e.target.value);setStatus("");}}>
              <option value="any">Generic requirement (not a role fallback)</option>
              {jobProfiles.filter(p=>p.active).map(p=>
                <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          <label>Activity metric
            <select aria-label="Policy activity metric" value={metric}
              onChange={e=>setMetric(e.target.value as (typeof types)[number])}>
              {types.map(v=><option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label>Forecast interval
            <select aria-label="Policy forecast interval" value={interval}
              onChange={e=>setInterval(Number(e.target.value) as 15|30|60)}>
              {[15,30,60].map(v=><option key={v} value={v}>{v} minutes</option>)}
            </select>
          </label>
          <label>Effective from (PH calendar)<input type="date" value={from}
            onChange={e=>setFrom(e.target.value)} /></label>
          <label>Effective until (inclusive)<input type="date" value={until}
            onChange={e=>setUntil(e.target.value)} /></label>
          <label>Productive activity units per worker-hour<input type="number"
            step="0.0001" min="0.01" max="1000000" value={productivity}
            onChange={e=>setProductivity(e.target.value)} /></label>
          <label>Target coverage (%)<input type="number" step="0.01" min="0.01" max="100"
            value={target} onChange={e=>setTarget(e.target.value)} /></label>
          <label>Policy evidence and rationale<textarea value={reason}
            onChange={e=>setReason(e.target.value)} maxLength={400}
            placeholder="Explain source, workload units, service target and effective dates. No employee PII." />
          </label>
        </div>
        <label style={{display:"flex",gap:8,padding:"0 18px 14px"}}>
          <input type="checkbox" checked={acknowledged}
            onChange={e=>setAcknowledged(e.target.checked)}/>
          I understand policy proposals and decisions are separately audited;
          this action cannot approve or publish employee shifts.
        </label>
        <div style={{padding:"0 18px 18px",display:"flex",gap:8,flexWrap:"wrap"}}>
          <button type="button" className="primary-button brand" onClick={()=>void create()}
            disabled={saving||!acknowledged||!currentSite||!from||!until||
              !productivity||!target||reason.trim().length<12}>
            Save immutable draft
          </button>
          <button type="button" className="secondary-button" onClick={()=>refreshList()}
            disabled={loading||saving}>Refresh policies</button>
        </div>
        <p className="id" style={{padding:"0 18px 12px"}}>
          Approval decisions require a different signed-in owner/admin, recent MFA in
          protected environments, and a reason of at least 12 characters. No self-approval.</p>
        <label style={{display:"block",padding:"0 18px 16px"}}>Decision justification
          <textarea value={decision} onChange={e=>setDecision(e.target.value)} maxLength={400}
            placeholder="Required for approve/reject. Evidence, authority and policy rationale." />
        </label>
        {status&&<div className="notice notice-slate" role="status"
          style={{margin:"0 18px 16px"}}>{status}</div>}
        <div className="data-table-wrap slim-scroll" style={{overflowX:"auto"}}>
          <table className="data-table" aria-label="Versioned staffing policy approval queue">
            <thead><tr>
              <th scope="col">Version and status</th>
              <th scope="col">Effective dates</th>
              <th scope="col">Units/hour · target</th>
              <th scope="col">Integrity</th>
              <th scope="col">Actions</th>
            </tr></thead>
            <tbody>
              {policies.slice(0,30).map(p=><tr key={p.id}>
                <td>#{p.id} · v{p.version}<small style={{display:"block"}}>{p.status}</small></td>
                <td>{p.effectiveFrom} – {p.effectiveUntil}</td>
                <td>{p.productiveUnitsPerWorkerHour} · {p.serviceTargetCoveragePercent}%</td>
                <td>{p.approvalIntegrity}</td>
                <td>
                  {p.status==="draft"&&<button type="button" className="secondary-button"
                    disabled={!acknowledged||saving||p.approvalIntegrity!=="matches_hash"}
                    onClick={()=>void decide(p.id,"submit")}>Submit for approval</button>}
                  {p.status==="submitted"&&<>
                    <button type="button" className="secondary-button"
                      disabled={!acknowledged||saving||decision.trim().length<12||
                        p.approvalIntegrity!=="matches_hash"}
                      onClick={()=>void decide(p.id,"approve")}>Approve</button>
                    <button type="button" className="secondary-button"
                      disabled={!acknowledged||saving||decision.trim().length<12||
                        p.approvalIntegrity!=="matches_hash"}
                      onClick={()=>void decide(p.id,"reject")}>Reject</button>
                  </>}
                  {p.status==="approved"&&<small>Approved receipt: {p.approvalReceiptSha256?.slice(0,12)??"Missing"}</small>}
                </td>
              </tr>)}
            </tbody>
          </table>
        </div>
        {policies.length===0&&!loading&&<p className="id" style={{padding:"0 18px 18px"}}>
          No proposals yet for this exact scope. Never assume a default policy.</p>}
        <div className="notice notice-slate" style={{margin:"16px 18px"}}>
          Approved policies authorize planning assumptions only. Manager review, rest/leave,
          eligibility, overtime and existing roster-stage approvals remain separate controls.
        </div>
      </article>
    </section>
  );
}
