"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ClipboardList, RefreshCw } from "lucide-react";
import type {
  PeopleOpsCategory,
  PeopleOpsPayload,
  PeopleOpsPriority,
  PeopleOpsPage,
} from "@/lib/hcm-people-operations-inbox";

const CATEGORIES: Array<{ value: PeopleOpsCategory | "all"; label: string }> = [
  { value: "all", label: "All workflows" },
  { value: "employment", label: "Employment terms" },
  { value: "onboarding", label: "Onboarding" },
  { value: "position", label: "Positions" },
  { value: "performance", label: "Performance" },
  { value: "separation", label: "Separation" },
];

const PRIORITIES: Array<{ value: PeopleOpsPriority | "all"; label: string }> = [
  { value: "all", label: "All priorities" },
  { value: "review", label: "Needs review" },
  { value: "follow_up", label: "Follow up" },
  { value: "source_check", label: "Source check" },
];

function priorityLabel(priority: PeopleOpsPriority) {
  if (priority === "review") return "Needs review";
  if (priority === "follow_up") return "Follow up";
  return "Source check";
}

function dueLabel(daysUntil: number | null, dueDate: string | null) {
  if (!dueDate) return "—";
  if (daysUntil == null) return dueDate;
  if (daysUntil < 0) return dueDate + " · " + Math.abs(daysUntil) + " days overdue";
  if (daysUntil === 0) return dueDate + " · due today";
  return dueDate + " · in " + daysUntil + " days";
}

/**
 * Company-wide triage only. The server enforces People-admin permission
 * overlays and companyWide scope before returning any employee identifiers.
 */
export function HcmPeopleOperationsInbox({
  organizationId,
  onOpenWorker,
  onPage,
}: {
  organizationId: number;
  onOpenWorker: (employeeId: number) => boolean;
  onPage: (page: PeopleOpsPage) => void;
}) {
  const [filters, setFilters] = useState<{
    priority: PeopleOpsPriority | "all";
    category: PeopleOpsCategory | "all";
    query: string;
    page: number;
  }>({ priority: "all", category: "all", query: "", page: 1 });
  const [draftQuery, setDraftQuery] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [response, setResponse] = useState<{ organizationId: number; data: PeopleOpsPayload } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      organizationId: String(organizationId),
      page: String(filters.page),
      pageSize: "20",
      priority: filters.priority,
      category: filters.category,
    });
    if (filters.query) params.set("q", filters.query);

    setLoading(true);
    setResponse(null);
    setError("");

    void (async () => {
      try {
        const result = await fetch("/api/hcm/people-operations-inbox?" + params.toString(), {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await result.json().catch(() => ({}));
        if (!result.ok) throw new Error(body.error ?? "The People Operations Inbox could not be loaded.");
        if (controller.signal.aborted) return;
        setResponse({ organizationId, data: body as PeopleOpsPayload });
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Could not load the HR worklist.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [organizationId, filters.page, filters.category, filters.priority, filters.query, refreshVersion]);

  const data = response?.organizationId === organizationId ? response.data : null;

  return (
    <section className="card" aria-label="People Operations Inbox" style={{ marginBottom: 18 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">HCM · COMPANY-WIDE PEOPLE OPERATIONS</div>
          <h2>People Operations Inbox</h2>
          <p>Review source-linked HR follow-ups across employment terms, onboarding,
            positions, performance and separation. Existing approval workflows remain authoritative.</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={loading}
          onClick={() => setRefreshVersion((value) => value + 1)}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && (
        <div className="notice notice-amber" role="alert">
          <AlertTriangle size={15} /><span>{error}</span>
        </div>
      )}

      {data && (
        <>
          <div className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", marginBottom: 14 }}>
            <article className="stat-card">
              <div className="stat-icon blue"><ClipboardList size={18} /></div>
              <p>OPEN FOLLOW-UPS</p>
              <h3>{data.summary.total}</h3>
              <span>Across {data.summary.employeesAffected} workers</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon orange"><AlertTriangle size={18} /></div>
              <p>NEEDS REVIEW</p>
              <h3>{data.summary.review}</h3>
              <span>Review source evidence first</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon purple"><ClipboardList size={18} /></div>
              <p>FOLLOW UP</p>
              <h3>{data.summary.followUp}</h3>
              <span>Existing tasks or approvals</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon blue"><ClipboardList size={18} /></div>
              <p>SOURCE CHECKS</p>
              <h3>{data.summary.sourceCheck}</h3>
              <span>Optional historical verification</span>
            </article>
          </div>
        </>
      )}

      <form
        className="run-actions"
        style={{ marginBottom: 12, flexWrap: "wrap", alignItems: "end" }}
        onSubmit={(event) => {
          event.preventDefault();
          setFilters((current) => ({ ...current, query: draftQuery.trim().slice(0, 80), page: 1 }));
        }}
      >
        <label style={{ display: "grid", gap: 3 }}>
          <small>Workflow</small>
          <select
            aria-label="Filter People Operations by workflow"
            value={filters.category}
            onChange={(event) => setFilters((current) => ({
              ...current,
              category: event.target.value as PeopleOpsCategory | "all", page: 1,
            }))}
          >
            {CATEGORIES.map((category) => <option value={category.value} key={category.value}>{category.label}</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 3 }}>
          <small>Priority</small>
          <select
            aria-label="Filter People Operations by priority"
            value={filters.priority}
            onChange={(event) => setFilters((current) => ({
              ...current,
              priority: event.target.value as PeopleOpsPriority | "all", page: 1,
            }))}
          >
            {PRIORITIES.map((priority) => <option value={priority.value} key={priority.value}>{priority.label}</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 3, minWidth: 180 }}>
          <small>Employee name or number</small>
          <input
            aria-label="Search employees in People Operations Inbox"
            value={draftQuery}
            maxLength={80}
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder="Search this organization"
          />
        </label>
        <button type="submit" className="secondary-button">Apply search</button>
      </form>

      {loading && <div className="empty-state" role="status">Loading tenant-scoped HR follow-ups…</div>}

      {!loading && data && (
        <>
          <p style={{ fontSize: 12, marginBottom: 10 }}>
            Showing {data.rows.length} of {data.filteredTotal} matching items.
            Sorted by priority, then due date. Reference date: {data.today}.
          </p>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>EMPLOYEE</th>
                  <th>WORKFLOW</th>
                  <th>NEXT REVIEW</th>
                  <th>PRIORITY / DUE</th>
                  <th>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr><td colSpan={5}>
                    <div className="empty-state">
                      No source-linked follow-ups match these filters.
                      This is not evidence that every HR requirement is complete.
                    </div>
                  </td></tr>
                )}
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.employeeName}</strong>
                      <small style={{ display: "block", color: "var(--muted)" }}>{row.employeeNo}</small>
                    </td>
                    <td style={{ textTransform: "capitalize" }}>{row.category.replaceAll("_", " ")}</td>
                    <td>
                      <strong>{row.title}</strong>
                      <small style={{ display: "block", color: "var(--muted)", maxWidth: 440 }}>{row.detail}</small>
                      <small style={{ display: "block", color: "var(--muted)" }}>
                        Responsible: {row.responsibleTeam}
                      </small>
                    </td>
                    <td>
                      <strong>{priorityLabel(row.priority)}</strong>
                      <small style={{ display: "block", color: "var(--muted)" }}>
                        {dueLabel(row.daysUntil, row.dueDate)}
                      </small>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          if (row.page === "People") {
                            if (!onOpenWorker(row.employeeId)) onPage("People");
                          } else {
                            onPage(row.page);
                          }
                        }}
                      >
                        {row.page === "People" ? "View worker" : "Open " + row.page}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.pages > 1 && (
            <div className="run-actions" style={{ marginTop: 12, justifyContent: "flex-end" }}>
              <button
                type="button" className="secondary-button"
                disabled={data.page <= 1 || loading}
                onClick={() => setFilters((current) => ({ ...current, page: Math.max(1, data.page - 1) }))}
              >Previous</button>
              <span style={{ alignSelf: "center" }}>Page {data.page} of {data.pages}</span>
              <button
                type="button" className="secondary-button"
                disabled={data.page >= data.pages || loading}
                onClick={() => setFilters((current) => ({ ...current, page: data.page + 1 }))}
              >Next</button>
            </div>
          )}
          <div className="modal-note" style={{ marginTop: 12 }}>{data.disclaimer}</div>
        </>
      )}
    </section>
  );
}
