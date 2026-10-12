"use client";
import { useCallback, useEffect, useState } from "react";
type Receipt = {
 id:string;employeeId:number;actionType:string;worksiteId:number|null;
 deviceTimestamp:string;serverReceivedAt:string;status:string;flags:string[];
};
export function OfflinePunchReviewPanel({organizationId}:{organizationId:number}){
 const [receipts,setReceipts]=useState<Receipt[]>([]);
 const [reason,setReason]=useState<Record<string,string>>({});
 const [error,setError]=useState("");
 const [busy,setBusy]=useState<string|null>(null);
 const refresh=useCallback(async()=>{
  const r=await fetch(`/api/workforce/offline-punches?organizationId=${organizationId}`,{cache:"no-store"});
  if(!r.ok)throw Error("Offline punch review is unavailable.");
  const data=await r.json() as {receipts:Receipt[]};
  setReceipts(data.receipts);
 },[organizationId]);
 useEffect(()=>{let active=true;void refresh().catch(()=>{if(active)setError("Review queue unavailable.");});
   return()=>{active=false};},[refresh]);
 async function decide(id:string,decision:"reviewed"|"rejected"){
   setBusy(id);setError("");
   try{
    const r=await fetch("/api/workforce/offline-punches",{
     method:"POST",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({organizationId,action:"review",id,decision,reason:reason[id]??""}),
    });
    if(!r.ok){const data=await r.json().catch(()=>({}));throw Error(data.error??"Review rejected.");}
    await refresh();
   }catch(cause){setError(cause instanceof Error?cause.message:"Review failed.");}
   finally{setBusy(null);}
 }
 return <section className="space-y-4 p-6">
 <h1 className="text-2xl font-semibold">Offline punch evidence review</h1>
 <p>All offline items require human review. Marking reviewed never inserts attendance or changes payroll.
    Use the separate governed attendance-correction workflow to apply accepted time.</p>
 {error&&<p role="alert">{error}</p>}
 {receipts.map(receipt=><article key={receipt.id} className="space-y-2 rounded border p-3">
  <h2>Employee #{receipt.employeeId} · {receipt.actionType}</h2>
  <p>Device: {new Date(receipt.deviceTimestamp).toLocaleString("en-PH")} ·
    Received: {new Date(receipt.serverReceivedAt).toLocaleString("en-PH")}</p>
  <p>Signals: {(receipt.flags??[]).join(", ")||"No automated flags"}. Signals are not disciplinary findings.</p>
  <label>Reason <textarea value={reason[receipt.id]??""} onChange={e=>
    setReason(prev=>({...prev,[receipt.id]:e.target.value}))} className="w-full rounded border p-2"/></label>
  <div className="flex gap-3">
   <button disabled={busy!==null} onClick={()=>void decide(receipt.id,"reviewed")}
     className="secondary-button">Reviewed</button>
   <button disabled={busy!==null} onClick={()=>void decide(receipt.id,"rejected")}
     className="secondary-button">Reject evidence</button>
  </div>
 </article>)}
 {receipts.length===0&&<p>No pending review receipts for your authorized scope.</p>}
 </section>;
}
