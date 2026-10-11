"use client";

import { useEffect, useState } from "react";

type Site={id:number;code:string;name:string;active:boolean};
type Status={
  readOnly:true;
  scope:{organizationId:number;worksiteId:number;intervalMinutes:number;
    sourceKey:string;metricKind:string};
  lastStoredImportAt:string|null;lastStoredRevisionRows:number|null;
  lastAttemptAt:string|null;lastSuccessfulScanAt:string|null;
  lastSuccessfulWorkDate:string|null;lastFailedScanAt:string|null;
  status:"source_review"|"source_reported_only";
  boundary:string;
};
type Sync={
  applied:boolean;source:string;workDate:string;intervalMinutes:number;
  countedSales:number;scannedReceipts:number;scannedPages:number;
  changedIntervals:number;unchangedIntervals:number;
  observedAsOf:string;boundary:string;
};
const endpoint="/api/workforce/demand-observations/loyverse";
export function WorkforceLoyversePosPanel({organizationId,worksites,canManage}:{
  organizationId:number;worksites:Site[];canManage:boolean;
}){
  const [selected,setSelected]=useState<number|null>(null);
  const [date,setDate]=useState("");
  const [interval,setInterval]=useState<15|30|60>(30);
  const [ack,setAck]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const [stored,setStored]=useState<{key:string;data:Status}|null>(null);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [result,setResult]=useState<Sync|null>(null);
  const [busy,setBusy]=useState<"preview"|"import"|null>(null);
  const site=worksites.find(x=>x.active&&x.id===selected)??worksites.find(x=>x.active);
  const siteId=site?.id??0;
  const key=[organizationId,siteId,interval,refresh].join(":");
  useEffect(()=>{
    if(!siteId)return;
    const controller=new AbortController();
    async function load(){
      try{
        const params=new URLSearchParams({
          organizationId:String(organizationId),worksiteId:String(siteId),
          intervalMinutes:String(interval),
        });
        const response=await fetch(endpoint+"?"+params,{
          cache:"no-store",signal:controller.signal,
        });
        const data=await response.json().catch(()=>({})) as Partial<Status>&{error?:string};
        if(!response.ok||data.readOnly!==true||data.scope?.organizationId!==organizationId||
          data.scope?.worksiteId!==siteId||data.scope?.intervalMinutes!==interval||
          data.scope?.sourceKey!=="loyverse_pos_sales")throw Error(data.error??"Source scope is unavailable.");
        if(!controller.signal.aborted){setStored({key,data:data as Status});setError("");}
      }catch(e){
        if(!controller.signal.aborted){
          setStored(null);setError(e instanceof Error?e.message:"Source unavailable.");
        }
      }
    }
    void load();return()=>controller.abort();
  },[organizationId,siteId,interval,key]);
  const status=stored?.key===key?stored.data:null;
  async function run(dryRun:boolean){
    if(!canManage||busy||!ack||!date||!siteId)return;
    setBusy(dryRun?"preview":"import");setResult(null);setMessage("");
    try{
      const response=await fetch(endpoint,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          organizationId,worksiteId:siteId,workDate:date,
          intervalMinutes:interval,dryRun,acknowledged:true,
        }),
      });
      const data=await response.json().catch(()=>({})) as Partial<Sync>&{error?:string};
      if(!response.ok||data.source!=="loyverse_pos_sales"||
        data.workDate!==date||data.intervalMinutes!==interval||
        typeof data.applied!=="boolean")throw Error(data.error??"Source scan unavailable.");
      setResult(data as Sync);
      setMessage(dryRun?"Preview completed without aggregate import.":
        "Aggregate source revisions checked and changes stored.");
      if(!dryRun){setAck(false);setRefresh(i=>i+1);}
    }catch(e){setMessage(e instanceof Error?e.message:"No source data stored.");}
    finally{setBusy(null);}
  }
  return (
    <section id="wfm-loyverse-pos" data-wfm-loyverse-pos style={{padding:"0 18px 18px"}}>
      <article className="card" style={{margin:0}}>
        <div className="card-header"><div>
          <div className="card-kicker">Governed source · consented POS pilot</div>
          <h3>Loyverse POS receipt demand</h3>
          <p>Historical sales receipt counts from an independently authorized Philippine
            store, with separate correction and freshness records.</p>
        </div></div>
        <div className="notice notice-amber" style={{margin:"0 18px 16px"}}>
          <span><strong>Aggregate planning source, not fiscal evidence.</strong>
            {" "}Only the exact server-bound store can be queried. A successful provider
            scan does not certify complete or BIR-compliant receipt history.
            Nothing here publishes shifts or affects payroll.</span>
        </div>
        <div className="setting-form" style={{padding:"0 18px 16px"}}>
          <label>Authorized worksite
            <select aria-label="Loyverse demand worksite" value={siteId||""}
              onChange={e=>{setSelected(Number(e.target.value));
                setResult(null);setAck(false);setMessage("");}}>
              {worksites.filter(x=>x.active).map(x=>
                <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
            </select>
          </label>
          <label>Historical Philippine work date
            <input type="date" aria-label="Loyverse historical work date"
              value={date} onChange={e=>{setDate(e.target.value);setResult(null);}}/>
          </label>
          <label>Receipt interval
            <select aria-label="Loyverse interval minutes" value={interval}
              onChange={e=>{setInterval(Number(e.target.value) as 15|30|60);
                setResult(null);setAck(false);}}>
              {[15,30,60].map(n=><option key={n} value={n}>{n} minutes</option>)}
            </select>
          </label>
        </div>
        <div className="id" style={{padding:"0 18px 12px"}}>
          Last local scan: {status?.lastSuccessfulScanAt??"Not recorded"}.
          {" "}Last attempted: {status?.lastAttemptAt??"Not recorded"}.
          {" "}Latest stored aggregate import: {status?.lastStoredImportAt??"Not recorded"}.
          {" "}Source quality: {status?.status??"Unknown"}.
          {" "}Independent merchant reconciliation: <strong>Outstanding</strong>.
        </div>
        {error&&<div role="alert" className="notice notice-amber" style={{margin:"0 18px 16px"}}>
          {error}
        </div>}
        {canManage&&<>
          <label style={{display:"flex",gap:8,padding:"0 18px 14px"}}>
            <input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>
            I am authorized to use the merchant-consented POS source and acknowledge
            that the selected day's scanned source history may receive later corrections.
          </label>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",padding:"0 18px 16px"}}>
            <button type="button" className="secondary-button"
              onClick={()=>void run(true)} disabled={!ack||!date||!!busy||!siteId}>
              {busy==="preview"?"Scanning source…":"Preview without import"}
            </button>
            <button type="button" className="primary-button brand"
              onClick={()=>void run(false)} disabled={!ack||!date||!!busy||!siteId}>
              {busy==="import"?"Importing…":"Import changed counts"}
            </button>
          </div>
        </>}
        <div style={{padding:"0 18px 12px"}}>
          <button type="button" className="secondary-button"
            onClick={()=>setRefresh(i=>i+1)} disabled={!siteId||!!busy}>
            Refresh source status
          </button>
        </div>
        {message&&<div role="status" className="notice notice-slate"
          style={{margin:"0 18px 16px"}}>{message}</div>}
        {result&&<div data-loyverse-scan-result className="notice notice-slate"
          style={{margin:"0 18px 16px"}}>
          <span>{result.applied?"Historical aggregate import":"Read-only preview"}:
            {" "}{result.countedSales} POS sale receipt(s),
            {" "}{result.scannedReceipts} retrieved receipt(s),
            {" "}{result.scannedPages} page(s),
            {" "}{result.changedIntervals} changed bin(s),
            {" "}{result.unchangedIntervals} unchanged.
            Checked at {result.observedAsOf}. Provider finality is not certified.</span>
        </div>}
      </article>
    </section>
  );
}