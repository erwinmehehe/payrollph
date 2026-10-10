"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { TeamAttendanceDay } from "@/lib/hcm-team-attendance-preview";
type Payload = {
  organizationId: number; workDate: string; observedAt: string;
  rows: TeamAttendanceDay[];
  summary: { employeeDaysOnPage: number; scheduledSegmentsOnPage: number; recordedPunchesOnPage: number; reviewRowsOnPage: number };
  page: { size: number; hasMore: boolean; nextCursor: number | null };
  warning: string;
};
export function HcmTeamAttendancePreviewClient({ organizationId }: { organizationId: number }) {
  const [cursors, setCursors] = useState<number[]>([0]);
  const [refresh, setRefresh] = useState(0);
  const [stored, setStored] = useState<{ key: string; data: Payload | null; error: boolean } | null>(null);
  const cursor = cursors[cursors.length - 1] ?? 0;
  const key = JSON.stringify([organizationId, cursor, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/hcm/team-attendance-preview?" + new URLSearchParams({
      organizationId: String(organizationId), cursor: String(cursor),
    }), { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Preview unavailable");
        const data = await response.json() as Payload;
        if (data.organizationId !== organizationId || data.page?.size !== 10 ||
          !Array.isArray(data.rows) || data.rows.length > 10 ||
          data.rows.some(row => !Number.isSafeInteger(row.employeeId) || row.employeeId <= cursor) ||
          (data.page.hasMore && (!Number.isSafeInteger(data.page.nextCursor) || data.page.nextCursor! <= cursor))) {
          throw new Error("Untrusted preview scope");
        }
        if (!controller.signal.aborted) setStored({ key, data, error: false });
      }).catch(() => {
        if (!controller.signal.aborted) setStored({ key, data: null, error: true });
      });
    return () => controller.abort();
  }, [organizationId, cursor, key]);
  const active = stored?.key === key ? stored : null;
  const data = active?.data;
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
    <div className="mx-auto max-w-5xl">
      <Link href="/app" className="text-emerald-700 underline">Back to workspace</Link>
      <h1 className="mt-6 text-3xl font-bold">Manager Team Attendance &amp; Shift Coverage Preview</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">Today's scheduled shift segments compared with recorded punch evidence. This is not confirmed coverage or employee absence.</p>
      <div className="mt-4 flex items-center gap-4">
        <button type="button" className="rounded bg-emerald-800 px-4 py-2 text-white" onClick={() => setRefresh(n => n + 1)}>Refresh evidence</button>
        <span className="text-sm">Employer #{organizationId}</span>
      </div>
      {!active && <p role="status" className="mt-6">Loading evidence...</p>}
      {active?.error && <p role="alert" className="mt-6">Evidence unavailable. No staffing or attendance conclusion can be drawn.</p>}
      {data && <>
        <p className="mt-6 text-sm text-slate-600">PH work date: {data.workDate}. This page: {data.summary.employeeDaysOnPage} employees, {data.summary.scheduledSegmentsOnPage} scheduled segments, {data.summary.recordedPunchesOnPage} punch records, {data.summary.reviewRowsOnPage} evidence review rows.</p>
        <div className="mt-4 overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100"><tr><th scope="col" className="p-3">Worker</th><th scope="col" className="p-3">Scheduled shifts</th><th scope="col" className="p-3">Punch records</th><th scope="col" className="p-3">Review</th></tr></thead>
            <tbody>{data.rows.map(row => <tr key={row.employeeId} className="border-t">
              <td className="p-3">{row.name}</td><td className="p-3">{row.scheduledSegments} {row.overnightSegments ? "(includes overnight)" : ""}</td>
              <td className="p-3">{row.punchRecords}</td>
              <td className="p-3">{row.state === "unassigned" ? "Schedule unassigned" : row.state === "review" ? "Check source records" : row.state === "rest_day" ? "Recorded rest day" : "Scheduled (not verified present)"}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {data.rows.length === 0 && <p className="mt-4">No workers in this authorized page.</p>}
        <p className="mt-4 text-sm text-amber-900">{data.warning}</p>
        <div className="mt-6 flex gap-3">
          <button type="button" className="rounded border px-3 py-2 disabled:opacity-40" disabled={cursors.length === 1} onClick={() => setCursors(p => p.slice(0, -1))}>Previous</button>
          <button type="button" className="rounded border px-3 py-2 disabled:opacity-40" disabled={!data.page.hasMore || data.page.nextCursor === null} onClick={() => { if (data.page.nextCursor !== null) setCursors(p => [...p, data.page.nextCursor!]); }}>Next</button>
        </div>
      </>}
    </div>
  </main>;
}
