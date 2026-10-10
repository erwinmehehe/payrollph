"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, CalendarDays, Clock3, Info, LockKeyhole,
  RefreshCcw, ShieldCheck, UsersRound,
} from "lucide-react";
import {
  activeLeaveRequestSpans, monthShift, teamLeaveMonthCells,
  teamLeaveMonthWindow, TEAM_LEAVE_MONTHS_AHEAD,
  type TeamLeaveCase, type TeamLeaveMonthResponse,
} from "@/lib/hcm-team-leave-calendar-contract";

type LoadState = {
  requestKey: string;
  status: "loading" | "ready" | "unavailable";
  payload: TeamLeaveMonthResponse | null;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", month: "long", year: "numeric",
  }).format(new Date(month + "-01T12:00:00+08:00"));
}
function dayLabel(date: string) {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", weekday: "long", month: "long", day: "numeric", year: "numeric",
  }).format(new Date(date + "T12:00:00+08:00"));
}
function snapshotLabel(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short",
  }).format(date) + " (PH)" : "Snapshot unavailable";
}

function LeaveStatusChip({ status }: { status: TeamLeaveCase["status"] }) {
  return (
    <span className={"inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold " +
      (status === "Approved"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-amber-200 bg-amber-50 text-amber-900")}>
      {status === "Approved" ? "Approved request" : "Pending request"}
    </span>
  );
}

/** A source request span is NOT interpreted as a full-day employee absence. */
export function HcmTeamLeaveCalendar({
  organizationId, initialMonth,
}: {
  organizationId: number;
  initialMonth: string;
}) {
  const [month, setMonth] = useState(initialMonth);
  const [selectedDate, setSelectedDate] = useState(initialMonth + "-01");
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<LoadState | null>(null);
  const requestKey = [organizationId, month, revision].join(":");

  useEffect(() => {
    const controller = new AbortController();
    setLoaded({ requestKey, status: "loading", payload: null });

    const params = new URLSearchParams({
      organizationId: String(organizationId),
      month,
    });
    void fetch("/api/hcm/team-leave-calendar?" + params.toString(), {
      cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("The team leave source is unavailable.");
      const result = await response.json() as TeamLeaveMonthResponse;
      if (controller.signal.aborted) return;
      const expectedDates = teamLeaveMonthWindow(month);
      if (result.organizationId !== organizationId || result.month !== month ||
          result.dates?.start !== expectedDates.start ||
          result.dates?.end !== expectedDates.end ||
          !["company", "unit"].includes(result.scope?.kind) ||
          !Array.isArray(result.cases) || result.cases.length > 400 ||
          result.cases.some((entry) =>
            !Number.isSafeInteger(entry.requestId) || entry.requestId < 1 ||
            !Number.isSafeInteger(entry.employeeId) || entry.employeeId < 1 ||
            !["Approved", "Pending"].includes(entry.status) ||
            entry.startDate > entry.endDate ||
            entry.startDate > expectedDates.end ||
            entry.endDate < expectedDates.start)) {
        throw new Error("The leave response did not match the selected employer or month.");
      }
      setLoaded({ requestKey, status: "ready", payload: result });
    }).catch(() => {
      if (!controller.signal.aborted) {
        setLoaded({ requestKey, status: "unavailable", payload: null });
      }
    });
    return () => controller.abort();
  }, [requestKey, organizationId, month]);

  const active = loaded?.requestKey === requestKey ? loaded : null;
  const page = active?.status === "ready" ? active.payload : null;
  const dates = useMemo(() => teamLeaveMonthCells(month), [month]);
  const spansByDate = useMemo(() => {
    const entries = new Map<string, TeamLeaveCase[]>();
    if (page) {
      for (const date of dates) {
        if (date) entries.set(date, activeLeaveRequestSpans(date, page.cases));
      }
    }
    return entries;
  }, [page, dates]);
  const selectedCases = spansByDate.get(selectedDate) ?? [];
  const approvedToday = selectedCases.filter((item) => item.status === "Approved").length;
  const pendingToday = selectedCases.filter((item) => item.status === "Pending").length;

  function chooseMonth(next: string) {
    setMonth(next);
    setSelectedDate(next + "-01");
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-16 pt-6 text-slate-900 sm:px-7">
      <div className="mx-auto max-w-6xl">
        <Link href="/app"
          className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-emerald-800 hover:underline">
          <ArrowLeft size={16} aria-hidden="true" /> Back to workspace
        </Link>

        <header className="relative mt-5 overflow-hidden rounded-2xl bg-slate-900 px-6 py-8 text-white sm:px-9 sm:py-10">
          <div aria-hidden="true" className="absolute -right-16 -top-28 size-64 rounded-full border-[40px] border-emerald-400/10"/>
          <div className="relative flex flex-wrap items-end justify-between gap-5">
            <div className="max-w-2xl">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
                <CalendarDays size={16} aria-hidden="true"/> Linaw HCM / Manager workspace
              </p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                Team Leave Calendar
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                A single view of approved and pending leave request spans for
                your current team. Reason and leave-type details stay private.
              </p>
            </div>
            <button type="button" onClick={() => setRevision((number) => number + 1)}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20">
              <RefreshCcw size={16} aria-hidden="true"/> Refresh
            </button>
          </div>
        </header>

        <section aria-label="Leave calendar privacy and scope"
          className="mt-5 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-emerald-50 p-2 text-emerald-800"><ShieldCheck size={17} aria-hidden="true"/></div>
            <div>
              <p className="text-sm font-semibold">Read-only, source-linked team visibility</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                Employer #{organizationId} · {page?.scope.kind === "unit"
                  ? "Exact assigned unit"
                  : page?.scope.kind === "company" ? "Authorized company-wide view"
                  : "Checking authorized scope"}.
                No payroll, reasons, leave policy or approval decisions are shown.
              </p>
            </div>
          </div>
          {page && <p className="text-xs text-slate-500">Source snapshot {snapshotLabel(page.observedAt)}</p>}
        </section>

        <section aria-labelledby="team-leave-month" className="mt-6 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                Monthly planning · Philippines
              </p>
              <h2 id="team-leave-month" className="mt-1 text-2xl font-bold">{monthLabel(month)}</h2>
              <p className="mt-1 text-xs text-slate-600">
                Current and next {TEAM_LEAVE_MONTHS_AHEAD} months only
              </p>
            </div>
            <nav aria-label="Choose leave calendar month" className="flex items-center gap-2">
              <button type="button" aria-label="Previous month" disabled={month <= initialMonth}
                onClick={() => chooseMonth(monthShift(month, -1))}
                className="inline-flex size-11 items-center justify-center rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                <ArrowLeft size={18} aria-hidden="true"/>
              </button>
              <button type="button" disabled={month === initialMonth}
                onClick={() => chooseMonth(initialMonth)}
                className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-emerald-800 disabled:opacity-50">
                Current month
              </button>
              <button type="button" aria-label="Next month"
                disabled={month >= monthShift(initialMonth, TEAM_LEAVE_MONTHS_AHEAD)}
                onClick={() => chooseMonth(monthShift(month, 1))}
                className="inline-flex size-11 items-center justify-center rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                <ArrowRight size={18} aria-hidden="true"/>
              </button>
            </nav>
          </div>

          {(!active || active.status === "loading") && (
            <div role="status" aria-live="polite" className="mt-5 rounded-xl bg-slate-50 p-8 text-sm text-slate-600">
              Loading current employer leave records and verifying your team scope…
            </div>
          )}
          {active?.status === "unavailable" && (
            <div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-950">
              Leave records are unavailable, your scope changed, or the supported month size was exceeded.
              Previously loaded records were cleared. No missing results are treated as staff availability.
            </div>
          )}

          {page && (
            <>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-emerald-800">
                    <UsersRound size={16} aria-hidden="true"/>
                    <p className="text-xs font-semibold text-slate-600">Approved request records</p>
                  </div>
                  <p className="mt-2 text-3xl font-bold tabular-nums">{page.summary.approvedRequestRecords}</p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-amber-800">
                    <Clock3 size={16} aria-hidden="true"/>
                    <p className="text-xs font-semibold text-slate-600">Pending request records</p>
                  </div>
                  <p className="mt-2 text-3xl font-bold tabular-nums">{page.summary.pendingRequestRecords}</p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-slate-700">
                    <LockKeyhole size={16} aria-hidden="true"/>
                    <p className="text-xs font-semibold text-slate-600">Source visibility</p>
                  </div>
                  <p className="mt-3 text-sm font-bold">{page.scope.kind === "unit" ? "My assigned unit" : "Company-wide HR"}</p>
                  <p className="mt-1 text-xs text-slate-500">No absence-hour projections</p>
                </article>
              </div>

              <div aria-label="Leave status legend" className="mt-5 flex flex-wrap gap-3 text-xs text-slate-700">
                <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-full bg-emerald-700"/> Approved request span</span>
                <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-full bg-amber-500"/> Pending request span</span>
              </div>

              <div className="mt-4 grid grid-cols-7 gap-1.5" aria-label="Month days">
                {WEEKDAYS.map((weekday) => (
                  <div key={weekday} className="py-2 text-center text-xs font-bold text-slate-500">
                    {weekday}
                  </div>
                ))}
                {dates.map((date, index) => {
                  if (!date) return <div key={"empty-" + index} aria-hidden="true" className="min-h-20 rounded-lg bg-slate-50/60 sm:min-h-24"/>;
                  const cases = spansByDate.get(date) ?? [];
                  const approved = cases.filter((entry) => entry.status === "Approved").length;
                  const pending = cases.length - approved;
                  const selected = selectedDate === date;
                  return (
                    <button key={date} type="button"
                      aria-pressed={selected}
                      aria-label={dayLabel(date) + ": " + approved + " approved and " + pending + " pending request spans"}
                      onClick={() => setSelectedDate(date)}
                      className={"min-h-20 rounded-lg border p-1.5 text-left transition-colors sm:min-h-24 sm:p-2.5 " +
                        (selected
                          ? "border-emerald-700 bg-emerald-50 ring-2 ring-emerald-700/30"
                          : "border-slate-200 bg-white hover:border-emerald-400 hover:bg-slate-50")}>
                      <span className={"flex size-7 items-center justify-center rounded-full text-xs font-bold " +
                        (selected ? "bg-emerald-800 text-white" : "text-slate-800")}>
                        {Number(date.slice(-2))}
                      </span>
                      <span className="mt-2 flex flex-wrap gap-1" aria-hidden="true">
                        {approved > 0 && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-900">
                          {approved} <span className="hidden sm:inline">approved</span>
                        </span>}
                        {pending > 0 && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                          {pending} <span className="hidden sm:inline">pending</span>
                        </span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </section>

        {page && (
          <section aria-labelledby="team-leave-selected-day"
            className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                  Selected date · Read-only request spans
                </p>
                <h2 id="team-leave-selected-day" className="mt-1 text-xl font-bold">
                  {dayLabel(selectedDate)}
                </h2>
              </div>
              <p className="text-xs text-slate-600">
                {approvedToday} approved · {pendingToday} pending request records
              </p>
            </div>

            {selectedCases.length === 0 ? (
              <p className="mt-4 rounded-xl bg-slate-50 p-5 text-sm text-slate-600">
                No approved or pending source request spans overlap this date.
                This does not certify full staffing or shift availability.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-100" aria-label="Request spans overlapping selected date">
                {selectedCases.map((entry) => (
                  <li key={entry.requestId} className="flex flex-wrap items-center justify-between gap-4 py-3.5">
                    <div>
                      <p className="font-semibold text-slate-900">{entry.employeeName}</p>
                      <p className="mt-1 text-xs text-slate-600">
                        Employee #{entry.employeeNo} · Request #{entry.requestId}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        Recorded request span: {entry.startDate} to {entry.endDate}
                      </p>
                    </div>
                    <LeaveStatusChip status={entry.status}/>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-5 flex items-start gap-2 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-600">
              <Info size={15} aria-hidden="true" className="mt-0.5 shrink-0"/>
              These dates indicate source leave request spans, not necessarily all-day absence.
              Half-day/timed leave intervals, approvals, staffing capacity and actual
              work schedules remain in their governing systems. {page.notice}
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
