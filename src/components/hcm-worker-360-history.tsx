"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardList, RefreshCw } from "lucide-react";
import { isVerifiedWorker360OlderPage } from "@/lib/hcm-worker-360-history-response";
import {
  validWorker360EventCursor,
  type Worker360Event, type Worker360EventCursor, type Worker360EventPreview,
} from "@/lib/hcm-worker-360-projection";

const MAX_DISPLAYED_EVENTS = 125;

function historyDate(value: string) {
  const date = new Date(value + "T12:00:00+08:00");
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric",
  }).format(date);
}

function eventLabel(value: string) {
  return value.replace(/[_:-]+/g, " ").replace(/^./, first => first.toUpperCase());
}

/**
 * Each request stays company/worker/date scoped and never requests notes,
 * salary, identifiers or write privileges. The parent remounts this component
 * when employer, worker, date or refresh revision changes.
 */
export function Worker360History({
  organizationId, employeeId, asOfDate, preview,
}: {
  organizationId: number;
  employeeId: number;
  asOfDate: string;
  preview: Worker360EventPreview;
}) {
  const [older, setOlder] = useState<Worker360Event[]>([]);
  const [cursor, setCursor] = useState<Worker360EventCursor | null>(preview.nextCursor ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const displayed = [...preview.items, ...older];
  const canLoad = cursor !== null && displayed.length < MAX_DISPLAYED_EVENTS;
  const capped = cursor !== null && displayed.length >= MAX_DISPLAYED_EVENTS;

  async function loadOlder() {
    if (!canLoad || !cursor || inFlight.current ||
        !validWorker360EventCursor(cursor, asOfDate)) return;
    inFlight.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setError("");
    setLoading(true);
    try {
      const params = new URLSearchParams({
        organizationId: String(organizationId),
        employeeId: String(employeeId),
        asOfDate,
        beforeDate: cursor.effectiveDate,
        beforeId: String(cursor.id),
      });
      const response = await fetch("/api/hcm/worker-360?" + params.toString(), {
        cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(response.status === 403 || response.status === 404
          ? "This worker or employer is no longer available to this role."
          : response.status === 400
            ? "The history cursor is no longer valid. Refresh Worker 360."
            : "Older source events could not be loaded. Try again.");
      }
      const payload: unknown = await response.json();
      if (controller.signal.aborted) return;
      // Do not append a plausible 200 response unless its complete Worker 360
      // source envelope and its ordered, non-replayed cursor page are verified.
      if (!isVerifiedWorker360OlderPage(
        payload, organizationId, employeeId, asOfDate,
        cursor, displayed.map(event => event.id),
      )) {
        throw new Error("The returned history did not match this employer, worker, date and cursor.");
      }
      const page = payload.employmentEvents.preview;
      setOlder(current => {
        const seen = new Set([...preview.items, ...current].map(item => item.id));
        return [...current, ...page.items.filter(item => !seen.has(item.id))];
      });
      setCursor(page.nextCursor);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Older source events are unavailable.");
      }
    } finally {
      inFlight.current = false;
      if (controllerRef.current === controller) controllerRef.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return (
    <section aria-labelledby="worker360-history" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2 text-emerald-800">
        <ClipboardList size={16} aria-hidden="true" />
        <p className="text-xs font-bold uppercase tracking-wide">Employment event source</p>
      </div>
      <h2 id="worker360-history" className="mt-2 text-xl font-bold">Recorded events</h2>
      <p className="mt-2 text-xs text-slate-500">
        Source: worker_employment_events · Effective on or before {historyDate(asOfDate)}
      </p>
      {displayed.length === 0 && (
        <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
          No events were returned by this source preview. Legacy or unlinked events may exist elsewhere.
        </p>
      )}
      {displayed.length > 0 && (
        <ol className="mt-4 divide-y divide-slate-100">
          {displayed.map(event => (
            <li key={event.id} className="flex items-start justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-semibold">{eventLabel(event.eventType)}</p>
                <p className="mt-1 text-xs text-slate-500">{historyDate(event.effectiveDate)}</p>
                {event.positionAssignmentId && (
                  <p className="mt-1 text-xs text-slate-500">
                    Linked assignment #{event.positionAssignmentId}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-xs text-slate-500">Event #{event.id}</span>
            </li>
          ))}
        </ol>
      )}
      {cursor && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-950">
          {capped
            ? "This source preview stops at 125 events. Older records may exist in the authoritative system."
            : "Older recorded events exist. The history shown here is incomplete."}
        </p>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-amber-900">{error}</p>}
      {canLoad && (
        <button type="button" onClick={() => void loadOlder()} disabled={loading}
          className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-800 px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-60">
          <RefreshCw size={15} aria-hidden="true" />
          {loading ? "Loading older events…" : "Load older events"}
        </button>
      )}
      <p role="status" aria-live="polite" className="mt-3 text-xs text-slate-600">
        {displayed.length} recorded event{displayed.length === 1 ? "" : "s"} shown in this bounded, read-only preview.
        An empty or complete preview is not proof that legacy employment history is exhaustive.
      </p>
    </section>
  );
}
