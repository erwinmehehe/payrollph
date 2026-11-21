"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCcw } from "lucide-react";
import { PeopleIntelligenceOverview } from "@/components/workspace/people-intelligence";
import { readVerifiedReportPayload, type VerifiedReportPayload } from "@/lib/report-read-payload";
import {
  assertPeopleAnalyticsSnapshot,
  peopleAnalyticsExportQuery,
  peopleAnalyticsReportQuery,
  type PeopleAnalyticsWindow,
} from "@/lib/people-analytics-report-query";

/**
 * A first-class view over the existing verified People Intelligence API.
 * No client-side headcount estimates, new payroll calculations or writes.
 */
export function PeopleAnalyticsDashboard({
  organizationId,
  organizationName,
  today,
}: {
  organizationId: number;
  organizationName: string;
  today: string;
}) {
  const [asOf, setAsOf] = useState("");
  const [windowDays, setWindowDays] = useState<PeopleAnalyticsWindow>(90);
  const [refreshToken, setRefreshToken] = useState(0);
  const [resolved, setResolved] = useState<{ key: string; payload: VerifiedReportPayload } | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const requestKey = JSON.stringify({ organizationId, asOf, windowDays, refreshToken });
  const visible = resolved?.key === requestKey ? resolved.payload : null;
  const error = failed?.key === requestKey ? failed.message : null;

  useEffect(() => {
    let current = true;
    const query = peopleAnalyticsReportQuery(organizationId, windowDays, asOf);
    readVerifiedReportPayload(organizationId, "people", query)
      .then((payload) => {
        if (!current) return;
        if (!payload.peopleIntelligence) throw new Error("People Analytics source snapshot is missing.");
        assertPeopleAnalyticsSnapshot(payload.peopleIntelligence, windowDays, asOf);
        setResolved({ key: requestKey, payload });
        setFailed(null);
      })
      .catch((cause: unknown) => {
        if (!current) return;
        setResolved(null);
        setFailed({
          key: requestKey,
          message: cause instanceof Error ? cause.message : "People Intelligence is unavailable.",
        });
      });
    return () => { current = false; };
  }, [organizationId, windowDays, asOf, requestKey]);

  const summary = visible?.peopleIntelligence;
  const trendMax = useMemo(
    () => Math.max(1, ...(summary?.trends.map((point) => point.headcount ?? 0) ?? [])),
    [summary],
  );
  const csvHref = visible?.peopleIntelligence
    ? `/api/reports?${peopleAnalyticsExportQuery(organizationId, windowDays, asOf, visible.peopleIntelligence).toString()}`
    : null;

  return (
    <main className="mx-auto max-w-7xl px-5 py-9 text-slate-900 sm:px-7">
      <nav aria-label="Back to workspace">
        <Link href={`/app?organizationId=${organizationId}`}
          className="text-sm font-semibold text-emerald-800 hover:underline">
          ← Back to {organizationName} workspace
        </Link>
      </nav>
      <header className="mt-8 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">People operations · {organizationName}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">People Analytics</h1>
          <p className="mt-3 text-base leading-7 text-slate-600">
            Explore verified headcount, hires, completed exits, vacancies and recruitment trends.
            This dashboard reads existing HR and released payroll evidence; it cannot change pay or workforce records.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setRefreshToken((value) => value + 1)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
            <RefreshCcw size={16} aria-hidden /> Refresh
          </button>
          {csvHref && <a href={csvHref}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900">
            <Download size={16} aria-hidden /> Export CSV
          </a>}
        </div>
      </header>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="People Analytics reporting controls">
        <div className="flex flex-wrap items-end gap-5">
          <label className="grid gap-2 text-sm font-semibold text-slate-800">
            Reporting date
            <input type="date" value={asOf} max={today}
              onChange={(event) => setAsOf(event.target.value)}
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
              aria-label="People Analytics reporting date" />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-slate-800">
            Activity window
            <select value={windowDays}
              onChange={(event) => setWindowDays(Number(event.target.value) as PeopleAnalyticsWindow)}
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
              aria-label="People Analytics activity window">
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 180 days</option>
              <option value={365}>Last 365 days</option>
            </select>
          </label>
          {asOf && <button type="button" onClick={() => setAsOf("")}
            className="min-h-11 rounded-lg px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">
            Use today in Manila
          </button>}
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-600">
          Historical employee status is reported only where effective-dated source records support it.
          Current position and requisition statuses cannot be backdated. CSV uses the same reporting scope.
        </p>
      </section>

      {!visible && !error && <div role="status" className="mt-7 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Loading verified People Analytics for the selected company…
      </div>}
      {error && <div role="alert" className="mt-7 rounded-xl border border-red-200 bg-red-50 p-6">
        <p className="font-semibold text-red-900">Report could not be verified</p>
        <p className="mt-1 text-sm text-red-900">{error}</p>
        <button type="button" onClick={() => setRefreshToken((value) => value + 1)}
          className="mt-4 min-h-11 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-900">
          Try again
        </button>
      </div>}
      {visible && summary && <>
        <p role="status" className="my-6 text-xs text-slate-600">
          Source snapshot: {new Date(visible.generatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} Philippine time.
          Coverage is shown with each metric; missing evidence is not treated as zero.
        </p>

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="people-headcount-trend">
          <h2 id="people-headcount-trend" className="text-xl font-bold">Headcount over time</h2>
          <p className="mt-2 text-sm text-slate-600">
            Six reporting points from verified employment history. Incomplete historical records stay uncharted.
          </p>
          <ol className="mt-5 grid gap-4">
            {summary.trends.map((point) => (
              <li key={point.date} className="grid grid-cols-[7rem_1fr_7rem] items-center gap-3 text-sm sm:grid-cols-[9rem_1fr_10rem]">
                <span className="font-medium text-slate-700">{point.date}</span>
                <div className="h-4 overflow-hidden rounded-full bg-slate-100"
                  role="img" aria-label={point.headcount == null
                    ? `${point.date}: headcount not verifiable`
                    : `${point.date}: ${point.headcount} verified employees`}>
                  {point.headcount != null && <div className="h-full rounded-full bg-emerald-700"
                    style={{ width: `${Math.max(0, Math.min(100, (point.headcount / trendMax) * 100))}%` }} />}
                </div>
                <span className="text-right font-semibold tabular-nums text-slate-800">
                  {point.headcount == null ? "Unverified" : point.headcount.toLocaleString("en-PH")}
                </span>
              </li>
            ))}
          </ol>
        </section>
        <PeopleIntelligenceOverview report={summary} />
      </>}
    </main>
  );
}
