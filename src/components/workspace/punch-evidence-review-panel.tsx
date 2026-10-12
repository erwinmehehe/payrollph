"use client";
import {useCallback,useEffect,useState} from "react";
type ReviewRow={id:number;name:string;actionType:string;workDate:string;deviceOccurredAt:string;serverReceivedAt:string;receivedSource:string;flags:string[];photoEvidenceId:string|null};
export function PunchEvidenceReviewPanel({organizationId}:{organizationId:number}){
  const [rows,setRows]=useState<ReviewRow[]>([]);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState<number|null>(null);
  const [notes,setNotes]=useState<Record<number,string>>({});
  const [timeSource,setTimeSource]=useState<Record<number,"device"|"server">>({});
  const load=useCallback(async()=>{
    const r=await fetch(`/api/web-bundy/review?organizationId=${organizationId}`,{cache:"no-store"});
    if(r.status===404){setRows([]);return;}
    const d=await r.json() as {submissions?:ReviewRow[];error?:string};
    if(!r.ok)throw Error(d.error??"Review queue unavailable");
    setRows(d.submissions??[]);
  },[organizationId]);
  useEffect(()=>{let active=true;void load().catch(e=>{if(active)setError(String(e));});return()=>{active=false;};},[load]);
  async function decide(row:ReviewRow,decision:"approved"|"rejected"){
    setBusy(row.id);setError("");
    try{
      const r=await fetch("/api/web-bundy/review",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({organizationId,id:row.id,decision,note:notes[row.id]??"",timeSource:timeSource[row.id]??"server"})});
      const b=await r.json() as {error?:string};
      if(!r.ok)throw Error(b.error??"Decision failed");
      await load();
    }catch(e){setError(e instanceof Error?e.message:"Review failed");}
    finally{setBusy(null);}
  }
  return <div className="card" style={{marginTop:16,padding:16}}>
    <h3>Enhanced punch evidence — independent approval</h3>
    <p>Signals assist review only. Neither device sharing nor travel flags automatically deduct pay. Select the timestamp to accept and record a decision rationale. The original submitter cannot approve their own entry.</p>
    <button className="secondary-button" type="button" onClick={()=>void load()}>Refresh pending punches</button>
    {error&&<p role="alert">{error}</p>}
    {rows.length===0&&<p>No pending enhanced punches.</p>}
    {rows.map(row=><article key={row.id} style={{border:"1px solid var(--border)",borderRadius:10,marginTop:10,padding:12}}>
      <h4>{row.name} · {row.actionType.replaceAll("_"," ")} · {row.workDate}</h4>
      <p>Device: {new Date(row.deviceOccurredAt).toLocaleString("en-PH",{timeZone:"Asia/Manila"})} · Received: {new Date(row.serverReceivedAt).toLocaleString("en-PH",{timeZone:"Asia/Manila"})}</p>
      <p>Source: {row.receivedSource} · Signals: {row.flags.length?row.flags.join(", "):"None"}</p>
      {row.photoEvidenceId&&<a href={`/api/web-bundy/review?organizationId=${organizationId}&photoId=${encodeURIComponent(row.photoEvidenceId)}`} target="_blank" rel="noopener noreferrer">View restricted photo evidence</a>}
      <label>Approved timestamp
        <select value={timeSource[row.id]??"server"} onChange={e=>setTimeSource(p=>({...p,[row.id]:e.target.value as "device"|"server"}))}>
          <option value="server">Server-received timestamp</option><option value="device">Device timestamp (verify skew)</option>
        </select>
      </label>
      <label>Independent review note (at least 10 characters)
        <textarea value={notes[row.id]??""} onChange={e=>setNotes(p=>({...p,[row.id]:e.target.value}))}/>
      </label>
      <div style={{display:"flex",gap:8}}>
        <button type="button" className="primary-button" disabled={busy!==null||(notes[row.id]?.trim().length??0)<10} onClick={()=>void decide(row,"approved")}>Approve for attendance</button>
        <button type="button" className="secondary-button" disabled={busy!==null||(notes[row.id]?.trim().length??0)<10} onClick={()=>void decide(row,"rejected")}>Reject with note</button>
      </div>
    </article>)}
  </div>;
}
