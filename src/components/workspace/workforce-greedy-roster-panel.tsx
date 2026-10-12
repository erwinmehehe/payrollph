"use client";

import { useEffect, useRef, useState } from "react";
import { phWorkDateAt } from "@/lib/workforce-manager-actions";
import type { GreedyRosterResult, GreedyRosterReason } from "@/lib/workforce-greedy-roster";

type Site = { id:number;code:string;name:string;active:boolean };
type Preview=GreedyRosterResult & {source:{
  organizationId:number;worksiteId:number;startDate:string;endDate:string;
  slotCount:number;candidateCount:number;fairness:string;
}};
const descriptions:Record<GreedyRosterReason,string>={
  no_workers:"No workers in the authorized roster",
  already_assigned:"Qualified worker already occupies this requirement slot",
  skill_missing:"Missing role, skill or required credential",
  site_ineligible:"Worksite authorization does not permit the shift",
  unavailable:"Recorded unavailable time conflicts with shift",
  approved_leave:"Approved leave conflicts with shift",
  source_unknown:"Insufficient verified roster or eligibility evidence",
  designated_rest_day:"Employee-designated rest day",
  overlapping_shift:"Overlaps an existing or proposed shift",
  minimum_rest:"Insufficient rest between shifts",
  rolling_week_cap:"Rolling seven-day hours rule",
  daily_hours_cap:"Daily paid-hours safeguard",
  overtime_approval:"Overtime exceeds approved minutes",
  other_roster_rule:"Another company scheduling rule blocks this candidate",
};
const nextDate=(date:string,delta:number)=>new Date(Date.parse(date+"T00:00:00Z")+delta*86_400_000).toISOString().slice(0,10);

export function WorkforceGreedyRosterPanel({organizationId,worksites}:{
  organizationId:number;worksites:Site[];
}) {
  const [siteId,setSiteId]=useState("");
  const [firstDate,setFirstDate]=useState(()=>nextDate(phWorkDateAt(),1));
  const [lastDate,setLastDate]=useState(()=>nextDate(phWorkDateAt(),7));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<{scope:string;message:string}|null>(null);
  const [preview,setPreview]=useState<{scope:string;result:Preview}|null>(null);
  const controller=useRef<AbortController|null>(null);
  const scope=JSON.stringify([organizationId,siteId,firstDate,lastDate]);
  const scopeNow=useRef(scope);
  scopeNow.current=scope;
  useEffect(()=>()=>{controller.current?.abort();},[scope]);
  const visible=preview?.scope===scope?preview.result:null;
  const currentError=error?.scope===scope?error.message:null;
  async function generate(){
    if(!siteId||busy)return;
    controller.current?.abort();
    const abort=new AbortController();
    controller.current=abort;
    const requested=scope;
    setBusy(true);
    setError(null);
    setPreview(null);
    try{
      const params=new URLSearchParams({organizationId:String(organizationId),
        worksiteId:siteId,startDate:firstDate,endDate:lastDate});
      const response=await fetch("/api/workforce/greedy-roster?"+params,{signal:abort.signal,cache:"no-store"});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(body.error??"Roster preview unavailable");
      if(body?.source?.organizationId!==organizationId||
        body?.source?.worksiteId!==Number(siteId)||
        body?.source?.startDate!==firstDate||body?.source?.endDate!==lastDate) {
        throw Error("Roster preview returned an unexpected employer/site/date scope.");
      }
      if(!abort.signal.aborted&&scopeNow.current===requested)
        setPreview({scope:requested,result:body as Preview});
    }catch(e){
      if(!abort.signal.aborted&&scopeNow.current===requested)
        setError({scope:requested,message:e instanceof Error?e.message:"Roster preview unavailable"});
    }finally{
      if(controller.current===abort)setBusy(false);
    }
  }
  return <section className="card" data-wfm-greedy-roster
    style={{margin:"0 18px 18px",padding:18}} aria-label="Suggested greedy roster">
    <div className="card-header">
      <div>
        <div className="card-kicker">Read-only staffing draft</div>
        <h3>Generate a balanced roster</h3>
        <p>Fill verified staffing requirements using approved availability, leave, qualifications and schedule guardrails. Spread hours and rotate unpopular shifts. No shifts are published.</p>
      </div>
    </div>
    <div className="run-actions" style={{flexWrap:"wrap",alignItems:"end",gap:12}}>
      <label>Worksite<select aria-label="Greedy roster worksite" value={siteId}
        onChange={e=>setSiteId(e.target.value)}>
        <option value="">Select a worksite</option>
        {worksites.filter(site=>site.active).map(site=><option value={site.id} key={site.id}>
          {site.code} - {site.name}
        </option>)}
      </select></label>
      <label>From<input aria-label="Greedy roster start date" type="date" value={firstDate}
        onChange={e=>setFirstDate(e.target.value)} /></label>
      <label>Through<input aria-label="Greedy roster end date" type="date" value={lastDate}
        onChange={e=>setLastDate(e.target.value)} /></label>
      <button type="button" className="primary-button brand" disabled={!siteId||busy}
        onClick={()=>void generate()}>{busy?"Reviewing source...":"Generate suggestion"}</button>
    </div>
    <p className="id">Future PH dates only, maximum 14 days, 100 requirements, 1,000 authorized workers and 200 positions. Insufficient evidence leaves positions unfilled; it never guesses staff eligibility.</p>
    {currentError&&<div className="notice notice-red" role="alert">{currentError}</div>}
    {visible&&<>
      <div className="stats-grid" role="status" style={{marginTop:12}}>
        <div className="metric"><span className="metric-label">Required positions</span><strong>{visible.summary.required}</strong></div>
        <div className="metric"><span className="metric-label">Already rostered</span><strong>{visible.summary.existing}</strong></div>
        <div className="metric"><span className="metric-label">Suggested additions</span><strong>{visible.summary.suggested}</strong></div>
        <div className="metric"><span className="metric-label">Still unfilled</span><strong>{visible.summary.unfilled}</strong></div>
      </div>
      <div className="notice notice-amber" role="note">Every proposed shift requires individual authorization, current evidence rechecks and independent roster/premium approval. Fairness is a deterministic heuristic, not an employment or pay entitlement.</div>
      <h4>Proposed roster</h4>
      {visible.roster.length===0?<p>No verified workers could be assigned.</p>:<div style={{overflowX:"auto"}}>
        <table className="data-table"><thead><tr><th>Date</th><th>Requirement</th><th>Employee</th>
          <th>Shift</th><th>Type</th><th>Hours</th><th>Review</th></tr></thead>
          <tbody>{visible.roster.map((a,i)=><tr key={a.requirementId+"-"+a.employeeId+"-"+i}>
            <td>{a.workDate}</td><td>#{a.requirementId}</td><td>{a.employeeName}</td>
            <td>#{a.shiftDefinitionId}</td><td>{a.source==="existing"?"Existing":"Suggested"}</td>
            <td>{(a.paidMinutes/60).toFixed(1)}h</td>
            <td>{a.warnings.join("; ")||"Publish approval required"}</td>
          </tr>)}</tbody></table>
      </div>}
      <h4>Unfilled positions and reasons</h4>
      {visible.unfilled.length===0?<p>No gaps in the selected recorded demand.</p>:<div style={{overflowX:"auto"}}>
        <table className="data-table"><thead><tr><th>Date</th><th>Requirement</th>
          <th>Position</th><th>Most common blocker</th><th>Other evidence</th></tr></thead>
          <tbody>{visible.unfilled.map(slot=><tr key={slot.requirementId+"-"+slot.position}>
            <td>{slot.workDate}</td><td>#{slot.requirementId}</td><td>{slot.position}</td>
            <td>{descriptions[slot.reason]}</td><td>{slot.evidence.map(item=>
              descriptions[item.code]+" ("+item.candidates+")").join("; ")||"No eligible workers"}
            </td>
          </tr>)}</tbody></table>
      </div>}
      <p className="id">{visible.source.candidateCount} authorized workers considered. {visible.source.fairness}. {visible.boundary}</p>
    </>}
  </section>;
}
