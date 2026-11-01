"use client";

import { useEffect, useRef, useState } from "react";
import { isVerifiedHcmWorkQueueResponse, summarizeVerifiedWorkQueue, type HcmWorkQueueItem, type HcmWorkQueueOwner } from "@/lib/hcm-work-queue-summary";

type Item = HcmWorkQueueItem;
type Owner = HcmWorkQueueOwner;
type History = { id:number; eventType:string; actorName:string|null; createdAt:string };
const teams = ["HR Operations","Payroll","Timekeeping","Compliance","Employee Relations","Benefits","People Operations"];
function localInput(date:string|null) { if (!date) return ""; const d = new Date(date); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); }
function iso(value:string) { return value ? new Date(value).toISOString() : null; }

export default function HcmWorkQueue() {
  const [organizationId,setOrganizationId] = useState(() => typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("organizationId") ?? "" : "");
  const [filter,setFilter] = useState("open");
  return <main className="mx-auto max-w-7xl px-5 py-10 text-slate-900">
    <header className="mb-8"><p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">People operations</p>
      <h1 className="mt-2 text-3xl font-bold">HR Work Queue</h1>
      <p className="mt-2 text-slate-600">Assign accountable owners, track deadlines and review escalations. Case resolution remains in the original workflow.</p>
    </header>
    <section className="mb-6 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm font-semibold">Organization ID<input aria-label="Organization ID" className="rounded-lg border px-3 py-2" type="number" min="1" value={organizationId} onChange={e=>setOrganizationId(e.target.value)}/></label>
      <label className="flex flex-col gap-1 text-sm font-semibold">Queue<select className="rounded-lg border px-3 py-2" value={filter} onChange={e=>setFilter(e.target.value)}>
        <option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="overdue">Overdue</option><option value="resolved">Resolved</option>
      </select></label>
    </section>
    <ScopedWorkQueue key={JSON.stringify([organizationId, filter])} organizationId={organizationId} filter={filter}/>
  </main>;
}

// Scope changes replace the mounted view, including its editor and pending
// mutations. An old save cannot refresh or overwrite the newly selected queue.
function ScopedWorkQueue({organizationId, filter}: {organizationId:string; filter:string}) {
  const [revision,setRevision] = useState(0);
  const [queue,setQueue] = useState<{revision:number; items:Item[]; owners:Owner[]; error:string}|null>(null);
  const [selected,setSelected] = useState<Item|null>(null);
  const [team,setTeam] = useState("");
  const [ownerId,setOwnerId] = useState("");
  const [due,setDue] = useState("");
  const [escalate,setEscalate] = useState("");
  const [error,setError] = useState("");
  const [saving,setSaving] = useState(false);
  const editorGeneration = useRef(0);
  const [historyRead,setHistoryRead] = useState<{caseId:number; events:History[]; error:string}|null>(null);
  const validOrganization = Number.isSafeInteger(Number(organizationId)) && Number(organizationId) > 0;
  const activeQueue = queue?.revision === revision ? queue : null;
  const loading = validOrganization && activeQueue === null;
  const items = activeQueue?.items ?? [];
  const owners = activeQueue?.owners ?? [];
  const loadError = activeQueue?.error ?? "";
  const activeHistory = historyRead?.caseId === selected?.id ? historyRead : null;
  const history = activeHistory?.events ?? [];

  function refresh() { setRevision(value=>value+1); }

  useEffect(() => {
    if (!validOrganization) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response=await fetch(`/api/hcm/work-items?organizationId=${encodeURIComponent(organizationId)}&status=${filter}`,{cache:"no-store",signal:controller.signal});
        const data=await response.json();
        if(!response.ok) throw new Error(data.error ?? "Unable to load work items");
        if(!isVerifiedHcmWorkQueueResponse(data, Number(organizationId))) throw new Error("Invalid or mixed-employer work queue response.");
        if (!controller.signal.aborted) setQueue({revision,items:data.items,owners:data.owners,error:""});
      } catch(e) {
        if (!controller.signal.aborted) setQueue({revision,items:[],owners:[],error:e instanceof Error?e.message:"Unable to load"});
      }
    })();
    return () => controller.abort();
  },[organizationId,filter,revision,validOrganization]);

  const selectedId = selected?.id;
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response=await fetch(`/api/hcm/work-items/events?organizationId=${encodeURIComponent(organizationId)}&caseId=${selectedId}`,{cache:"no-store",signal:controller.signal});
        const data=await response.json();
        if(!response.ok) throw new Error(data.error??"Cannot load history");
        if(!Array.isArray(data.events)) throw new Error("Invalid work item history response.");
        if(!controller.signal.aborted) setHistoryRead({caseId:selectedId,events:data.events,error:""});
      } catch(e) {
        if(!controller.signal.aborted) setHistoryRead({caseId:selectedId,events:[],error:e instanceof Error?e.message:"Cannot load history"});
      }
    })();
    return () => controller.abort();
  },[organizationId,selectedId]);

  function edit(item:Item) {
    editorGeneration.current += 1;
    setSaving(false);
    setSelected(item); setTeam(teams.includes(item.ownerTeam) ? item.ownerTeam : teams[0]); setOwnerId(item.ownerUserId?.toString() ?? "");
    setDue(localInput(item.dueAt)); setEscalate(localInput(item.escalateAt)); setError("");
    setHistoryRead(null);
  }
  async function save() {
    if (!selected) return;
    const generation = editorGeneration.current;
    setSaving(true); setError("");
    try {
      if (escalate && (!due || new Date(escalate).getTime() < new Date(due).getTime())) throw new Error("Escalation must be at or after the SLA deadline.");
      const response=await fetch("/api/hcm/work-items",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        organizationId:Number(organizationId),id:selected.id,ownerTeam:team,ownerUserId:ownerId?Number(ownerId):null,dueAt:iso(due),escalateAt:iso(escalate)
      })});
      const data=await response.json();
      if (generation !== editorGeneration.current) return;
      if(!response.ok) throw new Error(data.error??"Unable to save");
      setSelected(null); refresh();
    } catch(e) {if(generation === editorGeneration.current) setError(e instanceof Error?e.message:"Unable to save");}
    finally {if(generation === editorGeneration.current) setSaving(false);}
  }
  // A pending, denied or failed read is unknown, never an empty queue.
  const summary = summarizeVerifiedWorkQueue(items, activeQueue !== null && !loadError);
  return <>
    <button className="mb-4 rounded-lg bg-emerald-800 px-4 py-2 font-medium text-white" onClick={refresh} disabled={loading||!validOrganization}>{loading?"Loading...":"Refresh"}</button>
    {!validOrganization && <p role="status" className="mb-4 text-slate-600">Choose a valid organization to load its queue.</p>}
    {loading && <p role="status" className="mb-4 text-slate-600">Loading work items…</p>}
    {(error||loadError) && <p role="alert" className="mb-4 rounded-lg border border-rose-300 bg-rose-50 p-3 text-rose-800">{error||loadError}</p>}
    <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Queue summary" aria-busy={loading}>
      {[[summary?.total ?? null,"Items in current view"],[summary?.overdue ?? null,"Overdue"],[summary?.unassigned ?? null,"Without named owner"]].map(([value,label])=><div key={label} className="rounded-xl border bg-white p-4"><p className="text-2xl font-bold">{value === null ? "—" : value}</p><p className="text-sm text-slate-600">{label}</p></div>)}
    </section>
    {!summary && <p role="status" className="mb-4 text-sm text-slate-600">Queue counts are unavailable until the selected employer’s work items load successfully.</p>}
    {summary ? (
      <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[850px] text-left text-sm">
        <thead className="bg-slate-100"><tr>{["Work item","Accountable team","Named owner","SLA due","Status","Action"].map(s=><th key={s} className="p-3">{s}</th>)}</tr></thead>
        <tbody>{items.map(i=><tr key={i.id} className="border-t">
          <td className="p-3"><strong>{i.title}</strong><p className="text-slate-500">#{i.id} · {i.caseType}</p></td>
          <td className="p-3">{i.ownerTeam}</td><td className="p-3">{i.ownerName??"Unassigned"}</td>
          <td className="p-3">{i.dueAt?new Date(i.dueAt).toLocaleString("en-PH",{timeZone:"Asia/Manila"}):"Not set"}{i.overdue&&<span className="ml-2 font-semibold text-rose-700">Overdue</span>}{i.escalationLevel>0&&<span className="ml-2 font-semibold text-amber-700">Escalated</span>}</td>
          <td className="p-3 capitalize">{i.status}</td><td className="p-3"><button className="font-semibold text-emerald-800 underline disabled:opacity-50" disabled={i.status==="resolved"} onClick={()=>edit(i)}>Assign / SLA</button></td>
        </tr>)}</tbody>
      </table>{items.length===0&&<p className="p-8 text-center text-slate-500">No work items found for this filter.</p>}</div>
    ) : (
      <div role="status" className="rounded-xl border bg-white p-8 text-center text-slate-600">
        {loading ? "Work items are loading…" : loadError ? "Work items could not be loaded. Use Refresh to retry." : "Select a valid organization to see work items."}
      </div>
    )}
    {selected&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><section role="dialog" aria-modal="true" aria-labelledby="work-item-edit-title" className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
      <h2 id="work-item-edit-title" className="text-xl font-bold">Assign #{selected.id}</h2><p className="mb-4 text-slate-600">{selected.title}</p>
      {error&&<p role="alert" className="mb-3 rounded border border-rose-300 p-2 text-rose-700">{error}</p>}
      <div className="grid gap-3">
        <label className="grid gap-1 text-sm font-semibold">HR team<select className="rounded border p-2" value={team} onChange={e=>setTeam(e.target.value)}>{teams.map(t=><option key={t}>{t}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-semibold">Accountable owner<select className="rounded border p-2" value={ownerId} onChange={e=>setOwnerId(e.target.value)}><option value="">Unassigned</option>{owners.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-semibold">SLA deadline (local time)<input className="rounded border p-2" type="datetime-local" value={due} onChange={e=>setDue(e.target.value)}/></label>
        <label className="grid gap-1 text-sm font-semibold">Escalate after (local time)<input className="rounded border p-2" type="datetime-local" value={escalate} onChange={e=>setEscalate(e.target.value)}/></label>
      </div>
      <div className="mt-4 max-h-40 overflow-y-auto border-t pt-3"><h3 className="text-sm font-bold">Ownership and SLA history</h3>
        {!activeHistory?<p role="status" className="mt-2 text-xs text-slate-500">Loading history…</p>:activeHistory.error?<p role="alert" className="mt-2 text-xs text-rose-700">{activeHistory.error}</p>:history.length===0?<p className="mt-2 text-xs text-slate-500">No history recorded.</p>:<ul className="mt-2 space-y-2 text-xs">{history.map(event=><li key={event.id} className="flex justify-between gap-2"><span>{event.eventType.replaceAll("_"," ")} · {event.actorName??"Scheduler"}</span><time>{new Date(event.createdAt).toLocaleString("en-PH",{timeZone:"Asia/Manila"})}</time></li>)}</ul>}
      </div><div className="mt-5 flex justify-end gap-2"><button className="rounded border px-4 py-2" onClick={()=>{editorGeneration.current+=1;setSelected(null);setError("");setSaving(false);}}>Cancel</button><button disabled={saving} className="rounded bg-emerald-800 px-4 py-2 text-white disabled:opacity-50" onClick={()=>void save()}>{saving?"Saving...":"Save changes"}</button></div>
    </section></div>}
  </>;
}
