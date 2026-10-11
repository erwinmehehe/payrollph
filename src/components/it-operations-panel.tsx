
"use client";
import { useCallback, useEffect, useState } from "react";
import { AssetsPanel } from "@/components/assets-panel";
type Employee = { id: number; firstName: string; lastName: string; status: string };
type Asset = { id: number; name: string; type: string; employeeId: number | null };
type Device = { id: number; assetId: number; employeeId: number | null; state: string; mdmProvider: string | null };
type App = { id: number; name: string };
type Grant = { id: number; employeeId: number; applicationId: number; state: string };
type Task = { id: number; employeeId: number; title: string; kind: string; done: boolean };
type Data = { employees: Employee[]; assets: Asset[]; devices: Device[]; applications: App[]; grants: Grant[]; tasks: Task[] };
export function ItOperationsPanel({ organizationId, setNotice }: { organizationId: number; setNotice: (message: string) => void }) {
  const [data, setData] = useState<Data>({ employees: [], assets: [], devices: [], applications: [], grants: [], tasks: [] });
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [appName, setAppName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [mdmProvider, setMdmProvider] = useState("");
  const [assignTo, setAssignTo] = useState<Record<number, string>>({});
  const reload = useCallback(() => setRefresh(x => x + 1), []);
  useEffect(() => {
    let active = true;
    fetch("/api/it-operations?organizationId=" + organizationId).then(async r => {
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || "IT inventory could not load.");
      return json;
    }).then(json => { if (active) { setData(json); setError(""); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [organizationId, refresh]);
  async function write(method: "POST" | "PATCH", body: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await fetch("/api/it-operations", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId, ...body }) });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || "IT operation failed.");
      setNotice("IT lifecycle record updated.");
      setError("");
      reload();
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "IT operation failed."); return false; }
    finally { setBusy(false); }
  }
  const employee = (id: number | null) => { const e = data.employees.find(v => v.id === id); return e ? e.firstName + " " + e.lastName : "Unassigned"; };
  const app = (id: number) => data.applications.find(a => a.id === id)?.name || String(id);
  const asset = (id: number) => data.assets.find(a => a.id === id)?.name || String(id);
  return <section style={{ display: "grid", gap: 16 }}>
    <header><h2>IT & device operations</h2><p>Track employee access and device custody through onboarding and offboarding. Access changes are operator-confirmed; no remote MDM or identity-provider command is sent.</p></header>
    {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
    <div className="card" style={{ padding: 18 }}>
      <h3>Application directory</h3>
      <form onSubmit={async e => { e.preventDefault(); if (await write("POST", { action: "application", name: appName })) setAppName(""); }} style={{ display: "flex", gap: 8 }}>
        <input required minLength={2} value={appName} onChange={e => setAppName(e.target.value)} placeholder="Microsoft 365, Slack, Jira..." />
        <button disabled={busy} className="primary-button">Add application</button>
      </form>
      <p>{data.applications.map(a => a.name).join(" · ") || "No applications registered."}</p>
      <h3>Request employee app access</h3>
      <form onSubmit={async e => { e.preventDefault(); await write("POST", { action: "grant", employeeId: Number(employeeId), applicationId: Number(applicationId) }); }} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label>Employee <select required value={employeeId} onChange={e => setEmployeeId(e.target.value)}><option value="">Select</option>{data.employees.filter(e => e.status === "Active").map(e => <option key={e.id} value={e.id}>{employee(e.id)}</option>)}</select></label>
        <label>Application <select required value={applicationId} onChange={e => setApplicationId(e.target.value)}><option value="">Select</option>{data.applications.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <button disabled={busy} className="primary-button">Request access</button>
      </form>
      <table className="data-table"><thead><tr><th>Employee</th><th>App</th><th>State</th><th>Manual confirmation</th></tr></thead><tbody>{data.grants.map(g => <tr key={g.id}><td>{employee(g.employeeId)}</td><td>{app(g.applicationId)}</td><td>{g.state.replaceAll("_", " ")}</td><td>{g.state === "grant_requested" && <button disabled={busy} onClick={() => write("PATCH", { action: "access", id: g.id, state: "active" })}>Confirm provisioned</button>}{g.state === "grant_requested" && <button disabled={busy} onClick={() => write("PATCH", { action: "access", id: g.id, state: "revoked" })}>Cancel access request</button>}{g.state === "active" && <button disabled={busy} onClick={() => write("PATCH", { action: "access", id: g.id, state: "revoke_requested" })}>Request revocation</button>}{g.state === "revoke_requested" && <button disabled={busy} onClick={() => write("PATCH", { action: "access", id: g.id, state: "revoked" })}>Confirm revoked</button>}</td></tr>)}</tbody></table>
    </div>
    <div className="card" style={{ padding: 18 }}>
      <h3>Managed device custody</h3>
      <p>Associate the existing equipment inventory with IT custody tracking. MDM provider names are reference metadata only.</p>
      <form onSubmit={async e => { e.preventDefault(); if (await write("POST", { action: "device", assetId: Number(assetId), mdmProvider })) { setAssetId(""); setMdmProvider(""); } }} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label>Existing asset <select required value={assetId} onChange={e => setAssetId(e.target.value)}><option value="">Choose asset</option>{data.assets.filter(a => !data.devices.some(d => d.assetId === a.id)).map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}</select></label>
        <label>MDM name (optional) <input value={mdmProvider} onChange={e => setMdmProvider(e.target.value)} placeholder="e.g. Intune" /></label>
        <button className="primary-button" disabled={busy}>Track device</button>
      </form>
      <table className="data-table"><thead><tr><th>Device</th><th>Custodian</th><th>State</th><th>Actions</th></tr></thead><tbody>{data.devices.map(d => <tr key={d.id}><td>{asset(d.assetId)}</td><td>{employee(d.employeeId)}</td><td>{d.state.replaceAll("_", " ")}</td><td>
        {["available", "returned"].includes(d.state) && <span><select value={assignTo[d.id] ?? ""} onChange={e => setAssignTo(v => ({ ...v, [d.id]: e.target.value }))}><option value="">Select employee</option>{data.employees.filter(e => e.status === "Active").map(e => <option key={e.id} value={e.id}>{employee(e.id)}</option>)}</select>{d.state === "available" && <button disabled={busy || !assignTo[d.id]} onClick={() => write("PATCH", { action: "device", id: d.id, state: "assigned", employeeId: Number(assignTo[d.id]) })}>Assign</button>}{d.state === "returned" && <button disabled={busy} onClick={() => write("PATCH", { action: "device", id: d.id, state: "available" })}>Available</button>}</span>}
        {d.state === "assigned" && <button disabled={busy} onClick={() => write("PATCH", { action: "device", id: d.id, state: "return_requested" })}>Request return</button>}
        {d.state === "return_requested" && <button disabled={busy} onClick={() => write("PATCH", { action: "device", id: d.id, state: "returned" })}>Confirm return</button>}
      </td></tr>)}</tbody></table>
    </div>
    <div className="card" style={{ padding: 18 }}><h3>IT onboarding & offboarding tasks</h3>
      <p>Provisioning checklists remain managed by the existing HR workflow. Tasks below are read-only here.</p>
      <table className="data-table"><thead><tr><th>Employee</th><th>Lifecycle</th><th>Task</th><th>State</th></tr></thead><tbody>{data.tasks.map(t => <tr key={t.id}><td>{employee(t.employeeId)}</td><td>{t.kind}</td><td>{t.title}</td><td>{t.done ? "Complete" : "Pending"}</td></tr>)}</tbody></table>
    </div>
    <button className="secondary-button" onClick={reload}>Refresh equipment inventory</button>
    <AssetsPanel organizationId={organizationId} managedAssetIds={data.devices.map(d => d.assetId)} />
  </section>;
}
