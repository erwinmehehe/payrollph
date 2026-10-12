"use client";
import { useEffect, useState } from "react";
import type { WfmRosterRulePolicy } from "@/lib/workforce-roster-rules";
type Loaded = {organizationId:number;policy:WfmRosterRulePolicy;configured:boolean};
export function WfmRosterRulePolicyPanel({organizationId,canManage}:{organizationId:number;canManage:boolean}){
  const [loaded,setLoaded]=useState<Loaded|null>(null);
  const [hiddenOrg,setHiddenOrg]=useState<number|null>(null);
  const [draft,setDraft]=useState<Loaded|null>(null);
  const [saving,setSaving]=useState(false);
  const [reason,setReason]=useState("");
  const [error,setError]=useState("");
  useEffect(()=>{
    let active=true;const controller=new AbortController();
    const fetchRules=async()=>{
      const res=await fetch(`/api/workforce/roster-rules?organizationId=${organizationId}`,
        {cache:"no-store",signal:controller.signal});
      if(res.status===404){if(active)setHiddenOrg(organizationId);return;}
      const body=await res.json();
      if(!res.ok)throw Error(body.error??"Roster rules unavailable");
      if(active&&!controller.signal.aborted){
        const next={organizationId,policy:body.policy as WfmRosterRulePolicy,configured:Boolean(body.configured)};
        setHiddenOrg(null);setLoaded(next);setDraft(next);
      }
    };
    void fetchRules().catch(e=>{if(active&&!controller.signal.aborted)setError(e instanceof Error?e.message:"Roster rules unavailable");});
    return()=>{active=false;controller.abort();};
  },[organizationId]);
  if(hiddenOrg===organizationId)return null;
  const state=draft?.organizationId===organizationId?draft:loaded?.organizationId===organizationId?loaded:null;
  if(!state)return null;
  const policy=state.policy;
  const update=(key:keyof WfmRosterRulePolicy,value:number|boolean|string)=>{
    setDraft(old=>old?.organizationId===organizationId?
      {...old,policy:{...old.policy,[key]:value}}:old);
  };
  async function save(){
    if(!canManage||reason.trim().length<12)return;
    setSaving(true);setError("");
    try{
      const res=await fetch("/api/workforce/roster-rules",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({organizationId,action:"update_policy",reason:reason.trim(),...policy}),
      });
      const body=await res.json();
      if(!res.ok)throw Error(body.error??"Roster rule policy was not saved");
      setDraft({organizationId,policy:body.policy as WfmRosterRulePolicy,configured:true});
      setReason("");
    }catch(e){setError(e instanceof Error?e.message:"Unable to save");}
    finally{setSaving(false);}
  }
  const numbers=[
    ["maxDailyMinutes","Max paid minutes per day (default 720 / 12h)",480,1440],
    ["maxRollingSevenDayMinutes","Rolling 7-day paid minutes (default 2880 / 48h)",480,10080],
    ["minRestBetweenShiftsMinutes","Minimum between shifts (default 660 / 11h)",0,1440],
    ["ordinaryDailyMinutes","Ordinary daily minutes (default 480 / 8h)",480,720],
    ["approvedOvertimeCapMinutes","Approved overtime cap in minutes (0 = no tenant cap)",0,10080],
  ] as const;
  return <section className="card" data-wfm-roster-rules style={{padding:16,marginTop:16}}>
    <h3>Roster publish rules</h3>
    <p>Tenanted Philippine scheduling controls. Daily ordinary hours use Labor Code Articles 83/87; the other hour/rest caps are employer policy, not universal law. Overlaps and independently approved OT caps are never waived. Payroll alone computes premiums.</p>
    <div className="setting-form">
      {numbers.map(([key,title,min,max])=><label key={key}>{title}<input type="number" value={policy[key]}
        min={min} max={max} step={30} disabled={!canManage||saving}
        onChange={e=>update(key,Number(e.target.value))}/></label>)}
      <label>Enforcement<select value={policy.enforcementMode} disabled={!canManage||saving}
        onChange={e=>update("enforcementMode",e.target.value)}>
        <option value="block">Block unless a permitted, reasoned manager exception</option>
        <option value="advisory">Warn and require review</option>
      </select></label>
      <label>Rules<select value={policy.active?"active":"inactive"} disabled={!canManage||saving}
        onChange={e=>update("active",e.target.value==="active")}>
        <option value="active">Active</option><option value="inactive">Inactive (legacy overlap guard remains)</option>
      </select></label>
      {canManage&&<label>Policy change reason (12+ characters)
        <input value={reason} onChange={e=>setReason(e.target.value)} disabled={saving} maxLength={240}/>
      </label>}
    </div>
    {error&&<div className="notice notice-red" role="alert">{error}</div>}
    {canManage&&<button type="button" className="primary-button brand"
      disabled={saving||reason.trim().length<12} onClick={()=>void save()}>
      {saving?"Saving…":"Save roster rules (audited)"}
    </button>}
  </section>;
}
