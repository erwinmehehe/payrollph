"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { hrCaseTransitionAllowed, type HrCaseStatus, type HrCaseType } from "@/lib/hr-case-policy";
import { readVerifiedHrCaseQueue } from "@/lib/hr-case-queue-read";

type StaffMessage = {
  id: number;
  actorUserId: number;
  visibility: "employee" | "internal";
  body: string;
  createdAt: string;
};
type StaffHrCase = {
  id: number;
  organizationId: number;
  employeeId: number;
  employeeName?: string | null;
  employeeTitle?: string | null;
  employeeStartDate?: string | null;
  caseType: HrCaseType;
  assignedRole: string;
  subject: string;
  description: string;
  status: HrCaseStatus;
  sla: { hoursRemaining: number; overdue: boolean };
  coeDocumentId: number | null;
  messages: StaffMessage[];
};
type QueueFilter = "active" | "overdue" | "all";
const STATUSES: HrCaseStatus[] = ["in_progress", "waiting_employee", "resolved", "closed"];

function queueLabel(type: HrCaseType): string {
  if (type === "coe") return "Certificate of Employment";
  if (type === "payslip_correction") return "Payslip correction";
  if (type === "bir_2316") return "BIR Form 2316";
  if (type === "dispute") return "Employee dispute";
  return "General request";
}

export function EmployeeHrCaseStaffQueue(props: { organizationId: number; canApproveCoe: boolean }) {
  return <EmployeeHrCaseStaffQueueContent key={props.organizationId} {...props} />;
}

function EmployeeHrCaseStaffQueueContent({
  organizationId,
  canApproveCoe,
}: {
  organizationId: number;
  canApproveCoe: boolean;
}) {
  const [cases, setCases] = useState<StaffHrCase[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<QueueFilter>("active");
  const [working, setWorking] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [visibilities, setVisibilities] = useState<Record<number, "internal" | "employee">>({});

  const refresh = useCallback(async (signal?: AbortSignal): Promise<boolean> => {
    setLoading(true);
    setError("");
    setCases(null);
    try {
      const verified = await readVerifiedHrCaseQueue(organizationId, fetch, signal);
      if (signal?.aborted) return false;
      setCases(verified);
      return true;
    } catch (cause) {
      if (signal?.aborted) return false;
      setCases(null);
      setError(cause instanceof Error ? cause.message : "Could not verify the HR case inbox.");
      return false;
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    const controller = new AbortController();
    const tick = window.setTimeout(() => { void refresh(controller.signal); }, 0);
    return () => { window.clearTimeout(tick); controller.abort(); };
  }, [refresh]);

  const counts = useMemo(() => ({
    active: (cases ?? []).filter(item => !["resolved", "closed"].includes(item.status)).length,
    overdue: (cases ?? []).filter(item => item.sla.overdue).length,
  }), [cases]);
  const visible = (cases ?? []).filter(item => filter === "all" ||
    (filter === "overdue" ? item.sla.overdue : !["resolved", "closed"].includes(item.status)));

  async function takeAction(id: number, action: string, extra: Record<string, unknown> = {}) {
    if (working !== null || loading || error || cases === null || !cases.some(item => item.id === id)) return false;
    setWorking(id);
    setError("");
    try {
      const response = await fetch("/api/hr-cases", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ id, action, ...extra }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "HR request could not be updated.");
      return await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "HR request could not be updated.");
      return false;
    } finally {
      setWorking(null);
    }
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>, id: number) {
    event.preventDefault();
    const message = (drafts[id] ?? "").trim();
    if (message.length < 2) return;
    const visibility = visibilities[id] ?? "employee";
    const saved = await takeAction(id, visibility === "internal" ? "internal_note" : "reply", { message });
    if (saved) setDrafts(previous => ({ ...previous, [id]: "" }));
  }

  return <section aria-label="Employee HR case inbox">
    {cases !== null && !loading && !error && <div className="mb-5 flex flex-wrap items-center gap-3">
      {([
        ["active", "Active (" + counts.active + ")"],
        ["overdue", "Overdue (" + counts.overdue + ")"],
        ["all", "All (" + cases.length + ")"],
      ] as Array<[QueueFilter, string]>).map(([key, label]) => (
        <button key={key} type="button" onClick={() => setFilter(key)}
          aria-pressed={filter === key}
          className={"rounded-md border px-4 py-2 text-sm font-semibold " +
            (filter === key ? "border-emerald-800 bg-emerald-800 text-white" : "border-slate-200 bg-white text-slate-700")}>
          {label}
        </button>
      ))}
      <button className="ml-auto rounded-md border border-slate-300 px-3 py-2 text-sm" type="button"
        disabled={loading || working !== null} onClick={() => { void refresh(); }}>
        Refresh inbox
      </button>
    </div>}

    {loading && <p className="text-sm text-slate-600" role="status">Loading HR requests…</p>}
    {error && <div role="alert" className="mb-4 rounded border border-red-300 p-3 text-sm text-red-700">
      <p>{error} The inbox and its actions remain unavailable until verified.</p>
      <button type="button" onClick={() => { void refresh(); }} className="mt-2 rounded border px-3 py-2">Retry HR requests</button>
    </div>}
    {!loading && !error && cases !== null && visible.length === 0 &&
      <p className="rounded-lg border border-slate-200 p-6 text-slate-600">No requests match this view.</p>}

    {cases !== null && !loading && !error && <div className="space-y-5">
      {visible.map(item => {
        const canUpdate = item.status !== "closed";
        const nextStatuses = STATUSES.filter(next =>
          hrCaseTransitionAllowed(item.status, next, item.caseType, item.coeDocumentId !== null));
        return <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                {queueLabel(item.caseType)} · #{item.id}
              </p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">{item.subject}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {item.employeeName ?? "Employee #" + item.employeeId} · Assigned: {item.assignedRole}
              </p>
            </div>
            <div className="text-right text-sm">
              <p className="font-semibold">{item.status.replaceAll("_", " ")}</p>
              <p className={item.sla.overdue ? "font-semibold text-red-700" : "text-slate-600"}>
                {item.sla.overdue ? "SLA overdue" : "SLA hours left: " + item.sla.hoursRemaining}
              </p>
            </div>
          </div>
          <p className="my-4 whitespace-pre-wrap text-sm text-slate-800">{item.description}</p>
          {item.caseType === "coe" && <>
            <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm">
              <strong>COE evidence to verify</strong>
              <p>Employee: {item.employeeName || item.employeeId}</p>
              <p>Position: {item.employeeTitle ?? "Not available"}</p>
              <p>Employment start: {item.employeeStartDate ?? "Not available"}</p>
              <p className="mt-1 text-xs text-slate-600">
                Review the employment record before approving. This does not certify salary.
              </p>
            </div>
            {item.coeDocumentId != null &&
              <a href={"/api/documents/" + item.coeDocumentId}
                target="_blank" rel="noopener noreferrer"
                className="font-medium text-emerald-800 underline">View approved certificate</a>}
          </>}
          {item.messages.length > 0 && <div className="mb-4 space-y-2 border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold">Case timeline</h3>
            {item.messages.map(message => <div key={message.id}
              className={"rounded-md p-3 text-sm " + (message.visibility === "internal" ?
                "bg-amber-50" : "bg-slate-50")}>
              <div className="mb-1 text-xs text-slate-500">
                {message.visibility === "internal" ? "Internal only" : "Employee-visible reply"}
                {" · " + new Date(message.createdAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}
              </div>
              <p className="whitespace-pre-wrap">{message.body}</p>
            </div>)}
          </div>}
          {canUpdate && <div className="space-y-3 border-t border-slate-200 pt-4">
            <form onSubmit={event => { void submitMessage(event, item.id); }} className="space-y-2">
              <label className="block text-sm font-medium" htmlFor={"hr-case-text-" + item.id}>
                Write case response
              </label>
              <textarea id={"hr-case-text-" + item.id} value={drafts[item.id] ?? ""}
                onChange={event => setDrafts(previous => ({ ...previous, [item.id]: event.target.value }))}
                minLength={2} maxLength={3000} rows={2} required
                className="block w-full rounded-md border border-slate-300 p-2 text-sm" />
              <div className="flex flex-wrap gap-3">
                <label className="text-sm">Visibility
                  <select value={visibilities[item.id] ?? "employee"}
                    onChange={event => setVisibilities(previous => ({
                      ...previous, [item.id]: event.target.value as "employee" | "internal",
                    }))}
                    className="ml-2 rounded-md border border-slate-300 p-2">
                    <option value="employee">Visible to employee</option>
                    <option value="internal">Internal staff note</option>
                  </select>
                </label>
                <button type="submit" disabled={working !== null || (drafts[item.id]?.trim().length ?? 0) < 2}
                  className="rounded-md bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {working === item.id ? "Saving…" : "Post response"}
                </button>
              </div>
            </form>
            <div className="flex flex-wrap gap-2">
              {nextStatuses.map(next => <button key={next} type="button"
                disabled={working !== null}
                onClick={() => { void takeAction(item.id, "status", { status: next }); }}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                Mark {next.replaceAll("_", " ")}
              </button>)}
              {canApproveCoe && item.caseType === "coe" && item.coeDocumentId == null &&
                <button type="button" disabled={working !== null}
                  onClick={() => {
                    if (window.confirm("Confirm you independently verified the employee records and approve issuance of this Certificate of Employment?")) {
                      void takeAction(item.id, "approve_coe");
                    }
                  }}
                  className="rounded-md bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  Approve and issue COE
                </button>}
            </div>
          </div>}
        </article>;
      })}
    </div>}
  </section>;
}
