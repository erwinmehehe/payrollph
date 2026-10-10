"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Clock3, GitBranch, RefreshCcw, ShieldCheck } from "lucide-react";
import type { HcmMonitorPage } from "@/lib/hcm-bp-monitor-contract";
import type { MonitorSla } from "@/lib/hcm-bp-monitor-projection";

type State = {
  key: string;
  status: "loading" | "ready" | "unavailable";
  data: HcmMonitorPage | null;
};

const STATUS_OPTIONS = [
  "all", "in_progress", "approved", "applied", "declined", "cancelled", "failed",
] as const;

function pretty(value: string) {
  return value.replace(/[_:-]/g, " ").replace(/^./, (part) => part.toUpperCase());
}

function timeLabel(value: string | Date | null) {
  if (!value) return "No timestamp recorded";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Timestamp unavailable";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short",
  }).format(date) + " (PH)";
}

function businessDateLabel(value: string | null) {
  if (!value) return "No effective date recorded";
  const date = new Date(value + "T12:00:00+08:00");
  if (!Number.isFinite(date.getTime())) return "Effective date unavailable";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", dateStyle: "medium",
  }).format(date);
}

const SLA_LABEL: Record<MonitorSla, string> = {
  overdue: "Overdue at last read",
  due: "Due at last read",
  not_due: "Not yet due at last read",
  no_due_date: "No due timestamp recorded",
  completed: "Completed step",
  not_applicable: "SLA not applicable to this step",
};

function slaTone(state: MonitorSla) {
  if (state === "overdue") return "border-rose-200 bg-rose-50 text-rose-800";
  if (state === "due") return "border-amber-200 bg-amber-50 text-amber-900";
  if (state === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

/**
 * Each response is scoped to the selected employer AND cursor. Abort requests
 * and match the response envelope before displaying any process records.
 */
export function HcmBpMonitorClient({ organizationId }: { organizationId: number }) {
  const [cursors, setCursors] = useState<Array<number | null>>([null]);
  const [revision, setRevision] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [load, setLoad] = useState<State | null>(null);

  const cursor = cursors[cursors.length - 1] ?? null;
  const key = organizationId + ":" + (cursor === null ? "first" : cursor) + ":" + revision;

  useEffect(() => {
    setCursors([null]);
    setStatusFilter("all");
  }, [organizationId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ key, status: "loading", data: null });
    const params = new URLSearchParams({ organizationId: String(organizationId) });
    if (cursor !== null) params.set("beforeId", String(cursor));

    void fetch("/api/hcm/bp-monitor?" + params.toString(), {
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error("Monitor access or source unavailable.");
      }
      const payload = await response.json() as HcmMonitorPage;
      if (controller.signal.aborted) return;
      if (payload.tenantId !== organizationId ||
          !Array.isArray(payload.items) ||
          payload.items.length > 30 ||
          typeof payload.hasMore !== "boolean" ||
          (payload.hasMore && (!Number.isSafeInteger(payload.nextCursor) ||
            (payload.nextCursor ?? 0) <= 0))) {
        throw new Error("Monitor response did not match the authorized view.");
      }
      setLoad({ key, status: "ready", data: payload });
    }).catch(() => {
      if (!controller.signal.aborted) {
        setLoad({ key, status: "unavailable", data: null });
      }
    });
    return () => controller.abort();
  }, [organizationId, cursor, revision, key]);

  const active = load?.key === key ? load : null;
  const page = active?.status === "ready" ? active.data : null;
  const filtered = page?.items.filter((item) =>
    statusFilter === "all" || item.status === statusFilter) ?? [];
  const pending = page?.items.filter((item) => item.status === "in_progress").length ?? 0;
  const overdue = page?.items.reduce((total, item) =>
    total + item.steps.filter((step) => step.sla === "overdue").length, 0) ?? 0;
  const canGoBack = cursors.length > 1;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/app" className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800 hover:underline">
          <ArrowLeft size={16} aria-hidden="true" /> Return to HR workspace
        </Link>
        <header className="mt-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">
              Linaw HCM · Read-only
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Business Process Monitor</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Review source-recorded HR process states and step deadlines. Approval,
              delegation and employee updates remain in their existing governed workflows.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              Employer #{organizationId}
            </span>
            <button type="button"
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-100"
              onClick={() => setRevision((value) => value + 1)}>
              <RefreshCcw size={15} aria-hidden="true" /> Refresh
            </button>
          </div>
        </header>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          <p className="flex items-start gap-2">
            <ShieldCheck size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-800" />
            This is an evidence preview, not an approval surface or a complete compliance audit.
            An effective business date is not an SLA deadline.
          </p>
          {page && <p className="mt-2 text-xs text-slate-500">Source read: {timeLabel(page.observedAt)}</p>}
        </section>

        {(!active || active.status === "loading") && (
          <p role="status" aria-live="polite" className="mt-6 rounded-xl border border-slate-200 bg-white p-5 text-slate-600">
            Loading authorized business-process records…
          </p>
        )}
        {active?.status === "unavailable" && (
          <div role="alert" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
            <p className="font-semibold">Business Process Monitor unavailable</p>
            <p className="mt-1 text-sm">
              Access was denied, the source is unavailable, or the bounded preview was exceeded.
              No missing steps or statuses are interpreted as completed.
            </p>
          </div>
        )}

        {page && (
          <>
            <section aria-label="Current monitor page totals" className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                { label: "Processes on this page", number: page.items.length },
                { label: "In-progress processes on this page", number: pending },
                { label: "Overdue steps on this page", number: overdue },
              ].map((metric) => (
                <article key={metric.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs text-slate-600">{metric.label}</p>
                  <p className="mt-2 text-2xl font-bold">{metric.number}</p>
                </article>
              ))}
            </section>

            <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
              <div>
                <label htmlFor="hcm-monitor-filter" className="block text-sm font-semibold">Process status</label>
                <select id="hcm-monitor-filter" value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="mt-1 min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status === "all" ? "All statuses (this page)" : pretty(status)}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-slate-600">
                Filters apply to this page only; older records use the Next page control.
              </p>
            </div>

            <section aria-label="Source business processes" className="mt-4 space-y-4">
              {filtered.length === 0 && (
                <p className="rounded-xl border bg-white p-5 text-sm text-slate-600">
                  No matching processes appear on this page. This is not evidence of a complete tenant-wide history.
                </p>
              )}
              {filtered.map((item) => (
                <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                        Business process #{item.id}
                      </p>
                      <h2 className="mt-1 text-lg font-semibold">{pretty(item.processType)}</h2>
                      <p className="mt-1 text-xs text-slate-600">
                        Initiated {timeLabel(item.initiatedAt)} · Effective {businessDateLabel(item.effectiveDate)}
                      </p>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold">
                      {pretty(item.status)}
                    </span>
                  </div>
                  <details className="mt-4 border-t border-slate-100 pt-3">
                    <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-emerald-900">
                      <GitBranch size={16} aria-hidden="true" /> View recorded steps ({item.steps.length})
                    </summary>
                    {item.steps.length === 0 && (
                      <p className="mt-3 text-sm text-slate-600">
                        No steps returned for this source instance. This is not proof that no reviews occurred.
                      </p>
                    )}
                    <ol className="mt-3 divide-y divide-slate-100">
                      {item.steps.map((step) => (
                        <li key={step.id} className="py-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold">
                                Step {step.stepIndex + 1}: {pretty(step.type)}
                              </p>
                              <p className="mt-1 text-xs text-slate-600">
                                {pretty(step.status)} · Due timestamp: {step.dueAt ? timeLabel(step.dueAt) : "Not recorded"}
                              </p>
                            </div>
                            <span className={"inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs " + slaTone(step.sla)}>
                              {step.sla === "completed" ? (
                                <CheckCircle2 size={13} aria-hidden="true" />
                              ) : <Clock3 size={13} aria-hidden="true" />}
                              {SLA_LABEL[step.sla]}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </details>
                </article>
              ))}
            </section>

            <nav aria-label="Process monitor pages" className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <button type="button" disabled={!canGoBack}
                onClick={() => setCursors((stack) => stack.length > 1 ? stack.slice(0, -1) : stack)}
                className="min-h-10 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">
                Newer page
              </button>
              <p className="text-xs text-slate-600">Page {cursors.length} · Up to {page.pageSize} processes per page</p>
              <button type="button"
                disabled={!page.hasMore || page.nextCursor === null}
                onClick={() => {
                  if (page.nextCursor !== null) setCursors((stack) => [...stack, page.nextCursor]);
                }}
                className="min-h-10 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">
                Older page
              </button>
            </nav>
            <p className="mt-6 text-xs text-slate-500">
              Source: hcm_business_process_instances and hcm_business_process_instance_steps.
              Staff names, compensation, free-text decisions, and payroll outputs are excluded.
              This monitor never changes the owning process or provides an approval action.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
