"use client";

import { useEffect, useState } from "react";

type Site={id:number;code:string;name:string;active:boolean};
type Freshness={
  readOnly:true;
  scope:{organizationId:number;worksiteId:number;sourceKey:string;intervalMinutes:number};
  lastStoredImportAt:string|null;lastStoredRevisionRows:number|null;
  lastCheckedAt:string|null;lastCheckedWorkDate:string|null;
  freshness:"source_reported_scan_only";boundary:string;
};
type Scan={
  applied:boolean;source:string;workDate:string;intervalMinutes:number;
  completedPayments:number;scannedPages:number;changedIntervals:number;
  unchangedIntervals:number;observedAsOf:string;boundary:string;
};
const url="/api/workforce/demand-observations/square-sandbox";

/** Environment/tenant-gated manual sandbox adapter. Never accepts provider tokens in UI. */
export function WorkforceSquareSandboxPanel({organizationId,worksites}:{
  organizationId:number;worksites:Site[];
}){
  const [requestedSite,setRequestedSite]=useState<number|null>(null);
  const [interval,setInterval]=useState<15|30|60>(30);
  const [workDate,setWorkDate]=useState("");
  const [acknowledged,setAcknowledged]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const [freshness,setFreshness]=useState<{key:string,value:Freshness}|null>(null);
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState<"preview"|"import"|null>(null);
  const [lastScan,setLastScan]=useState<Scan|null>(null);
  const [message,setMessage]=useState("");
  const site=worksites.find(w=>w.active&&w.id===requestedSite) ??
    worksites.find(w=>w.active)??null;
  const worksiteId=site?.id??0;
  const key=[organizationId,worksiteId,interval,refresh].join(":");

  useEffect(()=>{
    if(!worksiteId)return;
    const controller=new AbortController();
    async function load(){
      setLoading(true);
      try{
        const query=new URLSearchParams({
          organizationId:String(organizationId),
          worksiteId:String(worksiteId),
          intervalMinutes:String(interval),
        });
        const response=await fetch(url+"?"+query,{cache:"no-store",signal:controller.signal});
        const value=await response.json().catch(()=>({})) as Partial<Freshness>&{error?:string};
        if(!response.ok||value.readOnly!==true||
           value.scope?.organizationId!==organizationId||
           value.scope?.worksiteId!==worksiteId||
           value.scope?.intervalMinutes!==interval){
          throw new Error(value.error??"Square sandbox source unavailable for this worksite.");
        }
        if(!controller.signal.aborted){
          setFreshness({key,value:value as Freshness});setMessage("");
        }
      }catch(e){
        if(!controller.signal.aborted){
          setFreshness(null);
          setMessage(e instanceof Error?e.message:"Sandbox freshness status unavailable.");
        }
      }finally{
        if(!controller.signal.aborted)setLoading(false);
      }
    }
    void load();
    return()=>controller.abort();
  },[organizationId,worksiteId,interval,key]);

  async function scan(dryRun:boolean){
    if(!worksiteId||!acknowledged||busy||!workDate)return;
    setBusy(dryRun?"preview":"import");setLastScan(null);setMessage("");
    try{
      const response=await fetch(url,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          organizationId,worksiteId,workDate,
          intervalMinutes:interval,dryRun,acknowledged:true,
        }),
      });
      const result=await response.json().catch(()=>({})) as Partial<Scan>&{error?:string};
      if(!response.ok||result.source!=="square_sandbox_payments"||
        result.workDate!==workDate||result.intervalMinutes!==interval||
        result.applied===undefined)throw new Error(result.error??"Sandbox sync declined.");
      setLastScan(result as Scan);
      setMessage(dryRun?
        "Read-only source preview completed; no aggregate versions were saved.":
        "Aggregate correction scan completed. Only changed interval revisions were saved.");
      if(!dryRun){setAcknowledged(false);setRefresh(v=>v+1);}
    }catch(e){
      setMessage(e instanceof Error?e.message:"No source data imported.");
    }finally{setBusy(null);}
  }
  const status=freshness?.key===key?freshness.value:null;
  return (
    <section data-wfm-square-sandbox id="wfm-square-sandbox"
      style={{padding:"0 18px 18px"}}>
      <article className="card" style={{margin:0}}>
        <div className="card-header"><div>
          <div className="card-kicker">Demand source · sandbox-only pilot</div>
          <h3>Square completed-payment activity</h3>
          <p>Count payments per Philippine-local interval from an explicitly bound Square
            sandbox location. Never ingest payment/customer details or publish schedules.</p>
        </div></div>
        <div className="notice notice-amber" role="status" style={{margin:"0 18px 16px"}}>
          <span><strong>Not a live POS connector.</strong> Sandbox payments are not necessarily
          individual in-store orders, visits or labor demand. Only historical days whose
          end is at least seven days old are eligible, and source-reported completeness
          can change if late offline payments or corrections arrive.</span>
        </div>
        <div className="setting-form" style={{padding:"0 18px 16px"}}>
          <label>Authorized worksite
            <select aria-label="Square sandbox worksite" value={worksiteId||""}
              onChange={e=>{setRequestedSite(Number(e.target.value));
                setLastScan(null);setAcknowledged(false);}}>
              {worksites.filter(w=>w.active).map(w=>
                <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
            </select>
          </label>
          <label>Historical Philippine work date
            <input aria-label="Square sandbox historical date" type="date"
              value={workDate}
              onChange={e=>{setWorkDate(e.target.value);setLastScan(null);}}/>
          </label>
          <label>Aggregate interval
            <select aria-label="Square sandbox interval" value={interval}
              onChange={e=>{setInterval(Number(e.target.value) as 15|30|60);
                setLastScan(null);setAcknowledged(false);}}>
              {[15,30,60].map(v=><option key={v} value={v}>{v} minutes</option>)}
            </select>
          </label>
        </div>
        <p className="id" style={{padding:"0 18px 12px"}}>
          Last stored aggregate import: {status?.lastStoredImportAt??"Not recorded"}.
          {" "}Last server-checked sandbox source: {status?.lastCheckedAt??"Not recorded"}.
          {" "}Checked historical work date: {status?.lastCheckedWorkDate??"Unknown"}.
          {" "}Provider-certified freshness: <strong>Not established</strong>.
          {loading?" Refreshing source evidence…":""}
        </p>
        <label style={{display:"flex",alignItems:"start",gap:8,margin:"0 18px 16px"}}>
          <input type="checkbox" checked={acknowledged}
            onChange={e=>setAcknowledged(e.target.checked)}/>
          I am authorized to use this fictional sandbox location and understand a
          completed source scan is not independent proof of complete POS demand.
        </label>
        <div style={{padding:"0 18px 18px",display:"flex",gap:8,flexWrap:"wrap"}}>
          <button type="button" className="secondary-button"
            disabled={!worksiteId||!workDate||!acknowledged||!!busy}
            onClick={()=>void scan(true)}>
            {busy==="preview"?"Reading sandbox…":"Preview aggregates"}
          </button>
          <button type="button" className="primary-button brand"
            disabled={!worksiteId||!workDate||!acknowledged||!!busy}
            onClick={()=>void scan(false)}>
            {busy==="import"?"Syncing revisions…":"Import changed counts"}
          </button>
          <button type="button" className="secondary-button"
            onClick={()=>setRefresh(v=>v+1)} disabled={!worksiteId||loading||!!busy}>
            Refresh source freshness
          </button>
        </div>
        {message&&<div className="notice notice-slate" role="status"
          style={{margin:"0 18px 16px"}}>{message}</div>}
        {lastScan&&<div className="notice notice-slate" data-square-sync-result
          style={{margin:"0 18px 16px"}}>
          <span><strong>{lastScan.applied?"Aggregate revision import":"Read-only preview"}</strong>:
            {" "}{lastScan.completedPayments} completed sandbox payment(s),
            {" "}{lastScan.changedIntervals} changed interval(s),
            {" "}{lastScan.unchangedIntervals} unchanged;
            {" "}source pages: {lastScan.scannedPages}.
            {" "}Observed as of {lastScan.observedAsOf}.
            This is point-in-time source evidence, not final merchant reconciliation.
          </span>
        </div>}
      </article>
    </section>
  );
}
