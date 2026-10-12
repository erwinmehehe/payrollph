"use client";
import { useState } from "react";
import { TENANT_MODULES } from "@/lib/tenant-modules";
import type { Notify } from "./types";
export function MoreModules({ organizationId, enabledModules, onRefresh, notify }: { organizationId: number; enabledModules: readonly string[]; onRefresh: () => Promise<void>; notify: Notify }) {
  const [busy, setBusy] = useState(false);
  async function toggle(moduleId: string, enabled: boolean) {
    setBusy(true);
    try {
      const response = await fetch("/api/tenant-modules", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId, moduleId, enabled }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not update modules.");
      await onRefresh();
      notify("Module visibility updated for this employer.", "ok");
    } catch (e) { notify(e instanceof Error ? e.message : "Module update failed.", "err"); }
    finally { setBusy(false); }
  }
  return <section aria-label="More modules"><h1>More modules</h1><p>Enable tools when your team needs them. Existing role permissions, plan limits and approval rules still apply. Disabling visibility keeps recorded data.</p><div className="grid gap-4 md:grid-cols-2">{TENANT_MODULES.map(module => <article className="card p-4" key={module.id}><h2>{module.title}</h2><p>{module.detail}</p><label><input type="checkbox" checked={enabledModules.includes(module.id)} disabled={busy} onChange={e => void toggle(module.id, e.target.checked)} /> Enable {module.title}</label></article>)}</div></section>;
}
