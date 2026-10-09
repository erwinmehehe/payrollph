"use client";

import { useCallback, useEffect, useState } from "react";

type Item = { id:number; title:string; detail:string; caseType:string; status:string; ownerTeam:string; ownerUserId:number|null; ownerName:string|null; dueAt:string|null; escalateAt:string|null; escalationLevel:number; overdue:boolean };
type Owner = { id:number; name:string };
const teams = ["HR Operations","Payroll","Timekeeping","Compliance","Employee Relations","Benefits","People Operations"];
function localInput(date:string|null) { if (!date) return ""; const d = new Date(date); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); }
function iso(value:string) { return value ? new Date(value).toISOString() : null; }

export default function HcmWorkQueue() {
  const [organizationId,setOrganizationId] = useState("");
  const [filter,setFilter] = useState("open");
  const [items,setItems] = useState<Item[]>([]);
  const [owners,setOwners] = useState<Owner[]>([]);
  const [selected,setSelected] = useState<Item|null>(null);
  const [team,setTeam] = useState("");
  const [ownerId,setOwnerId] = useState("");
  const [due,setDue] = useState("");
  const [escalate,setEscalate] = useState("");
  const [error,setError] = useState("");
  const [saving,setSaving] = useState(false);
  const [loading,setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!Number.isSafeInteger(Number(organizationId)) || Number(organizationId) < 1) return;
    setLoading(true); setError("");
    try {
      const response=await fetch(`/api/hcm/work-items?organizationId=${encodeURIComponent(organizationId)}&status=${filter}`,{cache:"no-store"});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error ?? "Unable to load work items");
      setItems(data.items); setOwners(data.owners);
    } catch(e) { setError(e instanceof Error?e.message:"Unable to load"); }
    finally {setLoading(false);}
  },[organizationId,filter]);

  useEffect(() => { void refresh(); },[refresh]);

  function edit(item:Item) {
    setSelected(item); setTeam(item.ownerTeam); setOwnerId(item.ownerUserId?.toString() ?? "");
    setDue(localInput(item.dueAt)); setEscalate(localInput(item.escalateAt)); setError("");
  }
  async function save() {
    if (!selected) return;
    setSaving(true); setError("");
    try {
      const response=await fetch("/api/hcm/work-items",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        organizationId:Number(organizationId),id:selected.id,ownerTeam:team,ownerUserId:ownerId?Number(ownerId):null,dueAt:iso(due),escalateAt:iso(escalate)
      })});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error??"Unable to save");
      setSelected(null); await refresh();
    } catch(e) {setError(e instanceof Error?e.message:"Unable to save");}
    finally {setSaving(false);}
  }
  const overdue = items.filter(i=>i.overdue).length;
  const unassigned = items.filter(i=>!i.ownerUserId).length;
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
      <button className="rounded-lg bg-emerald-800 px-4 py-2 font-medium text-white" onClick={()=>void refresh()} disabled={loading}>{loading?"Loading...":"Refresh"}</button>
    </section>
    {error && <p role="alert" className="mb-4 rounded-lg border border-rose-300 bg-rose-50 p-3 text-rose-800">{error}</p>}
    <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Queue summary">
      {[[items.length,"Items in current view"],[overdue,"Overdue"],[unassigned,"Without named owner"]].map(([value,label])=><div key={label} className="rounded-xl border bg-white p-4"><p className="text-2xl font-bold">{value}</p><p className="text-sm text-slate-600">{label}</p></div>)}
    </section>
    <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[850px] text-left text-sm">
      <thead className="bg-slate-100"><tr>{["Work item","Accountable team","Named owner","SLA due","Status","Action"].map(s=><th key={s} className="p-3">{s}</th>)}</tr></thead>
      <tbody>{items.map(i=><tr key={i.id} className="border-t">
        <td className="p-3"><strong>{i.title}</strong><p className="text-slate-500">#{i.id} · {i.caseType}</p></td>
        <td className="p-3">{i.ownerTeam}</td><td className="p-3">{i.ownerName??"Unassigned"}</td>
        <td className="p-3">{i.dueAt?new Date(i.dueAt).toLocaleString("en-PH",{timeZone:"Asia/Manila"}):"Not set"}{i.overdue&&<span className="ml-2 font-semibold text-rose-700">Overdue</span>}{i.escalationLevel>0&&<span className="ml-2 font-semibold text-amber-700">Escalated</span>}</td>
        <td className="p-3 capitalize">{i.status}</td><td className="p-3"><button className="font-semibold text-emerald-800 underline disabled:opacity-50" disabled={i.status==="resolved"} onClick={()=>edit(i)}>Assign / SLA</button></td>
      </tr>)}</tbody>
    </table>{items.length===0&&<p className="p-8 text-center text-slate-500">No work items found for this filter.</p>}</div>
    {selected&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><section role="dialog" aria-modal="true" aria-labelledby="work-item-edit-title" className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
      <h2 id="work-item-edit-title" className="text-xl font-bold">Assign #{selected.id}</h2><p className="mb-4 text-slate-600">{selected.title}</p>
      <div className="grid gap-3">
        <label className="grid gap-1 text-sm font-semibold">HR team<select className="rounded border p-2" value={team} onChange={e=>setTeam(e.target.value)}>{teams.map(t=><option key={t}>{t}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-semibold">Accountable owner<select className="rounded border p-2" value={ownerId} onChange={e=>setOwnerId(e.target.value)}><option value="">Unassigned</option>{owners.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-semibold">SLA deadline (local time)<input className="rounded border p-2" type="datetime-local" value={due} onChange={e=>setDue(e.target.value)}/></label>
        <label className="grid gap-1 text-sm font-semibold">Escalate after (local time)<input className="rounded border p-2" type="datetime-local" value={escalate} onChange={e=>setEscalate(e.target.value)}/></label>
      </div><div className="mt-5 flex justify-end gap-2"><button className="rounded border px-4 py-2" onClick={()=>{setSelected(null);setError("");}}>Cancel</button><button disabled={saving} className="rounded bg-emerald-800 px-4 py-2 text-white disabled:opacity-50" onClick={()=>void save()}>{saving?"Saving...":"Save changes"}</button></div>
    </section></div>}
  </main>;
}
