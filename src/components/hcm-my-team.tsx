"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Building2, CalendarClock, CheckCircle2,
  ClipboardCheck, Clock3, FileWarning, RefreshCcw, Search, ShieldCheck, UsersRound,
} from "lucide-react";
import { MY_TEAM_STATUSES, type MyTeamResponse, type MyTeamStatusFilter } from "@/lib/hcm-my-team-contract";
import { HcmMyTeamActionCenter } from "@/components/hcm-my-team-action-center";
import { readScopedResponse, scopedReadFailureMessage, type ScopedReadFailure } from "@/lib/hcm-scoped-read-failure";
import { validMyTeamResponse } from "@/lib/hcm-scoped-read-validation";

type FetchState = {
  scopeKey: string;
  status: "loading" | "ready" | "unavailable";
  value: MyTeamResponse | null;
  failure?: ScopedReadFailure;
};

const STATUS_TONE: Record<string, string> = {
  Active: "border-emerald-200 bg-emerald-50 text-emerald-800",
  "On leave": "border-amber-200 bg-amber-50 text-amber-900",
  Separating: "border-orange-200 bg-orange-50 text-orange-900",
};

function observedInManila(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Source time unavailable";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short",
  }).format(date) + " (PH)";
}

/**
 * One employer at a time. Read-only team overview only:
 * approvals and staffing changes remain in the owning source workflows.
 */
export function HcmMyTeamClient({
  organizationId, pilotFocusEnabled = false,
}: { organizationId: number; pilotFocusEnabled?: boolean }) {
  return <ScopedMyTeam key={organizationId} organizationId={organizationId}
    pilotFocusEnabled={pilotFocusEnabled} />;
}

function ScopedMyTeam({
  organizationId, pilotFocusEnabled,
}: { organizationId: number; pilotFocusEnabled: boolean }) {
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<MyTeamStatusFilter>("all");
  const [cursors, setCursors] = useState<number[]>([0]);
  const [refreshCount, setRefreshCount] = useState(0);
  const [stored, setStored] = useState<FetchState | null>(null);

  const cursor = cursors[cursors.length - 1] ?? 0;
  const scopeKey = JSON.stringify([organizationId, cursor, searchQuery, statusFilter, refreshCount]);

  useEffect(() => {
    const controller = new AbortController();
    // A new scope has no completed response; loading is derived during render.
    const query = new URLSearchParams({
      organizationId: String(organizationId),
      cursor: String(cursor),
      q: searchQuery,
      status: statusFilter,
    });

    void readScopedResponse(
      () => fetch("/api/hcm/my-team?" + query.toString(), {
        cache: "no-store", signal: controller.signal,
      }),
      (payload): payload is MyTeamResponse =>
        validMyTeamResponse(payload, organizationId, cursor, searchQuery, statusFilter),
    ).then((result) => {
      if (controller.signal.aborted) return;
      if (result.status === "ready") {
        setStored({ scopeKey, status: "ready", value: result.data });
      } else {
        setStored({ scopeKey, status: "unavailable", value: null, failure: result.failure });
      }
    });

    return () => controller.abort();
  }, [organizationId, cursor, searchQuery, statusFilter, scopeKey]);

  const active = stored?.scopeKey === scopeKey ? stored : null;
  const data = active?.status === "ready" ? active.value : null;
  const hasPrevious = cursors.length > 1;
  // This is only navigation discovery. The calendar verifies the employer,
  // current unit, permission set and live server feature gate independently.
  const canOpenLeaveCalendar =
    process.env.NEXT_PUBLIC_HCM_TEAM_LEAVE_CALENDAR_ENABLED === "true" &&
    (process.env.NEXT_PUBLIC_HCM_TEAM_LEAVE_CALENDAR_ORG_IDS ?? "").split(",")
      .some((id) => id.trim() === String(organizationId));

  function applySearch() {
    setRefreshCount((value) => value + 1);
    setSearchQuery(searchDraft.trim());
    setCursors([0]);
  }

  function clearFilters() {
    setRefreshCount((value) => value + 1);
    setSearchDraft("");
    setSearchQuery("");
    setStatusFilter("all");
    setCursors([0]);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-14 pt-7 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href={"/app?organizationId=" + organizationId} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-emerald-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
          <ArrowLeft aria-hidden="true" size={16} /> Back to workspace
        </Link>

        <header className="relative mt-5 overflow-hidden rounded-2xl bg-slate-900 px-6 py-8 text-white sm:px-9 sm:py-10">
          <div className="absolute -right-20 -top-20 size-64 rounded-full border-[38px] border-emerald-700/20" aria-hidden="true" />
          <div className="relative">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
              Linaw HCM / People
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-5">
              <div>
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">My Team</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                  Your people and pending workflow records, in one place.
                  All approvals and HR updates stay in their existing governed workspaces.
                </p>
              </div>
              <button type="button"
                onClick={() => setRefreshCount((value) => value + 1)}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300">
                <RefreshCcw aria-hidden="true" size={16} /> Refresh
              </button>
            </div>
          </div>
        </header>

        {canOpenLeaveCalendar && data && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">Team Leave Calendar</p>
              <p className="mt-1 text-xs text-slate-700">
                Review approved and pending leave request date spans, not confirmed absences or shift coverage.
              </p>
            </div>
            <Link
              href={`/hcm/team-leave-calendar?organizationId=${organizationId}`}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900"
            >
              <CalendarClock size={16} aria-hidden="true" /> Open leave calendar
            </Link>
          </div>
        )}

        <section aria-label="Scope information" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-emerald-50 p-2 text-emerald-800"><ShieldCheck aria-hidden="true" size={18} /></span>
            <div>
              <p className="text-sm font-semibold">Authorized people view</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                Employer #{organizationId} · {data?.scope.kind === "unit" ? "Assigned organizational unit" :
                  data?.scope.kind === "company" ? "Company-wide HR view" : "Verifying authorized scope"}
                · Salary, identity numbers, bank information and leave reasons are excluded.
              </p>
            </div>
          </div>
          {data && <p className="text-xs text-slate-500">Source read {observedInManila(data.observedAt)}</p>}
        </section>

        {(!active || active.status === "loading") && (
          <p role="status" aria-live="polite" className="mt-6 rounded-xl border border-slate-200 bg-white p-6 text-slate-600">
            Loading authorized team records…
          </p>
        )}
        {active?.status === "unavailable" && (
          <section role="alert" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
            <h2 className="font-semibold">{active.failure === "forbidden" ? "Team access denied" :
              active.failure === "sign_in" ? "Sign in required" : "Team records unavailable"}</h2>
            <p className="mt-1 text-sm">{scopedReadFailureMessage(active.failure ?? "server")}</p>
            <p className="mt-2 text-xs">Previously loaded records have been cleared. No missing information is treated as an approved or completed action.</p>
            <button type="button" onClick={() => setRefreshCount((value) => value + 1)}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg border border-amber-500 bg-white px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700">
              <RefreshCcw aria-hidden="true" size={16} /> Try again
            </button>
          </section>
        )}

        {data && (
          <>
            <section aria-label="Current page summary" className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {[
                {
                  label: "Employee records / this page",
                  value: data.summary.employeeRecordsThisPage,
                  hint: "Current authorized source snapshot",
                  Icon: UsersRound,
                },
                {
                  label: "Pending leave records / this page",
                  value: data.summary.pendingLeaveRecordsThisPage,
                  hint: "Request count, not assigned approvals",
                  Icon: CalendarClock,
                },
                {
                  label: "Pending overtime records / this page",
                  value: data.summary.pendingOvertimeRecordsThisPage,
                  hint: "Request count, not payroll hours",
                  Icon: ClipboardCheck,
                },
                {
                  label: "Pending attendance corrections / this page",
                  value: data.summary.pendingAttendanceCorrectionsThisPage,
                  hint: "Requests awaiting a source decision",
                  Icon: FileWarning,
                },
                {
                  label: "Incomplete punch records / this page",
                  value: data.summary.incompletePunchRecordsThisPage,
                  hint: "May include ongoing shifts",
                  Icon: Clock3,
                },
              ].map((metric) => (
                <article key={metric.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-slate-600">{metric.label}</p>
                    <metric.Icon size={17} aria-hidden="true" className="text-emerald-700" />
                  </div>
                  <p className="mt-3 text-3xl font-bold tabular-nums">{metric.value}</p>
                  <p className="mt-2 text-xs text-slate-500">{metric.hint}</p>
                </article>
              ))}
            </section>
            <HcmMyTeamActionCenter organizationId={organizationId} summary={data.summary}
              pilotFocusEnabled={pilotFocusEnabled} />
          </>
        )}

        <section aria-labelledby="hcm-team-list-heading" className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="hcm-team-list-heading" className="text-xl font-bold">People directory</h2>
              <p className="mt-1 text-sm text-slate-600">
                Search within your authorized scope. Filters apply before database pagination.
              </p>
            </div>
            <button type="button" onClick={clearFilters}
              className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
              Clear filters
            </button>
          </div>
          <form className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.35fr)_auto]"
            onSubmit={(event) => { event.preventDefault(); applySearch(); }}>
            <div>
              <label htmlFor="hcm-team-search" className="block text-xs font-semibold text-slate-700">
                Employee number, name or job title
              </label>
              <input id="hcm-team-search" type="search" maxLength={70}
                value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Search current employee records"
                className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
              />
            </div>
            <div>
              <label htmlFor="hcm-team-status" className="block text-xs font-semibold text-slate-700">Employment status</label>
              <select id="hcm-team-status" value={statusFilter}
                onChange={(event) => {
                  setRefreshCount((value) => value + 1);
                  setStatusFilter(event.target.value as MyTeamStatusFilter);
                  setCursors([0]);
                }}
                className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
                {MY_TEAM_STATUSES.map((status) => (
                  <option key={status} value={status}>{status === "all" ? "All statuses" : status}</option>
                ))}
              </select>
            </div>
            <button type="submit"
              className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-800 px-5 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 sm:mt-5">
              <Search aria-hidden="true" size={16} /> Search
            </button>
          </form>

          {data && (
            <>
              {data.items.length === 0 && (
                <p className="mt-5 rounded-lg bg-slate-50 p-6 text-sm text-slate-600">
                  No employee records match this page and query. This does not establish that the employer
                  or reporting unit has no personnel.
                </p>
              )}

              <ul aria-label="Authorized employee records" className="mt-5 divide-y divide-slate-100">
                {data.items.map((member) => (
                  <li key={member.id} className="py-4 first:pt-0">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex min-w-0 items-start gap-3">
                        <div aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 font-bold text-emerald-800">
                          {member.name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("")}
                        </div>
                        <div className="min-w-0 max-w-full break-words">
                          <h3 className="break-words font-semibold text-slate-900">{member.name}</h3>
                          <p className="mt-1 text-sm text-slate-700">
                            {member.jobTitle} <span className="text-slate-400">·</span> {member.employmentType}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Employee #{member.employeeNo} <span className="text-slate-400">·</span>{" "}
                            {member.orgUnitIntegrity === "verified"
                              ? member.orgUnitName
                              : member.orgUnitIntegrity === "not_recorded"
                                ? "Org unit not recorded"
                                : "Org unit requires source review"}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={"rounded-full border px-3 py-1 text-xs font-semibold " +
                          (STATUS_TONE[member.status] ?? "border-slate-200 bg-slate-50 text-slate-700")}>
                          {member.status}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 pl-0 sm:pl-14">
                      <span className="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
                        <CalendarClock size={14} aria-hidden="true" /> Pending leave: {member.pendingLeaveRecords}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
                        <ClipboardCheck size={14} aria-hidden="true" /> Pending overtime: {member.pendingOvertimeRecords}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
                        <FileWarning size={14} aria-hidden="true" /> Pending attendance corrections: {member.pendingAttendanceCorrections}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
                        <Clock3 size={14} aria-hidden="true" /> Incomplete punches: {member.incompletePunchRecords}
                      </span>
                      {member.pendingLeaveRecords === 0 && member.pendingOvertimeRecords === 0 &&
                        member.pendingAttendanceCorrections === 0 && member.incompletePunchRecords === 0 && (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900">
                          <CheckCircle2 size={14} aria-hidden="true" /> No pending leave, overtime, correction or incomplete-punch records returned
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              <nav aria-label="Team directory pages" className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
                <button type="button" disabled={!hasPrevious}
                  onClick={() => { setCursors((history) => history.length > 1 ? history.slice(0, -1) : history); setRefreshCount((value) => value + 1); }}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">
                  <ArrowLeft aria-hidden="true" size={16} /> Newer
                </button>
                <p className="text-xs text-slate-500">Page {cursors.length} · {data.page.size} records per page maximum</p>
                <button type="button"
                  disabled={!data.page.hasMore || data.page.nextCursor === null}
                  onClick={() => {
                    if (data.page.nextCursor !== null) { setCursors((history) => [...history, data.page.nextCursor!]); setRefreshCount((value) => value + 1); }
                  }}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">
                  Older <ArrowRight aria-hidden="true" size={16} />
                </button>
              </nav>
            </>
          )}
        </section>

        <section aria-label="Source workflow instructions" className="mt-6 grid gap-4 md:grid-cols-2">
          <article className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 text-emerald-800">
              <CalendarClock size={18} aria-hidden="true" />
              <h2 className="font-semibold text-slate-900">Leave and attendance</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Review requests through the existing Leave or Approvals workspace.
              A pending record here does not mean you are its designated approver.
            </p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 text-emerald-800">
              <Building2 size={18} aria-hidden="true" />
              <h2 className="font-semibold text-slate-900">Positions and staffing</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              This is a current roster view, not a confirmed headcount plan, vacancy count or
              historical manager snapshot. Position changes stay in governed HR workflows.
            </p>
          </article>
        </section>
        {data && <p className="mt-5 text-xs leading-5 text-slate-500">{data.warning}</p>}
      </div>
    </main>
  );
}
