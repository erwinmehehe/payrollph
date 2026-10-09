"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Download, RefreshCcw, ShieldCheck } from "lucide-react";
import {
  buildTeamRosterPageCsv,
  filterTeamRosterRows,
  rosterDateOffset,
  summarizeTeamRosterByDate,
  type TeamRosterDay,
  type TeamRosterEmployee,
  type TeamRosterRow,
  type TeamRosterSummary,
  type TeamRosterFocus,
} from "@/lib/workforce-team-roster";
import type { Notify } from "./types";
import { EmptyState, Spinner, Status } from "./ui";

type TeamRosterResponse = {
  weekDates: string[];
  startDate: string;
  endDate: string;
  page: number;
  pageSize: number;
  totalEmployees: number;
  totalPages: number;
  rows: TeamRosterRow[];
  summary: TeamRosterSummary;
  shifts: Array<{
    id: number;
    code: string;
    name: string;
    startTime: string;
    endTime: string;
    spansMidnight: boolean;
  }>;
  worksites: Array<{ id: number; code: string; name: string; active: boolean }>;
};

type DayEditor = { employee: TeamRosterEmployee; day: TeamRosterDay; organizationId: number };

function todayInManila() {
  return new Date(Date.now() + 8 * 60 * 60_000).toISOString().slice(0, 10);
}

function mondayInManila() {
  const manila = new Date(Date.now() + 8 * 60 * 60_000);
  const weekdayFromMonday = (manila.getUTCDay() + 6) % 7;
  return rosterDateOffset(manila.toISOString().slice(0, 10), -weekdayFromMonday);
}

function showDate(date: string) {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(date + "T12:00:00Z"));
}

function dayLabel(day: TeamRosterDay) {
  if (day.isRestDay) return "Rest day";
  if (!day.segments.length) return day.source === "unassigned" ? "Unassigned" : "No shift";
  return day.segments.map((segment) =>
    segment.shiftCode + " " + segment.startTime + "–" + segment.endTime
  ).join(" / ");
}

/**
 * Server-projected roster: no guessing missing shifts, no direct writes from a
 * drag-and-drop UI. Every change uses the existing MFA/audited override route.
 */
export function WorkforceTeamRosterPanel({
  organizationId,
  canManage,
  notify,
  onScheduleChanged,
}: {
  organizationId: number;
  canManage: boolean;
  notify: Notify;
  onScheduleChanged?: () => void;
}) {
  const [startDate, setStartDate] = useState(mondayInManila);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [focus, setFocus] = useState<TeamRosterFocus>("all");
  const pendingRequest = useRef<AbortController | null>(null);
  const [payload, setPayload] = useState<TeamRosterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [editor, setEditor] = useState<DayEditor | null>(null);
  const [shiftChoice, setShiftChoice] = useState("REST");
  const [worksiteChoice, setWorksiteChoice] = useState("");
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [saving, setSaving] = useState(false);

  const visibleRows = useMemo(() => payload
    ? filterTeamRosterRows(payload.rows, payload.weekDates, focus) : [], [payload, focus]);
  const dailyDigest = useMemo(() => payload
    ? summarizeTeamRosterByDate(payload.rows, payload.weekDates) : [], [payload]);
  const attentionCount = useMemo(() => payload
    ? filterTeamRosterRows(payload.rows, payload.weekDates, "attention").length : 0, [payload]);

  useEffect(() => () => { pendingRequest.current?.abort(); }, []);
  useEffect(() => { setEditor(null); }, [organizationId]);

  const load = useCallback(async () => {
    pendingRequest.current?.abort();
    const controller = new AbortController();
    pendingRequest.current = controller;
    setLoading(true);
    setLoadError("");
    setPayload(null);
    try {
      const params = new URLSearchParams({
        organizationId: String(organizationId),
        startDate,
        page: String(page),
        search: appliedSearch,
      });
      const response = await fetch("/api/workforce/team-roster?" + params.toString(), {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error ?? "Could not load the team roster.");
      }
      if (controller.signal.aborted) return;
      setPayload(body as TeamRosterResponse);
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "Could not load the team roster.";
      setLoadError(message);
      notify(message, "err");
    } finally {
      if (pendingRequest.current === controller) {
        pendingRequest.current = null;
        setLoading(false);
      }
    }
  }, [organizationId, startDate, page, appliedSearch, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  function changeWeek(delta: number) {
    setEditor(null);
    setStartDate((previous) => rosterDateOffset(previous, delta * 7));
    setPage(1);
  }

  function findEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(search.trim());
    setEditor(null);
  }

  function openDay(employee: TeamRosterEmployee, day: TeamRosterDay) {
    if (!canManage || day.date <= todayInManila() || day.source === "override" || day.segments.length > 1) return;
    setEditor({ employee, day, organizationId });
    setShiftChoice("");
    setWorksiteChoice("");
    setReason("");
    setAcknowledged(false);
    setEditorError("");
  }

  async function saveOverride() {
    if (!editor || !canManage || editor.organizationId !== organizationId || editor.day.date <= todayInManila()
      || !acknowledged || !reason.trim() || !shiftChoice || saving) return;
    setSaving(true);
    setEditorError("");
    const rest = shiftChoice === "REST";
    try {
      const response = await fetch("/api/workforce/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "create_override",
          employeeId: editor.employee.id,
          workDate: editor.day.date,
          kind: rest ? "rest_day" : "shift",
          isRestDay: rest,
          segments: rest ? [] : [{ shiftDefinitionId: Number(shiftChoice) }],
          // Keep effective site unless manager explicitly selects another.
          worksiteId: worksiteChoice ? Number(worksiteChoice) : editor.day.worksiteId,
          reason: reason.trim(),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const blocking = Array.isArray(body.guardrailIssues)
          ? body.guardrailIssues.find((issue: { blocking?: boolean; detail?: string }) => issue.blocking)
          : null;
        throw new Error(blocking?.detail ?? body.error ?? "This roster change was not approved.");
      }
      setEditor(null);
      await load();
      onScheduleChanged?.();
      notify("Approved roster override saved and audit-logged.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save roster override.";
      setEditorError(message);
      notify(message, "err");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={{ marginTop: 16 }} aria-label="Weekly team roster" data-wfm-team-roster>
      <article className="card">
        <div className="card-header">
          <div>
            <div className="card-kicker">Team scheduling</div>
            <h2>Weekly team roster</h2>
            <p>See every visible employee in one seven-day view. Open a day to request an audited change.</p>
          </div>
          <CalendarDays size={19} className="i-cyan" />
        </div>
        <div className="notice notice-slate" style={{ margin: "0 18px 16px" }}>
          <ShieldCheck size={16} className="i-green" />
          <span>Schedules come from the payroll-connected resolver. Future-day changes use role, MFA, worksite and roster-guardrail checks; current and past days require the detailed correction workflow. No automatic payroll release occurs.</span>
        </div>
        <div className="run-actions" style={{ flexWrap: "wrap", padding: "0 18px 16px", alignItems: "center" }}>
          <button type="button" className="secondary-button" onClick={() => changeWeek(-1)} aria-label="Previous week">
            <ChevronLeft size={15} /> Previous
          </button>
          <label>
            Week beginning
            <input type="date" value={startDate} onChange={(event) => {
              if (!event.target.value) return;
              setStartDate(event.target.value);
              setPage(1);
              setEditor(null);
            }} aria-label="Roster first date" />
          </label>
          <button type="button" className="secondary-button" onClick={() => changeWeek(1)} aria-label="Next week">
            Next <ChevronRight size={15} />
          </button>
          <button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>
            <RefreshCcw size={15} /> Refresh
          </button>
        </div>
        <form onSubmit={findEmployee} className="run-actions" style={{ padding: "0 18px 16px", flexWrap: "wrap" }}>
          <label>
            Find employee
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name or employee number"
              maxLength={70}
              aria-label="Find employee in team roster"
            />
          </label>
          <button type="submit" className="secondary-button">Search</button>
          {appliedSearch && (
            <button type="button" className="secondary-button" onClick={() => {
              setSearch("");
              setAppliedSearch("");
              setPage(1);
            }}>Clear</button>
          )}
        </form>

        {loadError && <div className="notice notice-red" role="alert" style={{ margin: "0 18px 16px" }}>{loadError}</div>}
        {loading && <div style={{ padding: 18 }}><Spinner label="Loading roster" /></div>}

        {payload && (
          <>
            <div className="stats-grid" style={{ padding: "0 18px 16px" }}>
              <div className="metric"><div className="metric-label">Employees on this page</div><strong>{payload.summary.employees}</strong></div>
              <div className="metric"><div className="metric-label">Scheduled employee-days</div><strong>{payload.summary.scheduledDays}</strong></div>
              <div className="metric"><div className="metric-label">Unassigned employee-days</div><strong>{payload.summary.unassignedDays}</strong></div>
              <div className="metric"><div className="metric-label">Employees needing roster attention</div><strong>{attentionCount}</strong></div>
            </div>
            <div className="data-table-wrap slim-scroll" style={{ overflowX: "auto" }}>
              <table className="data-table" aria-label="Team schedule by employee and date">
                <thead>
                  <tr>
                    <th scope="col">Employee</th>
                    {payload.weekDates.map((date) => <th key={date} scope="col">{showDate(date)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr key={row.employee.id}>
                      <th scope="row" style={{ textAlign: "left", minWidth: 175 }}>
                        <strong>{row.employee.name}</strong>
                        <div className="id">{row.employee.employeeNo}</div>
                        <Status value={row.employee.status} />
                      </th>
                      {payload.weekDates.map((date) => {
                        const day = row.days.find((item) => item.date === date);
                        if (row.error) return <td key={date}><span className="id">Needs review</span></td>;
                        if (!day) return <td key={date}><span className="id">No data</span></td>;
                        const editable = canManage && day.date > todayInManila() && day.source !== "override" && day.segments.length <= 1;
                        const label = dayLabel(day);
                        return (
                          <td key={date} style={{ minWidth: 136, verticalAlign: "top" }}>
                            <button
                              type="button"
                              disabled={!editable}
                              onClick={() => openDay(row.employee, day)}
                              title={day.date <= todayInManila() ? "Current or past date: use detailed correction workflow" : day.source === "override" ? "Existing approved override; use day-level controls" : day.segments.length > 1 ? "Split shift requires the advanced day-level editor" : label}
                              aria-label={row.employee.name + ", " + date + ", " + label + (editable ? ", edit day" : "")}
                              style={{
                                width: "100%",
                                border: "1px solid var(--border)",
                                background: day.isRestDay ? "var(--surface, transparent)" : "var(--surface-2, transparent)",
                                borderRadius: 8,
                                padding: "8px",
                                textAlign: "left",
                                font: "inherit",
                                cursor: editable ? "pointer" : "default",
                                opacity: day.source === "unassigned" ? 0.8 : 1,
                              }}
                            >
                              <strong style={{ display: "block", fontSize: 12 }}>{label}</strong>
                              <span className="id">{day.source === "override" ? "Approved override" : day.source === "pattern" ? "Rotation" : "No assigned rotation"}</span>
                              {day.segments.some((segment) => segment.spansMidnight) && <span className="id" style={{ display: "block" }}>Overnight</span>}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {payload.rows.length === 0 && (
              <EmptyState icon={<CalendarDays size={20} />} title="No employees in this roster">
                Try a different employee search or select another page.
              </EmptyState>
            )}
            <div className="run-actions" style={{ padding: 18, justifyContent: "space-between", alignItems: "center" }}>
              <span className="id">
                Page {payload.page} of {payload.totalPages} · {payload.totalEmployees} matching employees
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="secondary-button" disabled={page <= 1} onClick={() => setPage((n) => Math.max(1, n - 1))}>Previous page</button>
                <button type="button" className="secondary-button" disabled={page >= payload.totalPages} onClick={() => setPage((n) => n + 1)}>Next page</button>
              </div>
            </div>
          </>
        )}
      </article>

      {editor && canManage && (
        <article className="card" style={{ marginTop: 16 }} data-wfm-team-roster-editor>
          <div className="card-header">
            <div>
              <div className="card-kicker">Governed schedule change</div>
              <h2>{editor.employee.name} · {showDate(editor.day.date)}</h2>
              <p>Current: {dayLabel(editor.day)}. Worksite: {payload?.worksites.find((site) => site.id === editor.day.worksiteId)?.name ?? "Unspecified"}. Saving creates an approved day-level override and preserves audit evidence.</p>
            </div>
            <button type="button" className="secondary-button" disabled={saving} onClick={() => setEditor(null)}>Cancel</button>
          </div>
          <div className="setting-form">
            <label>
              Day assignment
              <select value={shiftChoice} onChange={(event) => setShiftChoice(event.target.value)}>
                <option value="">Choose a new shift or rest day</option>
                <option value="REST">Rest day / off</option>
                {(payload?.shifts ?? []).map((shift) => (
                  <option key={shift.id} value={String(shift.id)}>
                    {shift.code} · {shift.name} · {shift.startTime}–{shift.endTime}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Worksite (optional)
              <select value={worksiteChoice} onChange={(event) => setWorksiteChoice(event.target.value)}>
                <option value="">Keep effective scheduled worksite</option>
                {(payload?.worksites ?? []).filter((site) => site.active).map((site) => (
                  <option key={site.id} value={String(site.id)}>{site.code} · {site.name}</option>
                ))}
              </select>
            </label>
            <label>
              Reason for change
              <input
                required
                maxLength={240}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Explain why this roster change is needed"
              />
            </label>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
              <span>I understand this approved change may require timesheet review and can affect payroll treatment.</span>
            </label>
          </div>
          {editorError && <div className="notice notice-red" role="alert" style={{ margin: "0 18px 16px" }}>{editorError}</div>}
          <div className="run-actions" style={{ padding: "0 18px 18px" }}>
            <button type="button" className="primary-button brand" disabled={saving || !reason.trim() || !acknowledged || !shiftChoice || (!payload?.shifts.length && shiftChoice !== "REST")} onClick={() => void saveOverride()}>
              {saving ? <Spinner label="Saving" /> : <ShieldCheck size={15} />} Apply audited override
            </button>
          </div>
        </article>
      )}
    </section>
  );
}
