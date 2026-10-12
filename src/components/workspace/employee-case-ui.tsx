"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type CaseRow = {
  id: number; employeeId: number; employeeName?: string; category: string; subject: string;
  description: string; status: "open"|"in_review"|"waiting_employee"|"resolved";
  priority: "normal"|"high"; assignedToUserId: number | null;
  createdAt: string;
};
type CaseMessage = { id: number; body: string; internal: boolean; createdAt: string; authorUserId: number };
type Detail = { item: CaseRow; messages: CaseMessage[] };
type Mode = "employee"|"hr";
const CATEGORIES = [
  { key: "pay_question", label: "Pay or payslip" },
  { key: "leave", label: "Leave balance or request" },
  { key: "schedule", label: "Time or schedule" },
  { key: "employment_record", label: "Employment record" },
  { key: "workplace", label: "Workplace concern" },
  { key: "other", label: "Other request" },
] as const;

async function sendCase(method: "POST"|"PATCH"|"PUT", body: Record<string, unknown>) {
  const response = await fetch("/api/employee-cases", {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "Request could not be completed.");
  return payload;
}

function CaseWorkspace({ organizationId, mode }: { organizationId: number; mode: Mode }) {
  const [items, setItems] = useState<CaseRow[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [state, setState] = useState<"loading"|"ready"|"error"|"saving">("loading");
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState<"all"|"open"|"in_review"|"waiting_employee"|"resolved">("all");
  const [category, setCategory] = useState("pay_question");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [internal, setInternal] = useState(false);
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState<"normal"|"high">("normal");
  const [nextStatus, setNextStatus] = useState<CaseRow["status"]>("open");

  const load = useCallback(async () => {
    setState("loading"); setError("");
    try {
      const response = await fetch("/api/employee-cases?organizationId=" + organizationId,
        { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not load requests.");
      setItems(data.cases ?? []); setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load requests.");
      setState("error");
    }
  }, [organizationId]);

  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => { if (alive) void load(); });
    return () => { alive = false; };
  }, [load, reload]);

  useEffect(() => {
    if (!chosen) return;
    let alive = true;
    (async () => {
      await Promise.resolve();
      if (!alive) return;
      setDetailLoading(true);
      try {
        const response = await fetch("/api/employee-cases?organizationId=" + organizationId + "&id=" + chosen,
          { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? "Could not open this request.");
        if (alive) {
          setDetail(data as Detail);
          setNextStatus((data as Detail).item.status);
          setAssignee((data as Detail).item.assignedToUserId?.toString() ?? "");
          setPriority((data as Detail).item.priority);
          setError("");
        }
      } catch (cause) {
        if (alive) { setDetail(null); setError(cause instanceof Error ? cause.message : "Cannot open request."); }
      } finally { if (alive) setDetailLoading(false); }
    })();
    return () => { alive = false; };
  }, [organizationId, chosen, reload]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setState("saving"); setError(""); setNotice("");
    try {
      const body = await sendCase("POST", { organizationId, category, subject, description });
      setChosen(body.item.id);
      setSubject(""); setDescription("");
      setNotice("Request submitted. HR can review it; no payroll, leave or schedule record was changed.");
      setReload(n=>n+1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request submission failed.");
    } finally { setState("ready"); }
  }

  async function respond(event: FormEvent) {
    event.preventDefault();
    if (!chosen || !detail || !message.trim()) return;
    setState("saving"); setError("");
    try {
      await sendCase("PUT", { organizationId, id: chosen, message, internal: mode==="hr" && internal });
      setMessage(""); setInternal(false); setNotice("Reply recorded.");
      setReload(n=>n+1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Reply failed."); }
    finally { setState("ready"); }
  }

  async function updateCase() {
    if (!chosen || !detail || mode!=="hr") return;
    setState("saving"); setError("");
    try {
      await sendCase("PATCH", { organizationId, id: chosen, status: nextStatus,
        assignedToUserId: assignee ? Number(assignee) : null, priority });
      setNotice("Request status saved and audited."); setReload(n=>n+1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "HR update failed."); }
    finally { setState("ready"); }
  }
  const filtered = items.filter(item => filter==="all" || item.status===filter);
  return <section aria-label={mode==="hr" ? "HR employee request inbox" : "Employee requests"}
    className="card" style={{ padding: 16, maxWidth: "100%" }}>
    <div className="card-kicker">{mode==="hr" ? "PEOPLE OPERATIONS" : "MY REQUESTS"}</div>
    <h2>{mode==="hr" ? "Employee requests inbox" : "Ask HR"}</h2>
    <p>{mode==="hr"
      ? "Review and respond to authorized employee cases. Private notes are hidden from employees."
      : "Send a question or request to HR. This does not submit a payroll correction or change a leave balance."}</p>
    {mode==="employee" && <form className="setting-form" onSubmit={event=>void create(event)}>
      <label>Request category
        <select value={category} onChange={e=>setCategory(e.target.value)}>
          {CATEGORIES.map(item=><option value={item.key} key={item.key}>{item.label}</option>)}
        </select>
      </label>
      <label>Subject
        <input value={subject} maxLength={160} minLength={4} required
          onChange={e=>setSubject(e.target.value)} placeholder="What can HR help with?"/>
      </label>
      <label style={{ gridColumn:"1/-1" }}>Your request
        <textarea value={description} maxLength={4000} minLength={10} required rows={4}
          onChange={e=>setDescription(e.target.value)}
          placeholder="Explain the issue and relevant dates. Do not include passwords or bank details."/>
      </label>
      <p style={{ gridColumn:"1/-1" }}>Attachments are not supported until the existing document scan and retention controls are integrated.</p>
      <div><button type="submit" className="primary-button"
        disabled={state==="saving" || subject.trim().length<4 || description.trim().length<10}>
        {state==="saving" ? "Submitting…" : "Send request to HR"}</button></div>
    </form>}

    {state==="loading" && <p role="status">Loading requests…</p>}
    {state==="error" && <div role="alert">{error} <button type="button" className="secondary-button"
      onClick={()=>setReload(n=>n+1)}>Retry</button></div>}
    {error && state!=="error" && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div style={{ display:"flex", justifyContent:"space-between", gap:12, flexWrap:"wrap", marginTop:16 }}>
      <h3>{mode==="hr" ? "HR queue" : "My submissions"}</h3>
      <label>Filter status <select value={filter} onChange={e=>setFilter(e.target.value as typeof filter)}>
        <option value="all">All cases</option><option value="open">Open</option>
        <option value="in_review">In review</option><option value="waiting_employee">Waiting on employee</option>
        <option value="resolved">Resolved</option>
      </select></label>
    </div>
    {state==="ready" && items.length===0 && <p className="empty-state">No requests on record.</p>}
    {state==="ready" && items.length>0 && filtered.length===0 && <p role="status">No requests match this status.</p>}
    {filtered.length>0 && <div className="data-table-wrap" style={{ overflowX:"auto", maxWidth:"100%" }}>
      <table className="data-table">
        <thead><tr><th>Case</th>{mode==="hr"&&<th>Employee</th>}<th>Subject</th><th>Status</th><th>Open</th></tr></thead>
        <tbody>{filtered.map(item=><tr key={item.id}>
          <td>#{item.id}</td>{mode==="hr"&&<td>{item.employeeName ?? item.employeeId}</td>}
          <td>{item.subject}</td><td>{item.status.replaceAll("_"," ")}</td>
          <td><button type="button" className="secondary-button"
            onClick={()=>{setChosen(item.id);setDetail(null);setNotice("");}}>Review</button></td>
        </tr>)}</tbody>
      </table>
    </div>}

    {chosen && <section aria-label="Case conversation" className="card"
      style={{ padding:16, marginTop:14, boxShadow:"none", border:"1px solid var(--line)" }}>
      <div style={{ display:"flex", gap:12, justifyContent:"space-between", flexWrap:"wrap" }}>
        <h3>Case #{chosen}</h3><button type="button" className="secondary-button"
          onClick={()=>{setChosen(null);setDetail(null);setError("");}}>Close</button>
      </div>
      {detailLoading && <p role="status">Loading case conversation…</p>}
      {!detailLoading && !detail && <div role="alert">{error || "Case details unavailable."}
        <button type="button" onClick={()=>setReload(n=>n+1)}>Retry</button></div>}
      {detail && !detailLoading && <>
        <strong>{detail.item.subject}</strong>
        <p style={{ whiteSpace:"pre-wrap" }}>{detail.item.description}</p>
        {mode==="hr" && <div className="setting-form">
          <label>Status
            <select value={nextStatus} onChange={e=>setNextStatus(e.target.value as CaseRow["status"])}>
              <option value="open">Open</option><option value="in_review">In review</option>
              <option value="waiting_employee">Waiting for employee</option><option value="resolved">Resolved</option>
            </select>
          </label>
          <label>Priority
            <select value={priority} onChange={e=>setPriority(e.target.value as typeof priority)}>
              <option value="normal">Normal</option><option value="high">High</option>
            </select>
          </label>
          <label>Assigned HR member ID
            <input type="number" min={1} value={assignee} onChange={e=>setAssignee(e.target.value)}
              placeholder="Optional active HR user ID"/>
          </label>
          <div><button type="button" className="primary-button" disabled={state==="saving"}
            onClick={()=>void updateCase()}>Save case status</button></div>
        </div>}
        <h4>Conversation</h4>
        {detail.messages.length===0 && <p>No messages yet.</p>}
        <ol style={{ listStyle:"none", padding:0 }}>
          {detail.messages.map(item=><li key={item.id} style={{ border:"1px solid var(--line)",
            borderRadius:8, padding:10, marginBottom:8 }}>
            <small>{item.internal ? "Internal HR note" : "Message"} · User #{item.authorUserId} ·
              {new Date(item.createdAt).toLocaleString("en-PH")}</small>
            <p style={{ whiteSpace:"pre-wrap" }}>{item.body}</p>
          </li>)}
        </ol>
        {detail.item.status!=="resolved" && <form className="setting-form" onSubmit={event=>void respond(event)}>
          <label>Reply to {mode==="hr"?"employee":"HR"}
            <textarea rows={3} maxLength={2000} minLength={2} value={message}
              onChange={e=>setMessage(e.target.value)} required />
          </label>
          {mode==="hr" && <label><input type="checkbox" checked={internal}
            onChange={e=>setInternal(e.target.checked)} /> Internal note (not visible to employee)</label>}
          <div><button className="primary-button" type="submit"
            disabled={state==="saving" || message.trim().length<2}>Send reply</button></div>
        </form>}
        {detail.item.status==="resolved" && <p role="status">Case resolved; this conversation is read-only.</p>}
      </>}
    </section>}
  </section>;
}

export function EmployeeRequestPanel({ organizationId }: { organizationId: number }) {
  return <CaseWorkspace key={"employee:"+organizationId} organizationId={organizationId} mode="employee"/>;
}
export function EmployeeCaseInbox({ organizationId }: { organizationId: number }) {
  return <CaseWorkspace key={"hr:"+organizationId} organizationId={organizationId} mode="hr"/>;
}
