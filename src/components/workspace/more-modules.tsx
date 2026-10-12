"use client";
import { useState } from "react";
import { CORE_ONLY_PAGES, NAVIGATION } from "./nav";
import type { Organization } from "./types";
export function MoreModulesPanel({ organization, allowedPages, onSaved }: {
 organization: Organization; allowedPages: readonly string[]; onSaved: () => Promise<void>;
}) {
 const options = NAVIGATION.flatMap(g => g.items).filter(item =>
  ![...CORE_ONLY_PAGES, "More modules"].includes(item.name) && allowedPages.includes(item.name));
 const [enabled, setEnabled] = useState<string[]>(organization.enabledModules ?? []);
 const [busy, setBusy] = useState(false); const [error, setError] = useState("");
 async function save(mode: "all" | "core_only") {
  setBusy(true); setError("");
  try {
   const response = await fetch("/api/workspace/modules", { method:"PATCH", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ organizationId:organization.id, mode, modules:enabled }) });
   const result = await response.json().catch(() => ({}));
   if (!response.ok) throw Error(result.error ?? "Could not save modules");
   await onSaved();
  } catch (e) { setError(e instanceof Error ? e.message : "Could not save modules"); }
  finally { setBusy(false); }
 }
 return <section className="card" aria-label="More modules">
  <div className="card-header"><div><h2>More modules</h2><p>Turn on additional tools. Your role and plan still determine what you can access.</p></div></div>
  {error && <p role="alert">{error}</p>}
  <div className="grid gap-3 p-4 sm:grid-cols-2">{options.map(item => <label key={item.name} className="flex gap-3 rounded-xl border p-3">
   <input type="checkbox" checked={enabled.includes(item.name)} onChange={e => setEnabled(prev => e.target.checked ? [...prev,item.name] : prev.filter(name=>name!==item.name))}/>
   <span><strong>{item.name}</strong><small className="block">{item.hint}</small></span>
  </label>)}</div>
  <div className="flex gap-3 p-4"><button type="button" className="primary-button" disabled={busy} onClick={()=>void save("core_only")}>Save modules</button>
   <button type="button" className="secondary-button" disabled={busy} onClick={()=>void save("all")}>Show all</button></div>
 </section>;
}
