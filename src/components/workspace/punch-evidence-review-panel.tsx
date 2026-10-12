"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {canApproveReviewedPunch,punchTimestampGapMinutes,type ReviewedTimeSource} from "@/lib/workforce-punch-review-ui";

type ReviewRow={
  id:number;name:string;actionType:string;workDate:string;
  deviceOccurredAt:string;serverReceivedAt:string;receivedSource:string;
  flags:string[];photoEvidenceId:string|null;
};

/** The employer key prevents a prior tenant's review rows or form state from flashing on switch. */
export function PunchEvidenceReviewPanel({organizationId}:{organizationId:number}){
  return <PunchEvidenceReviewView key={organizationId} organizationId={organizationId}/>;
}
function PunchEvidenceReviewView({organizationId}:{organizationId:number}){
  const [rows,setRows]=useState<ReviewRow[]>([]);
  const [error,setError]=useState("");
  const [warning,setWarning]=useState("");
  const [busy,setBusy]=useState<number|null>(null);
  const [notes,setNotes]=useState<Record<number,string>>({});
  const [timeSource,setTimeSource]=useState<Record<number,ReviewedTimeSource>>({});
  const requestGeneration=useRef(0);

  const load=useCallback(async(signal?:AbortSignal)=>{
    const request=++requestGeneration.current;
    const response=await fetch(`/api/web-bundy/review?organizationId=${organizationId}`,{
      cache:"no-store",signal,
    });
    if(response.status===404){
      if(!signal?.aborted&&request===requestGeneration.current)setRows([]);
      return;
    }
    const body=await response.json() as {submissions?:ReviewRow[];error?:string};
    if(!response.ok)throw Error(body.error??"Review queue unavailable");
    if(!signal?.aborted&&request===requestGeneration.current)
      setRows(body.submissions??[]);
  },[organizationId]);

  const refresh=useCallback(async(signal?:AbortSignal)=>{
    try{
      await load(signal);
      if(!signal?.aborted)setError("");
    }catch(cause){
      if(!signal?.aborted)setError(cause instanceof Error?cause.message:"Review queue unavailable");
    }
  },[load]);
  useEffect(()=>{
    const controller=new AbortController();
    // Load after the effect commits; avoid synchronous cascading React state
    // changes when the review panel mounts or the employer changes.
    const handle=window.setTimeout(()=>{void refresh(controller.signal);},0);
    return ()=>{
      window.clearTimeout(handle);
      // All request continuations check the aborted signal before updating UI.
      // Avoid reading a mutable ref in effect cleanup (React hooks lint).
      controller.abort();
    };
  },[refresh]);

  async function decide(row:ReviewRow,decision:"approved"|"rejected"){
    if(busy!==null)return;
    const note=notes[row.id]??"";
    if(note.trim().length<10||(decision==="approved"
      &&!canApproveReviewedPunch(note,timeSource[row.id],false))){
      setError("Write a 10-character review rationale and explicitly choose the approved timestamp.");
      return;
    }
    setBusy(row.id);setError("");setWarning("");
    try{
      const response=await fetch("/api/web-bundy/review",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({
          organizationId,id:row.id,decision,note,
          timeSource:decision==="approved"?(timeSource[row.id]??""):"",
        }),
      });
      const body=await response.json() as {error?:string;warning?:string};
      if(!response.ok)throw Error(body.error??"Decision failed");
      await refresh();
      if(body.warning)setWarning(body.warning);
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Review failed");
    }finally{setBusy(null);}
  }
  return <div className="card" style={{marginTop:16,padding:16}}>
    <h3>Enhanced punch evidence — independent approval</h3>
    <p>Signals assist review only. Neither shared devices nor travel flags automatically deduct pay. The original submitter cannot approve their own entry.</p>
    <button className="secondary-button" type="button" disabled={busy!==null}
      onClick={()=>void refresh()}>Refresh pending punches</button>
    {error&&<p role="alert">{error}</p>}
    {warning&&<p role="status">{warning}</p>}
    {rows.length===0&&<p>No pending enhanced punches.</p>}
    {rows.map(row=>{
      const gap=punchTimestampGapMinutes(row.deviceOccurredAt,row.serverReceivedAt);
      const mayApprove=canApproveReviewedPunch(
        notes[row.id]??"",timeSource[row.id],busy!==null);
      return <article key={row.id} style={{border:"1px solid var(--border)",borderRadius:10,marginTop:10,padding:12}}>
        <h4>{row.name} · {row.actionType.replaceAll("_"," ")} · {row.workDate}</h4>
        <p>Device: {new Date(row.deviceOccurredAt).toLocaleString("en-PH",{timeZone:"Asia/Manila"})}
          {" · "}Received: {new Date(row.serverReceivedAt).toLocaleString("en-PH",{timeZone:"Asia/Manila"})}</p>
        <p>Source: {row.receivedSource} · Signals: {row.flags.length?row.flags.join(", "):"None"}</p>
        {gap!==null&&gap>10&&<p role="status">Device and server timestamps differ by {gap} minutes.
          Verify the time source and actual work with the employee before deciding. Do not automatically remove earned time.</p>}
        {row.photoEvidenceId&&<a href={`/api/web-bundy/review?organizationId=${organizationId}&photoId=${encodeURIComponent(row.photoEvidenceId)}`}
          target="_blank" rel="noopener noreferrer">View restricted photo evidence</a>}
        <label>Timestamp to approve (explicit reviewer selection required)
          <select value={timeSource[row.id]??""}
            onChange={event=>setTimeSource(prev=>({...prev,[row.id]:event.target.value as ReviewedTimeSource}))}>
            <option value="" disabled>Choose the time supported by evidence</option>
            <option value="server">Server-received timestamp</option>
            <option value="device">Device-reported timestamp (verify skew)</option>
          </select>
        </label>
        <label>Independent review note (at least 10 characters)
          <textarea value={notes[row.id]??""} onChange={event=>setNotes(prev=>({...prev,[row.id]:event.target.value}))}/>
        </label>
        <div style={{display:"flex",gap:8}}>
          <button type="button" className="primary-button" disabled={!mayApprove}
            onClick={()=>void decide(row,"approved")}>Approve for attendance</button>
          <button type="button" className="secondary-button" disabled={busy!==null||(notes[row.id]?.trim().length??0)<10}
            onClick={()=>void decide(row,"rejected")}>Reject with note</button>
        </div>
      </article>;
    })}
  </div>;
}
