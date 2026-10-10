"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, FileClock, RefreshCw, Search, ShieldCheck, UserRound } from "lucide-react";
import type {
  DocumentRenewalState, DocumentWatchExpiry, DocumentWatchResponse, DocumentWatchStateFilter,
} from "@/lib/hcm-document-renewal-watch";

type LoadState = {
  key: string;
  status: "loading" | "ready" | "unavailable";
  data: DocumentWatchResponse | null;
};

const STATE_OPTIONS: Array<{ value: DocumentWatchStateFilter; label: string }> = [
  { value: "all", label: "All document alerts" },
  { value: "overdue", label: "Overdue submissions" },
  { value: "expired", label: "Expired" },
  { value: "expiring", label: "Expiring in requirement window" },
  { value: "missing", label: "Missing (not yet overdue)" },
  { value: "submitted", label: "Awaiting verification" },
  { value: "current", label: "Current with recorded expiry" },
  { value: "waived", label: "Waived" },
];
const EXPIRY_OPTIONS: Array<{ value: DocumentWatchExpiry; label: string }> = [
  { value: "all", label: "Any expiry date" },
  { value: "past", label: "Past expiry dates" },
  { value: "next30", label: "Expires in next 30 days" },
  { value: "next60", label: "Expires in next 60 days" },
  { value: "next90", label: "Expires in next 90 days" },
];
const STATE_LABEL: Record<DocumentRenewalState, string> = {
  expired: "Expired",
  expiring: "Expiring",
  overdue: "Overdue",
  missing: "Missing",
  submitted: "Awaiting verification",
  current: "Current",
  waived: "Waived",
};
const STATE_STYLE: Record<DocumentRenewalState, string> = {
  expired: "border-rose-200 bg-rose-50 text-rose-800",
  expiring: "border-amber-200 bg-amber-50 text-amber-900",
  overdue: "border-rose-200 bg-rose-50 text-rose-800",
  missing: "border-slate-200 bg-slate-100 text-slate-700",
  submitted: "border-blue-200 bg-blue-50 text-blue-800",
  current: "border-emerald-200 bg-emerald-50 text-emerald-800",
  waived: "border-slate-200 bg-slate-100 text-slate-700",
};

function phDate(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value + "T12:00:00+08:00");
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", dateStyle: "medium",
  }).format(date);
}

/**
 * Employee navigation is supplied by the owning workspace, which already has
 * the selected tenant's employee roster and opens its existing People drawer.
 * No new direct HR mutation, file-download or approval actions exist here.
 */
export function HcmDocumentRenewalWatch({
  organizationId,
  onOpenEmployee,
}: {
  organizationId: number;
  onOpenEmployee: (employeeId: number) => void;
}) {
  const [draftSearch, setDraftSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<DocumentWatchStateFilter>("all");
  const [expiryFilter, setExpiryFilter] = useState<DocumentWatchExpiry>("all");
  const [cursors, setCursors] = useState<number[]>([0]);
  const [revision, setRevision] = useState(0);
  const [load, setLoad] = useState<LoadState | null>(null);

  const cursor = cursors[cursors.length - 1] ?? 0;
  const requestKey = JSON.stringify([organizationId, searchQuery, stateFilter, expiryFilter, cursor, revision]);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ key: requestKey, status: "loading", data: null });

    const params = new URLSearchParams({
      organizationId: String(organizationId),
      limit: "30",
      cursor: String(cursor),
      state: stateFilter,
      expiry: expiryFilter,
    });
    if (searchQuery) params.set("q", searchQuery);

    void fetch("/api/hcm/document-renewal-watch?" + params.toString(), {
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("Document watch unavailable");
      const data = await response.json() as DocumentWatchResponse;
      if (controller.signal.aborted) return;
      if (data.organizationId !== organizationId ||
          data.filters?.q !== searchQuery ||
          data.filters?.state !== stateFilter ||
          data.filters?.expiry !== expiryFilter ||
          !Array.isArray(data.items) || data.items.length > 30 ||
          typeof data.page?.hasMore !== "boolean" ||
          (data.page.hasMore &&
            (typeof data.page.nextCursor !== "number" ||
             !Number.isSafeInteger(data.page.nextCursor) ||
             data.page.nextCursor <= cursor)) ||
          data.items.some((item) =>
            !Number.isSafeInteger(item.employeeId) || item.employeeId <= 0)) {
        throw new Error("Unexpected employer or filter response");
      }
      setLoad({ key: requestKey, status: "ready", data });
    }).catch(() => {
      if (!controller.signal.aborted) {
        setLoad({ key: requestKey, status: "unavailable", data: null });
      }
    });
    return () => controller.abort();
  }, [requestKey, organizationId, cursor, searchQuery, stateFilter, expiryFilter]);

  const active = load?.key === requestKey ? load : null;
  const data = active?.status === "ready" ? active.data : null;
  const attention = data?.items.filter((item) =>
    ["overdue", "expired", "expiring", "missing"].includes(item.state)).length ?? 0;
  const hasPrevious = cursors.length > 1;

  function clearFilters() {
    setDraftSearch("");
    setSearchQuery("");
    setStateFilter("all");
    setExpiryFilter("all");
    setCursors([0]);
  }

  return (
    <section aria-labelledby="hcm-document-watch-heading" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-800">Linaw HCM · Read-only</p>
          <h2 id="hcm-document-watch-heading" className="mt-1 flex items-center gap-2 text-xl font-bold text-slate-900">
            <FileClock aria-hidden="true" size={21} /> Document Renewal Watch
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Search document requirements and employee records. Review upcoming expiry dates,
            missing submissions, and verification status without modifying any record.
          </p>
        </div>
        <button type="button"
          onClick={() => setRevision((value) => value + 1)}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50">
          <RefreshCw size={15} aria-hidden="true" /> Refresh
        </button>
      </div>

      <form className="mt-5 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          if (draftSearch.trim().length > 80) return;
          setSearchQuery(draftSearch.trim());
          setCursors([0]);
        }}>
        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="document-watch-search">
            Search employee or requirement
          </label>
          <input id="document-watch-search" type="search" maxLength={80} value={draftSearch}
            onChange={(event) => setDraftSearch(event.target.value)}
            placeholder="Employee name, number, document..."
            className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="document-watch-state">Document status</label>
          <select id="document-watch-state" value={stateFilter}
            onChange={(event) => {
              setStateFilter(event.target.value as DocumentWatchStateFilter);
              setCursors([0]);
            }}
            className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900">
            {STATE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="document-watch-expiry">Expiration window</label>
          <select id="document-watch-expiry" value={expiryFilter}
            onChange={(event) => {
              setExpiryFilter(event.target.value as DocumentWatchExpiry);
              setCursors([0]);
            }}
            className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900">
            {EXPIRY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <button type="submit"
          className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white hover:bg-emerald-900 md:mt-5">
          <Search size={16} aria-hidden="true" /> Search
        </button>
      </form>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
        <p>Search and filters apply to the full authorized source before pagination.</p>
        <button type="button" onClick={clearFilters} className="font-semibold text-emerald-800 underline-offset-4 hover:underline">
          Clear filters
        </button>
      </div>

      {(!active || active.status === "loading") && (
        <p role="status" aria-live="polite" className="mt-6 rounded-lg bg-slate-50 p-5 text-sm text-slate-600">
          Loading document renewal records…
        </p>
      )}
      {active?.status === "unavailable" && (
        <div role="alert" className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
          The renewal source or your access is unavailable. Previously displayed records were cleared.
          Try refreshing, or use the authoritative Documents & Policies workspace.
        </div>
      )}

      {data && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-3" aria-label="Current result page summary">
            {[
              { label: "Records on this page", value: data.items.length },
              { label: "Attention items on this page", value: attention },
              { label: "As of (Philippine date)", value: phDate(data.asOf) },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-600">{item.label}</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{item.value}</p>
              </div>
            ))}
          </div>

          {data.items.length === 0 && (
            <p className="mt-5 rounded-lg bg-slate-50 p-5 text-sm text-slate-600">
              No matching document records on this page. This is not proof of completed compliance or a full employer-wide audit.
            </p>
          )}

          <ul aria-label="Document renewal cases" className="mt-5 space-y-3">
            {data.items.map((item) => (
              <li key={item.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-900">{item.employeeName || "Employee name unavailable"}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">Employee #{item.employeeNo} · Source record #{item.id}</p>
                    <p className="mt-2 text-sm font-medium text-slate-800">{item.requirementName}</p>
                    <p className="mt-0.5 text-xs text-slate-600">{item.requirementCode}{item.mandatory ? " · Mandatory" : " · Optional"}</p>
                  </div>
                  <span className={"rounded-full border px-3 py-1 text-xs font-semibold " + STATE_STYLE[item.state]}>
                    {STATE_LABEL[item.state]}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600 sm:grid-cols-3">
                  <p>Submission due: <strong className="font-medium text-slate-800">{phDate(item.dueAt)}</strong></p>
                  <p>Expiration: <strong className="font-medium text-slate-800">{phDate(item.expiresAt)}</strong></p>
                  <p>File: <strong className="font-medium text-slate-800">{item.hasAttachment ? "Reference attached" : "No attachment reference"}</strong></p>
                </div>
                <div className="mt-3 flex justify-end">
                  <button type="button" onClick={() => onOpenEmployee(item.employeeId)}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-50"
                    aria-label={"Open employee record for " + (item.employeeName || item.employeeNo)}>
                    <UserRound aria-hidden="true" size={16} /> View employee
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <nav aria-label="Document renewal results pages" className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <button type="button" disabled={!hasPrevious}
              onClick={() => setCursors((stack) => stack.length > 1 ? stack.slice(0, -1) : stack)}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-40">
              <ArrowLeft aria-hidden="true" size={16} /> Previous
            </button>
            <p className="text-xs text-slate-600">
              Page {cursors.length}. Up to 30 records per page; total matches are not computed.
            </p>
            <button type="button"
              disabled={!data.page.hasMore || data.page.nextCursor === null}
              onClick={() => {
                if (data.page.nextCursor !== null) setCursors((stack) => [...stack, data.page.nextCursor!]);
              }}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-40">
              Next <ArrowRight aria-hidden="true" size={16} />
            </button>
          </nav>

          <p className="mt-5 flex items-start gap-2 text-xs text-slate-500">
            <ShieldCheck size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
            Read-only monitoring. Dates and status come from the source records, and only the existing
            People or Documents workflows can change, verify, upload or waive documents.
          </p>
        </>
      )}
    </section>
  );
}
