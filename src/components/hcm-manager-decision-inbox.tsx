"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeft, ArrowRight, CalendarDays, CheckSquare2,
  Clock3, FileCheck2, LockKeyhole, RefreshCw, ShieldCheck,
  UsersRound, Workflow,
} from "lucide-react";
import type {
  DecisionSource, ManagerDecisionPage, ManagerDecisionItem,
} from "@/lib/hcm-manager-decision-contract";

const SOURCES: Array<{
  key: DecisionSource; label: string; hint: string;
}> = [
  { key: "hcm", label: "HCM processes", hint: "Governed reviews and approvals" },
  { key: "leave", label: "Leave", hint: "Linked leave approval tasks" },
  { key: "overtime", label: "Overtime", hint: "Linked overtime approval tasks" },
];
type LoadState = {
  key: string;
  status: "loading" | "ready" | "error";
  payload: ManagerDecisionPage | null;
};

function manilaTimestamp(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Timestamp unavailable";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium", timeStyle: "short",
  }).format(date) + " (PH)";
}
function labelProcess(value: string) {
  const labels: Record<string, string> = {
    change_job: "Change job", transfer: "Transfer", promotion: "Promotion",
    hire: "Hire review", create_position: "Position creation",
    close_position: "Position closure",
  };
  return labels[value] ?? value;
}
function assignmentLabel(item: ManagerDecisionItem) {
  if (item.assignment === "role") return "Role queue";
  return item.assignment === "delegated" ? "Active delegation" : "Named assignment";
}
function dueTone(item: ManagerDecisionItem) {
  return item.dueState === "overdue"
    ? "border-rose-200 bg-rose-50 text-rose-800"
    : item.dueState === "upcoming"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-slate-200 bg-slate-50 text-slate-600";
}

/**
 * Read-only, request-scoped data. This page NEVER calls a decision endpoint:
 * the owning approval routes enforce fresh identity, scope and maker/checker.
 */
export function HcmManagerDecisionInbox({ organizationId }: { organizationId: number }) {
  const [source, setSource] = useState<DecisionSource>("hcm");
  const [cursors, setCursors] = useState<Array<number | null>>([null]);
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<LoadState | null>(null);

  const beforeId = cursors[cursors.length - 1] ?? null;
  const requestKey = [organizationId, source, beforeId ?? "first", refresh].join(":");

  useEffect(() => {
    const controller = new AbortController();
    setLoaded({ key: requestKey, status: "loading", payload: null });
    const params = new URLSearchParams({
      organizationId: String(organizationId), source,
    });
    if (beforeId !== null) params.set("beforeId", String(beforeId));

    void fetch("/api/hcm/manager-decision-inbox?" + params.toString(), {
      cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("Inbox source unavailable");
      const payload = await response.json() as ManagerDecisionPage;
      if (controller.signal.aborted) return;
      if (
        payload.organizationId !== organizationId ||
        payload.source !== source ||
        !["company", "unit"].includes(payload.scope?.kind) ||
        !Array.isArray(payload.items) || payload.items.length > 20 ||
        payload.page?.size !== 20 ||
        typeof payload.page.hasMore !== "boolean" ||
        (payload.page.hasMore && (
          typeof payload.page.nextCursor !== "number" ||
          !Number.isSafeInteger(payload.page.nextCursor) ||
          payload.page.nextCursor <= 0 ||
          (beforeId !== null && payload.page.nextCursor >= beforeId)
        )) ||
        payload.items.some((item) =>
          item.source !== source || item.status !== "pending" ||
          !Number.isSafeInteger(item.id) || item.id <= 0 ||
          (beforeId !== null && item.id >= beforeId))
      ) {
        throw new Error("The response did not match the requested source and employer.");
      }
      setLoaded({ key: requestKey, status: "ready", payload });
    }).catch(() => {
      if (!controller.signal.aborted) {
        setLoaded({ key: requestKey, status: "error", payload: null });
      }
    });
    return () => controller.abort();
  }, [organizationId, source, beforeId, requestKey]);

  const active = loaded?.key === requestKey ? loaded : null;
  const page = active?.status === "ready" ? active.payload : null;
  function changeSource(next: DecisionSource) {
    setSource(next);
    setCursors([null]);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-16 pt-6 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/app"
          className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-emerald-800 hover:underline">
          <ArrowLeft size={16} aria-hidden="true" /> Back to workspace
        </Link>

        <header className="relative mt-4 overflow-hidden rounded-2xl bg-slate-900 px-6 py-8 text-white sm:px-9 sm:py-10">
          <div aria-hidden="true" className="absolute -right-28 -top-32 size-80 rounded-full border-[48px] border-emerald-400/10"/>
          <div className="relative flex flex-wrap items-end justify-between gap-5">
            <div className="max-w-2xl">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-300">
                <Workflow size={15} aria-hidden="true" /> Linaw HCM / Governed work
              </p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                My Decision Inbox
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                A focused view of HCM, leave and overtime tasks matched to your
                current role, named assignment or active delegation.
              </p>
            </div>
            <button type="button"
              onClick={() => setRefresh((current) => current + 1)}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20">
              <RefreshCw aria-hidden="true" size={16} /> Refresh
            </button>
          </div>
        </header>

        <section aria-label="Authorization and audit scope" className="mt-5 flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-emerald-50 p-2 text-emerald-800">
              <ShieldCheck aria-hidden="true" size={18} />
            </span>
            <div>
              <p className="text-sm font-semibold">Permission-checked preview</p>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">
                Employer #{organizationId} · {page?.scope.kind === "unit"
                  ? "Exact assigned organizational unit"
                  : page?.scope.kind === "company" ? "Company-wide HR oversight" : "Verifying your permitted scope"}.
                The source workflow remains responsible for every approval, review and delegation decision.
              </p>
            </div>
          </div>
          {page && <p className="text-xs text-slate-500">Read {manilaTimestamp(page.observedAt)}</p>}
        </section>

        <div role="tablist" aria-label="Decision sources"
          className="mt-6 grid gap-2 rounded-xl border border-slate-200 bg-white p-2 sm:grid-cols-3">
          {SOURCES.map((option) => (
            <button key={option.key} type="button" role="tab"
              id={"manager-decision-tab-" + option.key}
              aria-selected={source === option.key}
              aria-controls="manager-decision-results"
              onClick={() => changeSource(option.key)}
              className={"min-h-16 rounded-lg px-4 py-3 text-left transition-colors " +
                (source === option.key
                  ? "bg-emerald-800 text-white shadow-sm"
                  : "bg-white text-slate-700 hover:bg-slate-50")}>
              <span className="block text-sm font-bold">{option.label}</span>
              <span className={"mt-1 block text-xs " + (source === option.key ? "text-emerald-100" : "text-slate-500")}>
                {option.hint}
              </span>
            </button>
          ))}
        </div>

        <section id="manager-decision-results" role="tabpanel" aria-labelledby={"manager-decision-tab-" + source}>
          {(!active || active.status === "loading") && (
            <div role="status" aria-live="polite"
              className="mt-5 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
              Checking current assignments and delegation evidence…
            </div>
          )}
          {active?.status === "error" && (
            <div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-950">
              This source is unavailable or your access changed. Previously loaded records were cleared.
              Refresh the view or return to the authoritative workspace.
            </div>
          )}

          {page && (
            <>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <article className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-slate-600">Assigned items on this page</p>
                    <UsersRound size={17} aria-hidden="true" className="text-emerald-700"/>
                  </div>
                  <p className="mt-3 text-3xl font-bold tabular-nums">{page.totals.assignedItemsThisPage}</p>
                  <p className="mt-1 text-xs text-slate-500">Source candidates are checked individually</p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-slate-600">Overdue source deadlines</p>
                    <Clock3 size={17} aria-hidden="true" className="text-amber-700"/>
                  </div>
                  <p className="mt-3 text-3xl font-bold tabular-nums">{page.totals.overdueItemsThisPage}</p>
                  <p className="mt-1 text-xs text-slate-500">From recorded due timestamps only</p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-slate-600">Queue scope</p>
                    <LockKeyhole size={17} aria-hidden="true" className="text-emerald-700"/>
                  </div>
                  <p className="mt-3 text-lg font-bold">{page.scope.kind === "company" ? "Employer" : "Assigned unit"}</p>
                  <p className="mt-1 text-xs text-slate-500">Always revalidated server-side</p>
                </article>
              </div>

              <div className="mt-6 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold">Pending source assignments</h2>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                  Read only
                </span>
              </div>
              {page.items.length === 0 && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-white p-6">
                  <div className="flex items-center gap-2 text-slate-800">
                    <CheckSquare2 size={19} aria-hidden="true" className="text-emerald-700"/>
                    <p className="font-semibold">No verified assignments on this source page</p>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    This is not proof that all approvals are completed. Candidate rows that failed
                    the current assignment check are deliberately excluded.
                  </p>
                </div>
              )}

              <ul aria-label="Assigned HCM workflow source records" className="mt-3 space-y-3">
                {page.items.map((item) => (
                  <li key={item.source + ":" + item.id}
                    className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800">
                          {item.source === "hcm"
                            ? <Workflow size={20} aria-hidden="true"/>
                            : item.source === "leave"
                              ? <CalendarDays size={20} aria-hidden="true"/>
                              : <FileCheck2 size={20} aria-hidden="true"/>}
                        </span>
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
                            {item.stepType === "to_do" ? "To do" :
                              item.stepType === "review" ? "Review" : "Approval"} · Source #{item.sourceRecordId}
                          </p>
                          <h3 className="mt-1 text-lg font-semibold">{labelProcess(item.processType)}</h3>
                          <p className="mt-1 text-sm text-slate-600">
                            {item.employee
                              ? item.employee.name + " · Employee #" + item.employee.employeeNo
                              : "Position or process source without a verified employee link"}
                          </p>
                        </div>
                      </div>
                      <span className={"rounded-full border px-3 py-1 text-xs font-semibold " + dueTone(item)}>
                        {item.dueState === "overdue" ? "Overdue" :
                          item.dueState === "upcoming" ? "Upcoming" : "No due timestamp"}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-xs text-slate-600 sm:grid-cols-3">
                      <p><span className="block font-medium text-slate-500">Assignment</span>
                        <strong className="mt-1 block text-sm font-semibold text-slate-800">{assignmentLabel(item)}</strong>
                      </p>
                      <p><span className="block font-medium text-slate-500">Source priority</span>
                        <strong className="mt-1 block text-sm font-semibold text-slate-800">{item.priority}</strong>
                      </p>
                      <p><span className="block font-medium text-slate-500">Recorded deadline</span>
                        <strong className="mt-1 block text-sm font-semibold text-slate-800">
                          {item.dueAt ? manilaTimestamp(item.dueAt) : "Not recorded"}
                        </strong>
                      </p>
                    </div>
                    <p className="mt-4 text-xs text-slate-500">
                      {item.source === "hcm"
                        ? "HCM approval/review decisions remain in their governed workflow."
                        : "Use the existing Approvals workspace to review this linked request. Final authorization is checked there."}
                    </p>
                  </li>
                ))}
              </ul>

              <nav aria-label="Decision source pages"
                className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <button type="button" disabled={cursors.length <= 1}
                  onClick={() => setCursors((history) => history.length > 1 ? history.slice(0, -1) : history)}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">
                  <ArrowLeft size={16} aria-hidden="true" /> Newer candidates
                </button>
                <p className="text-xs text-slate-600">Source page {cursors.length} · Up to {page.page.size} candidate rows</p>
                <button type="button" disabled={!page.page.hasMore || page.page.nextCursor === null}
                  onClick={() => {
                    const next = page.page.nextCursor;
                    if (next !== null) setCursors((history) => [...history, next]);
                  }}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">
                  Older candidates <ArrowRight size={16} aria-hidden="true"/>
                </button>
              </nav>

              <p className="mt-6 max-w-4xl text-xs leading-5 text-slate-500">
                {page.notice} No decision, delegation, employee, payroll or bank action is performed here.
                Leave and overtime start/work dates are not contractual SLA deadlines.
              </p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
