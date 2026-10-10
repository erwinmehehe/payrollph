"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ClipboardCheck, Clock3, RefreshCw } from "lucide-react";
import {
  HCM_BP_MONITOR_STATUSES, type HcmBpMonitorFilter,
} from "@/lib/hcm-business-process-monitor-projection";
import type {
  BpMonitorDetailResponse, BpMonitorListResponse,
} from "@/lib/hcm-business-process-monitor-contract";

type FetchState<T> = {
  scope: string;
  phase: "loading" | "ready" | "unavailable";
  data: T | null;
};

function label(value: string) {
  return value.replace(/[_:-]+/g, " ").replace(/^./, (first) => first.toUpperCase());
}
function phTime(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short",
  }).format(date);
}
function phBusinessDate(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value + "T12:00:00+08:00");
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", dateStyle: "medium",
  }).format(date);
}

export function HcmBusinessProcessMonitor({ organizationId }: { organizationId: number }) {
  const [filter, setFilter] = useState<HcmBpMonitorFilter>("all");
  const [cursor, setCursor] = useState<string | null>(null);
  const [backstack, setBackstack] = useState<(string | null)[]>([]);
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [list, setList] = useState<FetchState<BpMonitorListResponse> | null>(null);
  const [detail, setDetail] = useState<FetchState<BpMonitorDetailResponse> | null>(null);
  const listScope = [organizationId, filter, cursor ?? "initial", revision].join(":");

  useEffect(() => {
    const controller = new AbortController();
    setList({ scope: listScope, phase: "loading", data: null });
    setSelectedId(null);
    setDetail(null);
    const query = new URLSearchParams({
      organizationId: String(organizationId), status: filter,
    });
    if (cursor) query.set("cursor", cursor);
    void fetch("/api/hcm/business-process-monitor?" + query.toString(), {
      signal: controller.signal, cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) throw new Error("Workflow source unavailable");
      const data = await response.json() as BpMonitorListResponse;
      if (controller.signal.aborted) return;
      if (data.tenantId !== organizationId || data.statusFilter !== filter ||
          !Array.isArray(data.items)) throw new Error("Wrong organization response");
      setList({ scope: listScope, phase: "ready", data });
      setSelectedId(data.items[0]?.id ?? null);
    }).catch(() => {
      if (!controller.signal.aborted) setList({ scope: listScope, phase: "unavailable", data: null });
    });
    return () => controller.abort();
  }, [organizationId, filter, cursor, revision, listScope]);

  const current = list?.scope === listScope && list.phase === "ready" ? list.data : null;
  const phase = list?.scope === listScope ? list.phase : "loading";
  const selected = current?.items.find((item) => item.id === selectedId) ?? null;
  const detailScope = listScope + ":" + (selected?.id ?? "none");

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setDetail({ scope: detailScope, phase: "loading", data: null });
    const url = "/api/hcm/business-process-monitor/" + selected.id +
      "?organizationId=" + organizationId;
    void fetch(url, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Workflow step source unavailable");
      const data = await response.json() as BpMonitorDetailResponse;
      if (controller.signal.aborted) return;
      if (data.tenantId !== organizationId || data.instance.id !== selected.id ||
          !Array.isArray(data.steps)) throw new Error("Wrong workflow response");
      setDetail({ scope: detailScope, phase: "ready", data });
    }).catch(() => {
      if (!controller.signal.aborted) setDetail({
        scope: detailScope, phase: "unavailable", data: null,
      });
    });
    return () => controller.abort();
  }, [organizationId, selected, detailScope]);

  const matchingDetail = detail?.scope === detailScope ? detail : null;
  const details = selected && matchingDetail?.phase === "ready" ? matchingDetail.data : null;

  function changeFilter(value: HcmBpMonitorFilter) {
    setFilter(value);
    setCursor(null);
    setBackstack([]);
    setSelectedId(null);
  }
  function nextPage() {
    if (!current?.nextCursor) return;
    setBackstack((history) => [...history, cursor]);
    setCursor(current.nextCursor);
  }
  function previousPage() {
    if (!backstack.length) return;
    setCursor(backstack[backstack.length - 1]);
    setBackstack((history) => history.slice(0, -1));
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <Link href="/app" className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800 hover:underline">
          <ArrowLeft aria-hidden="true" size={16} /> Return to People workspace
        </Link>
        <header className="mt-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Linaw HCM · Read-only</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Business Process Monitor</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Review recorded HR process stages, reviewer assignments and time-based step evidence.
              Decisions remain inside the owning governed workflows.
            </p>
          </div>
          <Link
            className="rounded-lg border border-emerald-700 bg-white px-4 py-3 text-sm font-semibold text-emerald-900 hover:bg-emerald-50"
            href={"/hcm/work-items?organizationId=" + organizationId}
          >Open HR work queue</Link>
        </header>

        <section aria-label="Workflow filters" className="mt-7 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-5">
          <div>
            <label htmlFor="hcm-bp-status" className="mb-2 block text-sm font-semibold">Process status</label>
            <select
              id="hcm-bp-status"
              value={filter}
              onChange={(event) => changeFilter(event.target.value as HcmBpMonitorFilter)}
              className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {HCM_BP_MONITOR_STATUSES.map((value) => (
                <option key={value} value={value}>{value === "all" ? "All recorded statuses" : label(value)}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setRevision((value) => value + 1)}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50"
          >
            <RefreshCw size={16} aria-hidden="true" /> Refresh
          </button>
          <p className="text-xs text-slate-500">Employer #{organizationId} · 20 most recent source records per page</p>
        </section>

        {phase === "loading" &&
          <p role="status" aria-live="polite" className="mt-5 rounded-xl border bg-white p-5 text-sm text-slate-600">Loading authorized HR processes…</p>}
        {phase === "unavailable" &&
          <div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
            <strong>Process source unavailable</strong>
            <p className="mt-1 text-sm">The source could not be loaded. This is not confirmation that no approvals or work items remain.</p>
          </div>}

        {current && (
          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <section aria-labelledby="hcm-bp-list-heading" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 id="hcm-bp-list-heading" className="text-lg font-semibold">Recorded business processes</h2>
                <ClipboardCheck className="text-emerald-700" size={18} aria-hidden="true" />
              </div>
              <p className="mt-1 text-xs text-slate-600">Source: hcm_business_process_instances. Displayed items are not a total count.</p>
              {current.items.length === 0 &&
                <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                  No records returned on this page and filter. This does not certify that every HR process is complete.
                </p>}
              <ol className="mt-4 space-y-2">
                {current.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-pressed={item.id === selectedId}
                      onClick={() => setSelectedId(item.id)}
                      className={"w-full rounded-lg border p-4 text-left text-sm " +
                        (item.id === selectedId ? "border-emerald-600 bg-emerald-50" : "border-slate-200 hover:bg-slate-50")}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong>{label(item.processType)} · #{item.id}</strong>
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs">{label(item.status)}</span>
                      </div>
                      <p className="mt-2 text-xs text-slate-600">
                        Started {phTime(item.initiatedAt)} · {item.sourceType} source
                      </p>
                      <p className="mt-1 text-xs text-slate-500">Workflow definition {item.definitionCode} v{item.definitionVersion}</p>
                    </button>
                  </li>
                ))}
              </ol>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button" onClick={previousPage} disabled={backstack.length === 0}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-40"
                >Previous</button>
                <span className="text-xs text-slate-600">{current.items.length} on this page{current.hasMore ? " · More available" : ""}</span>
                <button
                  type="button" onClick={nextPage} disabled={!current.nextCursor}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-40"
                >Next <ArrowRight size={14} aria-hidden="true" /></button>
              </div>
            </section>

            <section aria-labelledby="hcm-bp-detail-heading" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 id="hcm-bp-detail-heading" className="text-lg font-semibold">Process and step evidence</h2>
              {!selected && <p className="mt-5 text-sm text-slate-600">Select a process to see its recorded steps.</p>}
              {selected && (!matchingDetail || matchingDetail.phase === "loading") &&
                <p role="status" className="mt-5 text-sm text-slate-600">Loading workflow evidence…</p>}
              {selected && matchingDetail?.phase === "unavailable" &&
                <p role="alert" className="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-950">
                  Workflow step evidence is unavailable. Missing details are not evidence of completion.
                </p>}
              {details && (
                <>
                  <dl className="mt-4 grid gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-2">
                    <div><dt className="text-slate-500">Process status</dt><dd className="mt-1 font-semibold">{label(details.instance.status)}</dd></div>
                    <div><dt className="text-slate-500">Current step index</dt><dd className="mt-1 font-semibold">{details.instance.currentStepIndex}</dd></div>
                    <div><dt className="text-slate-500">Business effective date (not an SLA)</dt><dd className="mt-1 font-semibold">{phBusinessDate(details.instance.effectiveDate)}</dd></div>
                    <div><dt className="text-slate-500">Completed at</dt><dd className="mt-1 font-semibold">{phTime(details.instance.completedAt)}</dd></div>
                  </dl>
                  {details.steps.length === 0 &&
                    <p className="mt-4 text-sm text-slate-600">No step records were returned by this source. This is not an approval-complete statement.</p>}
                  <ol className="mt-4 divide-y divide-slate-100">
                    {details.steps.map((step) => (
                      <li key={step.id} className="py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">{label(step.stepType)} · Step #{step.stepIndex}</p>
                            <p className="mt-1 text-xs text-slate-600">Assigned reviewer: {step.assignee}</p>
                            <p className="mt-1 text-xs text-slate-500">Source step #{step.id} · {label(step.status)}</p>
                          </div>
                          <span className={"rounded-full border px-2 py-1 text-xs font-semibold " +
                            (step.sla === "overdue" ? "border-rose-200 bg-rose-50 text-rose-900" :
                             step.sla === "untracked" ? "border-amber-200 bg-amber-50 text-amber-900" :
                             "border-slate-200 text-slate-700")}>
                            {step.sla === "overdue" ? "Past due" :
                             step.sla === "due_later" ? "Deadline recorded" :
                             step.sla === "untracked" ? "No due time recorded" :
                             "Not pending"}
                          </span>
                        </div>
                        <p className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                          <Clock3 aria-hidden="true" size={13} />
                          Due {phTime(step.dueAt)} · Completed {phTime(step.completedAt)}
                        </p>
                      </li>
                    ))}
                  </ol>
                  {details.stepsPartial &&
                    <p role="status" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
                      This process has more step source records than the first 100 displayed.
                    </p>}
                </>
              )}
            </section>
          </div>
        )}
        <p className="mt-6 max-w-5xl text-xs text-slate-500">
          Monitoring is read-only. A missing SLA timestamp is unknown, not an on-time result;
          a business effective date is not a due timestamp. Neither a displayed process status nor an exported audit record
          is proof of payroll release, funds transfer, statutory compliance or independent approval.
        </p>
      </div>
    </main>
  );
}
