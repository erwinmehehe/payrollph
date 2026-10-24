"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, CalendarDays, CheckCheck, ChevronDown, ClipboardList, RefreshCw, Search, ShieldCheck, UsersRound } from "lucide-react";
import {
  hcmReadScopeKey, hcmReadScopeParams, hcmReadScopeValid,
  hcmResponseMatchesReadScope, type HcmReadScope,
} from "@/lib/hcm-client-employer-scope";
import { isVerifiedPeopleOperationsPayload } from "@/lib/hcm-people-operations-response";
import {
  PEOPLE_OPS_TEAMS,
  type PeopleOpsCategory,
  type PeopleOpsPayload,
  type PeopleOpsPriority,
  type PeopleOpsPage,
  type PeopleOpsDueWindow,
  type PeopleOpsTeam,
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

const DUE_WINDOWS: Array<{ value: PeopleOpsDueWindow; label: string }> = [
  { value: "all", label: "Any source date" },
  { value: "overdue", label: "Past due source date" },
  { value: "today", label: "Due today" },
  { value: "next7", label: "Today through next 7 days" },
  { value: "next30", label: "Today through next 30 days" },
  { value: "unscheduled", label: "No linked source date" },
];

function priorityLabel(priority: PeopleOpsPriority) {
  if (priority === "review") return "Needs review";
  if (priority === "follow_up") return "Follow up";
  return "Source check";
}

function dueLabel(daysUntil: number | null, dueDate: string | null) {
  if (!dueDate) return "No source date";
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
  legalEntityId = null,
  multiEntityEnabled = false,
  onOpenWorker,
  onPage,
}: {
  organizationId: number;
  legalEntityId?: number | null;
  multiEntityEnabled?: boolean;
  onOpenWorker: (employeeId: number) => boolean;
  onPage: (page: PeopleOpsPage) => void;
}) {
  const scope = useMemo<HcmReadScope>(() => ({ organizationId, legalEntityId, multiEntityEnabled }),
    [organizationId, legalEntityId, multiEntityEnabled]);
  // A group-wide or missing-employer selection is not an HCM permission.
  // Render no previous worker identifiers and issue no unscoped request.
  if (!hcmReadScopeValid(scope)) return (
    <section className="notice notice-amber" role="status">
      Select one authorized legal employer before loading People Operations.
    </section>
  );
  return <ScopedPeopleOperationsInbox key={hcmReadScopeKey(scope)} scope={scope}
    onOpenWorker={onOpenWorker} onPage={onPage}/>;
}

function ScopedPeopleOperationsInbox({ scope, onOpenWorker, onPage }: {
  scope: HcmReadScope;
  onOpenWorker: (employeeId: number) => boolean;
  onPage: (page: PeopleOpsPage) => void;
}) {
  const [filters, updateFilters] = useState<{
    priority: PeopleOpsPriority | "all";
    category: PeopleOpsCategory | "all";
    dueWindow: PeopleOpsDueWindow;
    team: PeopleOpsTeam | "all";
    query: string;
    page: number;
  }>({ priority: "all", category: "all", dueWindow: "all", team: "all", query: "", page: 1 });
  const [draftQuery, setDraftQuery] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const setFilters: typeof updateFilters = (value) => {
    updateFilters(value);
    setRefreshVersion((version) => version + 1);
  };
  const [response, setResponse] = useState<{ key: string; data: PeopleOpsPayload | null; error: string } | null>(null);
  const requestKey = JSON.stringify([hcmReadScopeKey(scope), filters, refreshVersion]);

  useEffect(() => {
    const controller = new AbortController();
    const params = hcmReadScopeParams(scope);
    if (!params) return;
    params.set("page", String(filters.page));
    params.set("pageSize", "20");
    params.set("priority", filters.priority);
    params.set("category", filters.category);
    params.set("dueWindow", filters.dueWindow);
    params.set("team", filters.team);
    if (filters.query) params.set("q", filters.query);

    void (async () => {
      try {
        const result = await fetch("/api/hcm/people-operations-inbox?" + params.toString(), {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await result.json().catch(() => ({}));
        if (!result.ok) throw new Error(body.error ?? "The People Operations Inbox could not be loaded.");
        if (controller.signal.aborted) return;
        if (!hcmResponseMatchesReadScope(body, scope)) {
          throw new Error("The People Operations Inbox returned an unexpected tenant or legal-employer scope.");
        }
        if (!isVerifiedPeopleOperationsPayload(body, filters.page)) {
          throw new Error("HR follow-up data was incomplete or invalid. Retry to load a verified snapshot.");
        }
        setResponse({ key: requestKey, data: body as PeopleOpsPayload, error: "" });
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setResponse({ key: requestKey, data: null,
          error: loadError instanceof Error ? loadError.message : "Could not load the HR worklist." });
      }
    })();

    return () => controller.abort();
  }, [scope,
    filters.page, filters.category, filters.priority, filters.dueWindow, filters.team, filters.query, requestKey]);

  const active = response?.key === requestKey ? response : null;
  const data = active?.data ?? null;
  const loading = active === null;
  const error = active?.error ?? "";
  const dueTiles: Array<{ label: string; count: number; window: PeopleOpsDueWindow; note: string }> = data ? [
    { label: "Past source date", count: data.attention.overdue, window: "overdue", note: "Review source status before action" },
    { label: "Due today", count: data.attention.dueToday, window: "today", note: "Based on Philippine business date" },
    { label: "Today + next 7", count: data.attention.dueToday + data.attention.dueNext7, window: "next7", note: "Within 7 calendar days" },
    { label: "Today + next 30", count: data.attention.dueToday + data.attention.dueNext7 + data.attention.dueNext30, window: "next30", note: "Within 30 calendar days" },
    { label: "No source date", count: data.attention.undated, window: "unscheduled", note: "Not an SLA breach" },
  ] : [];

  return (
    <section className="people-ops-inbox" aria-label="People Operations Inbox" aria-busy={loading}>
      <div className="people-ops-header">
        <div className="people-ops-heading">
          <span className="people-ops-headingIcon"><ClipboardList size={21} aria-hidden="true" /></span>
          <div>
            <div className="people-ops-eyebrow">PEOPLE OPERATIONS</div>
            <h2>People Operations Inbox</h2>
            <p>A clear view of what needs attention, and where to go next.</p>
          </div>
        </div>
        <button
          type="button"
          className="people-ops-refresh"
          disabled={loading}
          onClick={() => setRefreshVersion((value) => value + 1)}
        >
          <RefreshCw size={14} /> {error ? "Retry inbox" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="notice notice-amber" role="alert">
          <AlertTriangle size={15} /><span>{error}</span>
        </div>
      )}

      {data && (
        <>
          <div className="people-ops-overview">
            {[
              { label: "Open follow-ups", count: data.summary.total, note: "Across " + data.summary.employeesAffected + (data.summary.employeesAffected === 1 ? " worker" : " workers"), tone: "total" },
              { label: "Needs review", count: data.summary.review, note: "Review source evidence first", tone: "review" },
              { label: "Follow up", count: data.summary.followUp, note: "Existing tasks or approvals", tone: "follow_up" },
              { label: "Source checks", count: data.summary.sourceCheck, note: "Historical verification", tone: "source_check" },
            ].map(stat => <div key={stat.tone} className="people-ops-metric" data-tone={stat.tone}>
              <span className="people-ops-metricLabel"><i aria-hidden="true" />{stat.label}</span>
              <strong>{stat.count}</strong><small>{stat.note}</small>
            </div>)}
          </div>
          <div className="people-ops-triage">
            <div className="people-ops-sectionTitle"><CalendarDays size={15} aria-hidden="true" /><h3>HR daily triage</h3><span>Filter by source date</span></div>
            <div className="people-ops-dateFilters">
              {dueTiles.map((tile) => (
                <button
                  key={tile.window}
                  type="button"
                  className="people-ops-dateFilter"
                  aria-pressed={filters.dueWindow === tile.window}
                  aria-label={tile.label + ": " + tile.count + ". Filter the HR inbox."}
                  title={tile.note}
                  onClick={() => setFilters((current) => ({
                    ...current, dueWindow: tile.window, page: 1,
                  }))}
                >
                  <span>{tile.label}</span><strong>{tile.count}</strong>
                </button>
              ))}
            </div>
            <p className="people-ops-dateNote">Source milestones, not assigned SLAs. The 7- and 30-day windows include today and overlap.</p>
            {data.teamLoad.length > 0 && (
              <details className="people-ops-teamLoad">
                <summary><UsersRound size={15} aria-hidden="true" /> Team workload across the organization<ChevronDown size={15} className="people-ops-chevron" aria-hidden="true" /></summary>
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead><tr>
                      <th>RESPONSIBLE SOURCE TEAM</th><th>OPEN</th><th>NEEDS REVIEW</th>
                      <th>PAST SOURCE DATE</th><th>TODAY + NEXT 7 DAYS</th><th>FILTER</th>
                    </tr></thead>
                    <tbody>{data.teamLoad.map((row) => (
                      <tr key={row.team}>
                        <td>{row.team}</td><td>{row.total}</td><td>{row.review}</td>
                        <td>{row.overdue}</td><td>{row.dueWithin7}</td>
                        <td><button type="button" className="secondary-button"
                          onClick={() => setFilters((current) => ({
                            ...current, team: row.team, dueWindow: "all", page: 1,
                          }))}>View team</button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        </>
      )}

      <form
        className="people-ops-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setFilters((current) => ({ ...current, query: draftQuery.trim().slice(0, 80), page: 1 }));
        }}
      >
        <label className="people-ops-filterField">
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
        <label className="people-ops-filterField">
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
        <label className="people-ops-filterField">
          <small>Responsible team</small>
          <select
            aria-label="Filter People Operations by responsible team"
            value={filters.team}
            onChange={(event) => setFilters((current) => ({
              ...current, team: event.target.value as PeopleOpsTeam | "all", page: 1,
            }))}
          >
            <option value="all">All teams</option>
            {PEOPLE_OPS_TEAMS.map((team) => <option value={team} key={team}>{team}</option>)}
          </select>
        </label>
        <label className="people-ops-filterField">
          <small>Source date</small>
          <select
            aria-label="Filter People Operations by source due date"
            value={filters.dueWindow}
            onChange={(event) => setFilters((current) => ({
              ...current, dueWindow: event.target.value as PeopleOpsDueWindow, page: 1,
            }))}
          >
            {DUE_WINDOWS.map((window) => <option value={window.value} key={window.value}>{window.label}</option>)}
          </select>
        </label>
        <label className="people-ops-searchField">
          <small>Find an employee</small>
          <span className="people-ops-searchInput"><Search size={16} aria-hidden="true" /><input
            aria-label="Search employees in People Operations Inbox"
            value={draftQuery}
            maxLength={80}
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder="Search name or employee number"
          /></span>
        </label>
        <button type="submit" className="people-ops-searchButton">Apply search</button>
        <button type="button" className="people-ops-clearButton" onClick={() => {
          setDraftQuery("");
          setFilters({ priority: "all", category: "all", dueWindow: "all", team: "all", query: "", page: 1 });
        }}>Clear filters</button>
      </form>

      {loading && <div className="empty-state" role="status">Loading tenant-scoped HR follow-ups…</div>}

      {!loading && data && (
        <>
          <div className="people-ops-listHeading"><h3>Employee follow-ups <span>{data.filteredTotal}</span></h3><p>Showing {data.rows.length} of {data.filteredTotal} · Priority, then due date · {data.today}</p></div>
          <div className="people-ops-tableWrap">
            <table className="people-ops-table">
              <thead>
                <tr>
                  <th>Employee</th><th>Workflow</th><th>Next step</th><th>Priority / source date</th><th><span className="people-ops-srOnly">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr><td colSpan={5}>
                    <div className="people-ops-empty"><CheckCheck size={24} aria-hidden="true" />
                      No source-linked follow-ups match these filters.
                      This is not evidence that every HR requirement is complete.
                    </div>
                  </td></tr>
                )}
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Employee"><div className="people-ops-employee"><span className="people-ops-avatar" aria-hidden="true">{row.employeeName.split(/\s+/).slice(0, 2).map(part => part[0]).join("")}</span><div><strong>{row.employeeName}</strong><small>{row.employeeNo}</small></div></div></td>
                    <td data-label="Workflow"><span className="people-ops-workflow">{row.category.replaceAll("_", " ")}</span></td>
                    <td data-label="Next step" className="people-ops-nextStep">
                      <strong>{row.title}</strong>
                      <small className="people-ops-detail">{row.detail}</small>
                      <small className="people-ops-owner">
                        {row.responsibleTeam}
                      </small>
                    </td>
                    <td data-label="Priority / source date">
                      <span className="people-ops-priority" data-priority={row.priority}>{priorityLabel(row.priority)}</span>
                      <small className="people-ops-dueDate">
                        {dueLabel(row.daysUntil, row.dueDate)}
                      </small>
                    </td>
                    <td className="people-ops-actionCell">
                      <button
                        type="button"
                        className="people-ops-rowAction"
                        onClick={() => {
                          if (row.page === "People") {
                            if (!onOpenWorker(row.employeeId)) onPage("People");
                          } else {
                            onPage(row.page);
                          }
                        }}
                      >
                        {row.page === "People" ? "View worker" : "Open " + row.page}<ArrowUpRight size={14} aria-hidden="true" />
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
          <div className="people-ops-footer"><ShieldCheck size={16} aria-hidden="true" /><span>{data.disclaimer}</span></div>
        </>
      )}
    </section>
  );
}
