"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, ClipboardList, RefreshCw, ShieldCheck } from "lucide-react";
import type { Worker360Summary } from "@/lib/hcm-worker-360-contract";
import { validWorker360Date } from "@/lib/hcm-worker-360-projection";

type Load = {
  key: string;
  status: "loading" | "ready" | "error";
  data: Worker360Summary | null;
  error: string;
};

function dateText(value: string | null) {
  if (!value) return "No end date recorded";
  const date = new Date(value + "T12:00:00+08:00");
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric",
  }).format(date);
}

function eventLabel(value: string) {
  return value.replace(/[_:-]+/g, " ").replace(/^./, (first) => first.toUpperCase());
}

export function Worker360Client({
  organizationId, employeeId, initialAsOfDate,
}: {
  organizationId: number;
  employeeId: number;
  initialAsOfDate: string;
}) {
  const [asOfDate, setAsOfDate] = useState(initialAsOfDate);
  const [revision, setRevision] = useState(0);
  const [load, setLoad] = useState<Load | null>(null);
  const scope = [organizationId, employeeId, asOfDate, revision].join(":");
  const validDate = validWorker360Date(asOfDate);

  useEffect(() => {
    if (!validDate) return;
    const controller = new AbortController();
    setLoad({ key: scope, status: "loading", data: null, error: "" });
    const url = new URLSearchParams({
      organizationId: String(organizationId),
      employeeId: String(employeeId),
      asOfDate,
    });
    void fetch("/api/hcm/worker-360?" + url.toString(), {
      cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) {
        if (response.status === 403 || response.status === 404) {
          throw new Error("This worker is not available to your current employer and role.");
        }
        throw new Error("The Worker 360 source is currently unavailable.");
      }
      const data = await response.json() as Worker360Summary;
      if (controller.signal.aborted) return;
      if (data.tenantId !== organizationId || data.employeeId !== employeeId ||
          data.asOfDate !== asOfDate || !data.worker || !data.primaryAssignment ||
          !Array.isArray(data.employmentEvents?.preview?.items)) {
        throw new Error("The returned employee context did not match this request.");
      }
      setLoad({ key: scope, status: "ready", data, error: "" });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setLoad({
        key: scope, status: "error", data: null,
        error: error instanceof Error ? error.message : "Unable to load Worker 360.",
      });
    });
    return () => controller.abort();
  }, [organizationId, employeeId, asOfDate, scope, validDate]);

  const active = load?.key === scope ? load : null;
  const data = active?.status === "ready" ? active.data : null;
  const assignment = data?.primaryAssignment.selection;
  const history = data?.employmentEvents.preview;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/app" className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800 underline-offset-4 hover:underline">
          <ArrowLeft aria-hidden="true" size={16} /> Return to People workspace
        </Link>
        <header className="mt-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">Linaw HCM · Read-only</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Worker 360</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Employee context and effective-dated history from existing HR records. No employee or payroll data can be changed here.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
            Employer ID <strong className="ml-2 text-slate-900">{organizationId}</strong>
            <span className="mx-3 text-slate-300">|</span>
            Worker ID <strong className="ml-2 text-slate-900">{employeeId}</strong>
          </div>
        </header>

        <section aria-label="History date and refresh" className="mt-7 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <label htmlFor="worker360-asof" className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <CalendarDays size={16} aria-hidden="true" /> History as of (Philippine date)
            </label>
            <input
              id="worker360-asof"
              type="date"
              required
              value={asOfDate}
              onChange={(event) => setAsOfDate(event.target.value)}
              className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              aria-invalid={!validDate}
            />
          </div>
          <button
            type="button"
            disabled={!validDate}
            onClick={() => setRevision((current) => current + 1)}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw size={15} aria-hidden="true" /> Refresh
          </button>
          <p className="max-w-xl text-xs text-slate-600">
            The date filters recorded assignments and employment events only. Current employee title and status are not historical snapshots.
          </p>
        </section>

        {!validDate && <p role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">Choose a valid calendar date.</p>}
        {validDate && (!active || active.status === "loading") &&
          <p role="status" aria-live="polite" className="mt-5 rounded-xl border bg-white p-5 text-slate-600">Loading authorized worker records…</p>}
        {active?.status === "error" &&
          <div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-5">
            <p className="font-semibold text-amber-950">Worker information unavailable</p>
            <p className="mt-1 text-sm text-amber-900">{active.error}</p>
            <p className="mt-1 text-sm text-amber-900">No missing source should be interpreted as a successful or complete HR process.</p>
          </div>}

        {data && (
          <>
            <section aria-labelledby="worker360-current" className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Current employee record</p>
                  <h2 id="worker360-current" className="mt-2 text-2xl font-bold">{data.worker.name}</h2>
                  <p className="mt-1 text-slate-600">{data.worker.currentTitle}</p>
                </div>
                <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
                  Current status: {data.worker.currentStatus}
                </span>
              </div>
              <dl className="mt-6 grid gap-4 border-t border-slate-100 pt-5 text-sm sm:grid-cols-3">
                <div><dt className="text-slate-500">Employee number</dt><dd className="mt-1 font-semibold">{data.worker.employeeNo}</dd></div>
                <div><dt className="text-slate-500">Recorded start date</dt><dd className="mt-1 font-semibold">{dateText(data.worker.startedOn)}</dd></div>
                <div><dt className="text-slate-500">Read at</dt><dd className="mt-1 font-semibold">{new Intl.DateTimeFormat("en-PH", {
                  timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short",
                }).format(new Date(data.observedAt))} (PH)</dd></div>
              </dl>
              <p className="mt-5 flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-950">
                <ShieldCheck aria-hidden="true" className="shrink-0" size={16} />
                Source: employees. Title and status describe the current record, not the historical state on {dateText(asOfDate)}.
              </p>
            </section>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <section aria-labelledby="worker360-assignment" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Recorded position history</p>
                <h2 id="worker360-assignment" className="mt-2 text-xl font-bold">Primary assignment as of {dateText(asOfDate)}</h2>
                {assignment?.status === "recorded" ? (
                  <dl className="mt-5 space-y-4 text-sm">
                    <div><dt className="text-slate-500">Position reference</dt><dd className="font-semibold">Position #{assignment.assignment.positionId}</dd></div>
                    <div><dt className="text-slate-500">Assignment source</dt><dd className="font-semibold">position_assignments #{assignment.assignment.id}</dd></div>
                    <div><dt className="text-slate-500">Effective interval</dt><dd className="font-semibold">{dateText(assignment.assignment.effectiveFrom)} — {dateText(assignment.assignment.effectiveUntil)}</dd></div>
                  </dl>
                ) : (
                  <p role="status" className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                    {assignment?.status === "ambiguous"
                      ? "More than one primary position assignment applies on this date. HR source reconciliation is required; no single position is assumed."
                      : "No primary position assignment was recorded for this date. This does not establish that the worker had no job."}
                  </p>
                )}
                <p className="mt-5 text-xs text-slate-500">Historical job title, manager and department are intentionally not inferred from today's mutable position record.</p>
              </section>

              <section aria-labelledby="worker360-history" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 text-emerald-800">
                  <ClipboardList size={16} aria-hidden="true" />
                  <p className="text-xs font-bold uppercase tracking-wide">Employment event source</p>
                </div>
                <h2 id="worker360-history" className="mt-2 text-xl font-bold">Recorded events</h2>
                <p className="mt-2 text-xs text-slate-500">Source: worker_employment_events · Effective on or before {dateText(asOfDate)}</p>
                {history?.items.length === 0 &&
                  <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No events were returned by this source preview. Legacy or unlinked events may exist elsewhere.</p>}
                {history && history.items.length > 0 && (
                  <ol className="mt-4 divide-y divide-slate-100">
                    {history.items.map((event) => (
                      <li key={event.id} className="flex items-start justify-between gap-3 py-3">
                        <div>
                          <p className="text-sm font-semibold">{eventLabel(event.eventType)}</p>
                          <p className="mt-1 text-xs text-slate-500">{dateText(event.effectiveDate)}</p>
                          {event.positionAssignmentId && <p className="mt-1 text-xs text-slate-500">Linked assignment #{event.positionAssignmentId}</p>}
                        </div>
                        <span className="shrink-0 text-xs text-slate-500">Event #{event.id}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {history?.hasMore &&
                  <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-950">
                    Showing only the first 25 source events. This preview is incomplete.
                  </p>}
              </section>
            </div>
            <p className="mt-6 max-w-4xl text-xs text-slate-500">
              Worker 360 provides a bounded, source-linked view. It is not proof of complete employment history, verified statutory compliance, payroll settlement or independently approved HR decisions. All changes must occur in their owning workflows.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
