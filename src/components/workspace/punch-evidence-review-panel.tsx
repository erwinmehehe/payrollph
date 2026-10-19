"use client";
import {useEffect,useState} from "react";
import {canApproveReviewedPunch,punchTimestampGapMinutes,type ReviewedTimeSource}
  from "@/lib/workforce-punch-review-ui";
import {
  isVerifiedPunchDecisionReceipt,readVerifiedPunchReviewQueue,type VerifiedPunchReviewRow,
} from "@/lib/workforce-punch-review-read";

/** An employer change tears down all prior source rows, evidence links and reviewer state. */
export function PunchEvidenceReviewPanel({organizationId}:{organizationId:number}){
  if(!Number.isSafeInteger(organizationId)||organizationId<=0)
    return <div className="card" role="status">Select a valid employer before reviewing enhanced punches.</div>;
  return <PunchEvidenceReviewView key={organizationId} organizationId={organizationId}/>;
}

function PunchEvidenceReviewView({organizationId}:{organizationId:number}){
  const [version,setVersion]=useState(0);
  const [snapshot,setSnapshot]=useState<{
    version:number; rows:VerifiedPunchReviewRow[]|null; error:string;
  }|null>(null);
  const [outcomeError,setOutcomeError]=useState("");
  const [notice,setNotice]=useState("");
  const [warning,setWarning]=useState("");
  const [busy,setBusy]=useState<number|null>(null);
  const [notes,setNotes]=useState<Record<number,string>>({});
  const [timeSource,setTimeSource]=useState<Record<number,ReviewedTimeSource>>({});

  useEffect(()=>{
    const controller=new AbortController();
    // Defer the GET to avoid synchronous state changes during effect setup.
    queueMicrotask(()=>{
      if(controller.signal.aborted)return;
      void readVerifiedPunchReviewQueue(organizationId,fetch,controller.signal)
        .then(payload=>{
          if(!controller.signal.aborted)
            setSnapshot({version,rows:payload.submissions,error:""});
        })
        .catch(cause=>{
          if(!controller.signal.aborted)
            setSnapshot({version,rows:null,error:cause instanceof Error
              ?cause.message:"Enhanced punch review unavailable."});
        });
    });
    return ()=>controller.abort();
  },[organizationId,version]);

  const current=snapshot?.version===version?snapshot:null;
  const loading=current===null;
  const error=current?.error??"";
  const rows=current?.rows??null;
  const actionable=!loading&&!error&&!outcomeError&&busy===null&&rows!==null;

  function reload(clearOutcome=true){
    if(busy!==null)return;
    setNotes({});setTimeSource({});
    if(clearOutcome){setOutcomeError("");setNotice("");setWarning("");}
    setVersion(value=>value+1);
  }

  async function decide(row:VerifiedPunchReviewRow,decision:"approved"|"rejected"){
    if(!actionable||!rows?.some(candidate=>candidate.id===row.id))return;
    const note=notes[row.id]??"";
    const source=timeSource[row.id];
    if(note.trim().length<10||note.trim().length>240||
       (decision==="approved"&&!canApproveReviewedPunch(note,source,false))){
      setOutcomeError("Provide a review rationale of 10–240 characters and choose the evidence-backed timestamp.");
      return;
    }
    setBusy(row.id);setOutcomeError("");setNotice("");setWarning("");
    try{
      const response=await fetch("/api/web-bundy/review",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({
          organizationId,id:row.id,decision,note:note.trim(),
          timeSource:decision==="approved"?(source??""):"",
        }),
      });
      const body:unknown=await response.json().catch(()=>null);
      if(!response.ok)throw Error("Review could not be confirmed. Recheck the pending queue before another attempt.");
      if(!isVerifiedPunchDecisionReceipt(body,organizationId,row,decision)){
        throw Error("Review receipt was incomplete or mismatched. Reload the queue; do not resubmit blindly.");
      }
      setNotice(decision==="approved"
        ?"Attendance review was recorded. Check the refreshed queue before further decisions."
        :"Punch evidence rejection was recorded. No attendance time was approved.");
      if(body.warning)setWarning(body.warning);
    }catch(cause){
      // A network failure can happen AFTER the server commits an attendance write.
      // Do not offer a repeat approval on the same cached source evidence.
      setOutcomeError(cause instanceof Error?cause.message:
        "Review outcome is unverified; refresh the authoritative queue.");
    }finally{
      setBusy(null);setNotes({});setTimeSource({});
      // Hide the old actionable rows immediately and trigger an authoritative GET.
      setVersion(value=>value+1);
    }
  }

  return <div className="card" style={{marginTop:16,padding:16}}>
    <h3>Enhanced punch evidence — independent approval</h3>
    <p>Signals assist review only. Neither shared devices nor travel flags automatically deduct pay.
      The original submitter cannot approve their own entry.</p>
    <button className="secondary-button" type="button" disabled={busy!==null||loading}
      onClick={()=>reload()}>Refresh pending punches</button>
    {loading&&<p role="status">Loading verified, employer-scoped punch evidence…</p>}
    {error&&<p role="alert">{error} <button type="button" onClick={()=>reload()}>Retry review queue</button></p>}
    {outcomeError&&<p role="alert">{outcomeError} Use Refresh to verify source records before another decision.</p>}
    {notice&&<p role="status">{notice}</p>}
    {warning&&<p role="status">{warning}</p>}
    {actionable&&rows.length===0&&<p>No pending enhanced punches in the verified current queue.</p>}
    {!loading&&!error&&rows!==null&&rows.length>0&&
      <div>{rows.map(row=>{
        const gap=punchTimestampGapMinutes(row.deviceOccurredAt,row.serverReceivedAt);
        const mayApprove=actionable&&canApproveReviewedPunch(notes[row.id]??"",timeSource[row.id],false)
          &&(notes[row.id]?.trim().length??0)<=240;
        return <article key={row.id} style={{border:"1px solid var(--border)",borderRadius:10,marginTop:10,padding:12}}>
          <h4>{row.name} · {row.actionType.replaceAll("_"," ")} · {row.workDate}</h4>
          <p>Device: {new Date(row.deviceOccurredAt).toLocaleString("en-PH",{timeZone:"Asia/Manila"})}
            {" · "}Received: {new Date(row.serverReceivedAt).toLocaleString("en-PH",{timeZone:"Asia/Manila"})}</p>
          <p>Source: {row.receivedSource} · Signals: {row.flags.length?row.flags.join(", "):"None"}</p>
          {gap!==null&&gap>10&&<p role="status">Device and server timestamps differ by {gap} minutes.
            Verify the time source and actual work with the employee before deciding.
            Do not automatically remove earned time.</p>}
          {row.photoEvidenceId&&<a
            href={"/api/web-bundy/review?organizationId="+organizationId+"&photoId="+encodeURIComponent(row.photoEvidenceId)}
            target="_blank" rel="noopener noreferrer">View restricted photo evidence</a>}
          <label>Timestamp to approve (explicit reviewer selection required)
            <select value={timeSource[row.id]??""} disabled={!actionable}
              onChange={event=>setTimeSource(prev=>({...prev,[row.id]:event.target.value as ReviewedTimeSource}))}>
              <option value="" disabled>Choose the time supported by evidence</option>
              <option value="server">Server-received timestamp</option>
              <option value="device">Device-reported timestamp (verify skew)</option>
            </select>
          </label>
          <label>Independent review note (10–240 characters)
            <textarea value={notes[row.id]??""} disabled={!actionable} maxLength={240}
              onChange={event=>setNotes(prev=>({...prev,[row.id]:event.target.value}))}/>
          </label>
          <div style={{display:"flex",gap:8}}>
            <button type="button" className="primary-button" disabled={!mayApprove}
              onClick={()=>void decide(row,"approved")}>Approve for attendance</button>
            <button type="button" className="secondary-button"
              disabled={!actionable||(notes[row.id]?.trim().length??0)<10||(notes[row.id]?.trim().length??0)>240}
              onClick={()=>void decide(row,"rejected")}>Reject with note</button>
          </div>
        </article>;
      })}</div>}
  </div>;
}
