"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, ClipboardCheck, FileCheck2, RefreshCw, Search, UserPlus, UsersRound,
} from "lucide-react";
import {
  buildOnboardingChecklistGroups,
  filterOnboardingChecklistGroups,
  type OnboardingEmployee,
  type OnboardingTask,
} from "@/lib/hris-onboarding-checklist";

const MAX_VISIBLE_EMPLOYEES = 15;

/**
 * A guided UI over existing, audit-logged provisioning tasks. No new approval,
 * payroll, bank or government-ID operation is introduced.
 *
 * Only employer-scoped dashboard data is presented. Server-side PATCH RBAC,
 * tenant scope and audit logging remain authoritative.
 */
export function HrisOnboardingChecklist({
  organizationId,
  employees,
  provisioning,
  onRefresh,
  onOpenEmployee,
  onAddEmployee,
  onOpenDocuments,
  allowHirePayrollReview = false,
}: {
  organizationId: number;
  employees: readonly OnboardingEmployee[];
  provisioning: readonly OnboardingTask[] | undefined;
  onRefresh: () => Promise<void>;
  onOpenEmployee: (employeeId: number) => void;
  /** Launches the existing authorized employee creation workflow, not a second hire record. */
  onAddEmployee?: () => void;
  onOpenDocuments?: () => void;
  allowHirePayrollReview?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"open" | "all">("open");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [snapshotStale, setSnapshotStale] = useState(false);
  const mutationInFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const groups = useMemo(
    () => buildOnboardingChecklistGroups(employees, provisioning ?? []),
    [employees, provisioning],
  );
  const filtered = useMemo(
    () => filterOnboardingChecklistGroups(groups, query, show),
    [groups, query, show],
  );
  const visible = filtered.slice(0, MAX_VISIBLE_EMPLOYEES);
  const openWorkers = groups.filter((group) => group.remaining > 0).length;
  const outstanding = groups.reduce((sum, group) => sum + group.remaining, 0);

  async function refreshSnapshot() {
    if (mutationInFlight.current) return;
    setNotice("");
    setError("");
    try {
      await onRefresh();
      if (mounted.current) setSnapshotStale(false);
    } catch {
      if (mounted.current) setError("Could not reload the onboarding snapshot. Try again.");
    }
  }

  async function setTaskDone(employeeId: number, task: OnboardingTask, done: boolean) {
    if (mutationInFlight.current || snapshotStale || !Number.isSafeInteger(organizationId) ||
        organizationId <= 0) return;
    // A forged or stale client record cannot introduce a new task ID.
    if (!groups.some((group) => group.employee.id === employeeId &&
        group.tasks.some((current) => current.id === task.id &&
          current.employeeId === employeeId && current.done === !done))) return;
    if (done && !window.confirm(
      "Confirm this onboarding item was completed in its owning process. " +
      "This only records a checklist update; it does not independently verify bank details, " +
      "government IDs, required documents or payroll readiness.",
    )) return;

    mutationInFlight.current = true;
    setBusyId(task.id);
    setError("");
    setNotice("");
    let recorded = false;
    try {
      const response = await fetch("/api/provisioning", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, organizationId, employeeId, done }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not update the checklist item.");
      if (payload.organizationId !== organizationId ||
          payload.employeeId !== employeeId ||
          payload.id !== task.id ||
          payload.kind !== "onboarding" ||
          payload.done !== done) {
        if (mounted.current) setSnapshotStale(true);
        throw new Error("The task update did not match this employee and employer. Reload the workspace.");
      }
      recorded = true;
      if (!mounted.current) return;
      await onRefresh();
      if (mounted.current) setNotice(
        done ? "Checklist item marked complete in the source workflow."
          : "Checklist item reopened in the source workflow.",
      );
    } catch (cause) {
      if (mounted.current) {
        if (recorded) setSnapshotStale(true);
        setError(recorded
          ? "The checklist was updated, but the dashboard could not refresh. Reload before making further changes."
          : cause instanceof Error ? cause.message : "The checklist update failed.");
      }
    } finally {
      mutationInFlight.current = false;
      if (mounted.current) setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="hris-onboarding-heading" aria-busy={busyId !== null}
      className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-800">
            <ClipboardCheck size={18} aria-hidden="true"/>
            <p className="text-xs font-bold uppercase tracking-widest">New-hire operations</p>
          </div>
          <h2 id="hris-onboarding-heading" className="mt-2 text-xl font-semibold">
            Onboarding checklist
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Track recorded handoffs for HR, IT and Finance after a worker is hired.
            These tasks are stored in the existing provisioning workflow, not a second checklist.
          </p>
        </div>
        {onAddEmployee ? <div className="flex flex-wrap items-center gap-2">
          {onAddEmployee && (
            <button type="button" onClick={onAddEmployee}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-900 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
              <UserPlus size={16} aria-hidden="true"/> Add employee &amp; start onboarding
            </button>
          )}
          <button type="button" onClick={() => void refreshSnapshot()} disabled={busyId !== null}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw size={15} aria-hidden="true"/> Refresh
          </button>
        </div> : <button type="button" onClick={() => void refreshSnapshot()} disabled={busyId !== null}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={15} aria-hidden="true"/> Refresh
        </button>}
      </div>

      {error && <p role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
      {snapshotStale && <p role="status" className="mt-3 text-xs font-semibold text-amber-900">
        Checklist edits are paused until a fresh employer snapshot is loaded. Use Refresh above.
      </p>}
      {notice && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}

      {provisioning === undefined ? (
        <p role="status" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The provisioning source was not included in this workspace snapshot. No outstanding or completed tasks can be confirmed.
        </p>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-medium text-slate-600">Workers with recorded checklists</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{groups.length}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-medium text-slate-600">Workers with open recorded tasks</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{openWorkers}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-medium text-slate-600">Recorded tasks remaining</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{outstanding}</p>
            </div>
          </div>

          {groups.length === 0 ? (
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-semibold text-slate-700">
              Find employee
              <span className="relative">
                <Search size={15} aria-hidden="true" className="absolute left-3 top-3 text-slate-500"/>
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
                  placeholder="Name or employee number" aria-label="Search onboarding checklists"
                  className="min-h-10 w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900"/>
              </span>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
              Show
              <select value={show} onChange={(event) => setShow(event.target.value === "all" ? "all" : "open")}
                className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
                <option value="open">Open checklists</option>
                <option value="all">All recorded checklists</option>
              </select>
            </label>
          </div>
          ) : (
            <>
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-semibold text-slate-700">
              Find employee
              <span className="relative">
                <Search size={15} aria-hidden="true" className="absolute left-3 top-3 text-slate-500"/>
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
                  placeholder="Name or employee number" aria-label="Search onboarding checklists"
                  aria-controls="hris-onboarding-results" aria-describedby="hris-onboarding-search-hint"
                  className="min-h-11 w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"/>
              </span>
            </label>
            {query.length > 0 && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear onboarding employee search"
                className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                Clear search
              </button>
            )}
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
              Show
              <select value={show} onChange={(event) => setShow(event.target.value === "all" ? "all" : "open")}
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                <option value="open">Open checklists</option>
                <option value="all">All recorded checklists</option>
              </select>
            </label>
          </div>
          <p id="hris-onboarding-search-hint" className="mt-2 text-xs leading-5 text-slate-600">
            Search only recorded tasks for employees visible to your current employer and role. Up to 15 matching checklists are shown.
          </p>
          {groups.length > 0 && (
            <p id="hris-onboarding-filter-count" role="status" aria-live="polite"
              className="mt-2 text-xs font-medium text-slate-700">
              Showing {visible.length} of {filtered.length} matching recorded checklists.
              {filtered.length > visible.length ? " Refine your search to see additional matches." : ""}
            </p>
          )}
            </>
          )}
          {groups.length === 0 && (
            <p role="status" className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
              No onboarding tasks are recorded for the employees in this snapshot. This does not establish that onboarding is complete or that everyone has a checklist.
            </p>
          )}
          {groups.length > 0 && filtered.length === 0 && (
            <div role="status" className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
              <p>
                No recorded checklists match this filter. This does not verify onboarding completion
                or mean that employees without recorded tasks are fully onboarded.
              </p>
              <button type="button" onClick={() => { setShow("all"); setQuery(""); }}
                className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-emerald-700 px-4 py-2 font-semibold text-emerald-900 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                Show all recorded checklists
              </button>
            </div>
          )}

          <div id={groups.length > 0 ? "hris-onboarding-results" : undefined} className="mt-4 grid gap-4 lg:grid-cols-2">
            {visible.map((group) => (
              <article key={group.employee.id} className="min-w-0 rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <UsersRound size={18} aria-hidden="true" className="mt-1 shrink-0 text-emerald-800"/>
                    <div className="min-w-0">
                      <h3 className="font-semibold">{group.employee.firstName} {group.employee.lastName}</h3>
                      <p className="text-xs text-slate-600">{group.employee.employeeNo} · {group.employee.status}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => onOpenEmployee(group.employee.id)}
                      aria-label={"Open employee record for " + group.employee.firstName + " " + group.employee.lastName}
                      className="inline-flex min-h-11 items-center gap-1 rounded-md text-xs font-semibold text-emerald-800 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                      Employee record <ArrowRight size={14} aria-hidden="true"/>
                    </button>
                    {allowHirePayrollReview && (
                      <Link
                        href={"/hcm/hire-payroll-review?organizationId=" + organizationId +
                          "&employeeId=" + group.employee.id}
                        className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-emerald-800 underline-offset-2 hover:underline focus-visible:underline"
                        aria-label={"Review recorded payroll input evidence for " +
                          group.employee.firstName + " " + group.employee.lastName}
                      >
                        Review payroll inputs <ArrowRight size={14} aria-hidden="true"/>
                      </Link>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-slate-600">
                  <span>{group.markedDone} of {group.recorded} recorded tasks marked complete</span>
                  <span>{group.remaining ? group.remaining + " open" : "All recorded tasks marked"}</span>
                </div>
                <progress value={group.markedDone} max={group.recorded}
                  aria-label={"Recorded onboarding task progress for " + group.employee.firstName + " " + group.employee.lastName}
                  className="mt-2 h-2 w-full accent-emerald-700"/>
                <ul className="mt-3 space-y-2">
                  {group.tasks.map((task) => (
                    <li key={task.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                      <label className="flex cursor-pointer items-start gap-3">
                        <input type="checkbox" checked={task.done}
                          disabled={busyId !== null || snapshotStale}
                          onChange={() => void setTaskDone(group.employee.id, task, !task.done)}
                          aria-label={(task.done ? "Reopen: " : "Mark complete: ") + task.title + " for " + group.employee.firstName + " " + group.employee.lastName}
                          className="mt-0.5 size-4 shrink-0 accent-emerald-700"/>
                        <span className="min-w-0 flex-1">
                          <span className={"block text-sm " + (task.done ? "text-slate-500" : "font-medium text-slate-900")}>
                            {task.title}
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-600">
                            Owner: {task.owner} · {busyId === task.id ? "Saving…" : task.done ? "Recorded complete" : "Pending"}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <p className="max-w-3xl text-xs leading-5 text-slate-600">
          Completing a task is a manual, audit-logged checklist update. It is not government-ID verification,
          document approval, bank-account validation, independent hire approval, or payroll authorization.
        </p>
        {onOpenDocuments && (
          <button type="button" onClick={onOpenDocuments}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-800 px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-50">
            <FileCheck2 size={16} aria-hidden="true"/> Review document evidence
          </button>
        )}
      </div>
    </section>
  );
}
