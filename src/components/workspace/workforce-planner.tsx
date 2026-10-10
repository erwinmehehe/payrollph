"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarRange,
  Clock3,
  Layers3,
  Plus,
  RefreshCcw,
  RotateCw,
  Save,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import type { ResolvedDailySchedule } from "@/lib/workforce-scheduling";
import type {
  ScheduleGuardrailIssue,
  ScheduleGuardrailPolicy,
} from "@/lib/workforce-schedule-guardrails";
import type { DashboardData, Notify } from "./types";
import { buildRotationTemplateDraft } from "@/lib/workforce-rotation-template";
import { EmptyState, ErrorState, Metric, PageHeading, Spinner, Status } from "./ui";
import { WorkforceOvertimePanel } from "./workforce-overtime-panel";
import { WorkforceScheduleSwapPanel } from "./workforce-schedule-swap-panel";
import { WorkforceScheduleGuardrailsPanel } from "./workforce-schedule-guardrails-panel";
import { LaborCostingPanel } from "./labor-costing-panel";
import { WorkforceWorksitesPanel } from "./workforce-worksites-panel";
import { WorkforceCoveragePanel } from "./workforce-coverage-panel";
import { WorkforceTimesheetPanel } from "./workforce-timesheet-panel";
import { WorkforceTeamRosterPanel } from "./workforce-team-roster-panel";
import { WorkforceOperationsInbox } from "./workforce-operations-inbox";
import { WorkforceBulkRosterPreview } from "./workforce-bulk-roster-preview";

type ShiftRow = {
  id: number;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  spansMidnight: boolean;
  active: boolean;
};

type PatternRow = {
  id: number;
  code: string;
  name: string;
  cycleDays: number;
  active: boolean;
};

type PatternDayRow = {
  id: number;
  patternId: number;
  dayIndex: number;
  isRestDay: boolean;
  label: string | null;
};

type PatternSegmentRow = {
  id: number;
  patternDayId: number;
  shiftDefinitionId: number;
  segmentOrder: number;
};

type AssignmentRow = {
  id: number;
  employeeId: number;
  patternId: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  anchorDate: string;
  workLocationOrgUnitId: number | null;
  worksiteId: number | null;
  reason: string;
};

type OverrideRow = {
  id: number;
  employeeId: number;
  workDate: string;
  kind: string;
  isRestDay: boolean;
  segments: Array<{ shiftDefinitionId: number; segmentOrder: number }> | unknown;
  worksiteId: number | null;
  reason: string;
  status: string;
};

type WorksiteRow = {
  id: number;
  code: string;
  name: string;
  active: boolean;
};

type WorksiteAssignmentRow = {
  id: number;
  employeeId: number;
  worksiteId: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
};

type Catalog = {
  shifts: ShiftRow[];
  patterns: PatternRow[];
  patternDays: PatternDayRow[];
  patternSegments: PatternSegmentRow[];
  assignments: AssignmentRow[];
  overrides: OverrideRow[];
  worksites: WorksiteRow[];
  worksiteAssignments: WorksiteAssignmentRow[];
};

type Preview = {
  employee: { id: number; employeeNo: string; name: string };
  resolved: ResolvedDailySchedule | null;
  resolvedDays: ResolvedDailySchedule[];
  guardrailPolicy: ScheduleGuardrailPolicy;
  guardrailIssues: ScheduleGuardrailIssue[];
};

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function localToday() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function displayDate(dateText: string) {
  return new Date(`${dateText}T00:00:00Z`).toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function scheduleLabel(day: ResolvedDailySchedule) {
  if (day.isRestDay) return "Rest day";
  if (day.segments.length === 0) return day.source === "unassigned" ? "No advanced schedule" : "No shift segment";
  return day.segments
    .map((segment) => `${segment.shiftCode} ${segment.startTime}–${segment.endTime}`)
    .join(" · ");
}

export function WorkforcePlanner({
  data,
  notify,
  canManage,
  onOpenAttendance,
}: {
  data: DashboardData;
  notify: Notify;
  canManage: boolean;
  onOpenAttendance: () => void;
}) {
  const organizationId = data.selectedOrganization.id;
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [workspaceTab, setWorkspaceTab] = useState("roster");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const [employeeId, setEmployeeId] = useState<number>(data.employees[0]?.id ?? 0);
  const [rangeStart, setRangeStart] = useState(localToday());

  const [shiftCode, setShiftCode] = useState("DAY");
  const [shiftName, setShiftName] = useState("Day shift");
  const [shiftStart, setShiftStart] = useState("09:00");
  const [shiftEnd, setShiftEnd] = useState("18:00");
  const [shiftBreak, setShiftBreak] = useState("60");

  const [patternCode, setPatternCode] = useState("WEEKLY");
  const [patternName, setPatternName] = useState("Standard weekly rotation");
  const [patternChoices, setPatternChoices] = useState<string[]>(Array(7).fill(""));

  const [assignmentPatternId, setAssignmentPatternId] = useState("");
  const [assignmentStart, setAssignmentStart] = useState(localToday());
  const [assignmentEnd, setAssignmentEnd] = useState("");
  const [assignmentReason, setAssignmentReason] = useState("Roster assignment");
  const [assignmentWorksiteId, setAssignmentWorksiteId] = useState("");

  const [overrideDate, setOverrideDate] = useState(localToday());
  const [overrideMode, setOverrideMode] = useState("REST");
  const [overrideReason, setOverrideReason] = useState("Roster adjustment");
  const [overrideWorksiteId, setOverrideWorksiteId] = useState("");

  const rangeEnd = useMemo(() => addDays(rangeStart, 13), [rangeStart]);

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    try {
      const response = await fetch(`/api/workforce/schedules?organizationId=${organizationId}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load workforce schedules.");
      setCatalog(payload as Catalog);
      setCatalogError("");
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : "Could not load workforce schedules.");
      notify(error instanceof Error ? error.message : "Could not load workforce schedules.", "err");
    } finally {
      setLoadingCatalog(false);
    }
  }, [organizationId, notify]);

  const loadPreview = useCallback(async () => {
    if (!employeeId) {
      setPreview(null);
      return;
    }
    setLoadingPreview(true);
    try {
      const params = new URLSearchParams({
        organizationId: String(organizationId),
        employeeId: String(employeeId),
        startDate: rangeStart,
        endDate: rangeEnd,
      });
      const response = await fetch(`/api/workforce/schedules?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not preview the roster.");
      setPreview(payload as Preview);
    } catch (error) {
      setPreview(null);
      notify(error instanceof Error ? error.message : "Could not preview the roster.", "err");
    } finally {
      setLoadingPreview(false);
    }
  }, [employeeId, organizationId, rangeEnd, rangeStart, notify]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  useEffect(() => {
    if (!catalog?.shifts.length || patternChoices.some(Boolean)) return;
    const defaultShift = String(catalog.shifts[0].id);
    setPatternChoices([defaultShift, defaultShift, defaultShift, defaultShift, defaultShift, "REST", "REST"]);
    setOverrideMode(defaultShift);
  }, [catalog, patternChoices]);

  useEffect(() => {
    if (!assignmentPatternId && catalog?.patterns[0]) {
      setAssignmentPatternId(String(catalog.patterns[0].id));
    }
  }, [assignmentPatternId, catalog]);

  async function mutate(action: string, payload: Record<string, unknown>, success: string) {
    setSaving(action);
    try {
      const response = await fetch("/api/workforce/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, action, ...payload }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(body.error ?? "The workforce change could not be saved.", "err");
        return false;
      }
      await loadCatalog();
      await loadPreview();
      notify(success);
      return true;
    } catch {
      notify("Could not reach the workforce scheduling service.", "err");
      return false;
    } finally {
      setSaving(null);
    }
  }

  async function createShift() {
    await mutate("create_shift", {
      code: shiftCode,
      name: shiftName,
      startTime: shiftStart,
      endTime: shiftEnd,
      breakMinutes: Number(shiftBreak),
    }, `Shift ${shiftCode.toUpperCase()} created and audit-logged.`);
  }

  async function createPattern() {
    if (patternChoices.some((choice) => !choice)) {
      notify("Choose a shift or Rest day for every day in the seven-day rotation.", "err");
      return;
    }
    const ok = await mutate("create_pattern", {
      code: patternCode,
      name: patternName,
      cycleDays: 7,
      days: WEEKDAYS.map((label, index) => ({
        label,
        isRestDay: patternChoices[index] === "REST",
        segments: patternChoices[index] === "REST"
          ? []
          : [{ shiftDefinitionId: Number(patternChoices[index]) }],
      })),
    }, `Rotation ${patternCode.toUpperCase()} created.`);
    if (ok) setAssignmentPatternId("");
  }

  function useExistingPatternAsTemplate(pattern: PatternRow) {
    if (!catalog) return;
    const result = buildRotationTemplateDraft({
      pattern, patterns: catalog.patterns, days: catalog.patternDays,
      segments: catalog.patternSegments,
      shiftIds: catalog.shifts.map(shift => shift.id),
    });
    if (!result.ok) {
      notify(result.error, "err");
      return;
    }
    setPatternCode(result.code);
    setPatternName(result.name);
    setPatternChoices(result.choices);
    notify("Rotation loaded for review. It has not been saved or assigned.");
  }

  async function assignPattern() {
    if (!employeeId || !assignmentPatternId || !assignmentStart) {
      notify("Employee, rotation and effective start date are required.", "err");
      return;
    }
    await mutate("assign_schedule", {
      employeeId,
      patternId: Number(assignmentPatternId),
      effectiveFrom: assignmentStart,
      effectiveUntil: assignmentEnd || null,
      anchorDate: assignmentStart,
      worksiteId: assignmentWorksiteId ? Number(assignmentWorksiteId) : null,
      reason: assignmentReason,
    }, "Effective-dated employee roster assignment saved.");
  }

  async function createOverride() {
    if (!employeeId || !overrideDate || !overrideReason.trim()) {
      notify("Employee, override date and reason are required.", "err");
      return;
    }
    const restDay = overrideMode === "REST";
    await mutate("create_override", {
      employeeId,
      workDate: overrideDate,
      kind: restDay ? "rest_day" : "shift",
      isRestDay: restDay,
      segments: restDay ? [] : [{ shiftDefinitionId: Number(overrideMode) }],
      worksiteId: overrideWorksiteId ? Number(overrideWorksiteId) : null,
      reason: overrideReason,
    }, restDay ? "Rest-day override saved." : "Shift override saved.");
  }

  const assignedEmployees = useMemo(
    () => new Set((catalog?.assignments ?? []).map((row) => row.employeeId)).size,
    [catalog],
  );
  const selectedAssignments = useMemo(
    () => (catalog?.assignments ?? []).filter((row) => row.employeeId === employeeId),
    [catalog, employeeId],
  );
  const selectedOverrides = useMemo(
    () => (catalog?.overrides ?? [])
      .filter((row) => row.employeeId === employeeId)
      .sort((a, b) => String(b.workDate).localeCompare(String(a.workDate)))
      .slice(0, 12),
    [catalog, employeeId],
  );

  return (
    <>
      <PageHeading
        eyebrow="Workforce management"
        title="Workforce schedules"
        copy="Manage shifts, rotations and schedule changes. Review coverage and guardrails before applying changes."
        actions={
          <button className="secondary-button" onClick={() => void Promise.all([loadCatalog(), loadPreview()])}>
            <RefreshCcw size={15} className="i-cyan" /> Refresh roster
          </button>
        }
      />

      <div className="tabs" role="tablist" aria-label="Workforce workspace" onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const index = tabs.indexOf(event.target as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next]?.focus(); tabs[next]?.click();
      }}>
        {[['operations', 'Operations'], ['bulk', 'Bulk draft'], ['roster', 'Individual roster'], ['team', 'Team roster'], ['coverage', 'Coverage'], ['timesheets', 'Timesheets'], ['overtime', 'Overtime'], ['swaps', 'Schedule swaps'], ['worksites', 'Worksites'], ['costing', 'Labor costing'], ['guardrails', 'Guardrails']].map(([key, label]) => (
          <button type="button" key={key} id={`wfm-tab-${key}`} role="tab" tabIndex={workspaceTab === key ? 0 : -1} aria-selected={workspaceTab === key} aria-controls={`wfm-panel-${key}`} className={workspaceTab === key ? "active" : ""} onClick={() => setWorkspaceTab(key)}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" id="wfm-panel-operations" aria-labelledby="wfm-tab-operations" hidden={workspaceTab !== "operations"}><WorkforceOperationsInbox organizationId={organizationId} onOpenAttendance={onOpenAttendance} onOpenTab={setWorkspaceTab} /></div>
      <div role="tabpanel" id="wfm-panel-bulk" aria-labelledby="wfm-tab-bulk" hidden={workspaceTab !== "bulk"}>
        {["owner", "admin", "bookkeeper", "hr"].includes(data.access?.role ?? "") ? (
          <WorkforceBulkRosterPreview organizationId={organizationId} enabled={workspaceTab === "bulk"} onOpenTeamRoster={() => setWorkspaceTab("team")}/>
        ) : <div className="notice notice-slate">Bulk roster drafts require an authorized People administrator.</div>}
      </div>
      <div role="tabpanel" id="wfm-panel-roster" aria-labelledby="wfm-tab-roster" hidden={workspaceTab !== 'roster'}>
      {catalogError && <ErrorState title="Schedules could not load" detail={catalogError} onRetry={() => void loadCatalog()} />}
      <section className="stats-grid">
        <Metric
          label="Shift definitions"
          value={catalog ? String(catalog.shifts.length) : "—"}
          hint="reusable work windows"
          icon={<Clock3 size={16} className="i-cyan" />}
          tone="blue"
        />
        <Metric
          label="Rotation patterns"
          value={catalog ? String(catalog.patterns.length) : "—"}
          hint="effective-dated roster templates"
          icon={<RotateCw size={16} className="i-purple" />}
          tone="purple"
        />
        <Metric
          label="Employees assigned"
          value={catalog ? String(assignedEmployees) : "—"}
          hint="using advanced scheduling"
          icon={<UserRound size={16} className="i-green" />}
          tone="mint"
        />
        <Metric
          label="Overrides"
          value={catalog ? String(catalog.overrides.length) : "—"}
          hint="audited day-level changes"
          icon={<CalendarRange size={16} className="i-amber" />}
          tone={(catalog?.overrides.length ?? 0) > 0 ? "amber" : "slate"}
        />
      </section>

      <div className="notice notice-slate">
        <ShieldCheck size={15} className="i-green" />
        <span>
          <strong>Payroll-safe scheduling.</strong> Every assignment and override is effective-dated and audit-logged.
          A roster change changes premium-pay context only for dates where it is legally effective.
        </span>
      </div>

      <article className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">14-day roster preview</div>
            <h2>{preview?.employee.name ?? "Select an employee"}</h2>
            <p>Resolved through the same deterministic schedule engine used by payroll.</p>
          </div>
          {loadingPreview ? <Spinner label="Resolving roster" /> : <Status value={preview ? "Live preview" : "No preview"} />}
        </div>

        {(preview?.guardrailIssues.length ?? 0) > 0 && (
          <div style={{ display: "grid", gap: 8, padding: "0 18px 18px" }}>
            {(preview?.guardrailIssues ?? []).slice(0, 8).map((issue, index) => (
              <div
                className={issue.blocking ? "notice notice-red" : "notice notice-amber"}
                style={{ margin: 0 }}
                key={`${issue.code}-${issue.date}-${issue.relatedDate ?? ""}-${index}`}
              >
                <ShieldCheck size={15} />
                <span>
                  <strong>{issue.title}</strong> · {issue.date}{issue.relatedDate ? ` / ${issue.relatedDate}` : ""} · {issue.detail}
                </span>
              </div>
            ))}
            {(preview?.guardrailIssues.length ?? 0) > 8 && (
              <div className="id">+{(preview?.guardrailIssues.length ?? 0) - 8} more guardrail issue(s) in this window</div>
            )}
          </div>
        )}

        <div className="setting-form" style={{ paddingTop: 0 }}>
          <label>
            Employee
            <select value={employeeId || ""} onChange={(event) => setEmployeeId(Number(event.target.value))}>
              {data.employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.employeeNo} · {employee.firstName} {employee.lastName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Window starts
            <input type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} />
          </label>
          <label>
            Window ends
            <input value={rangeEnd} readOnly aria-label="Roster window end" />
          </label>
        </div>

        <div className="data-table-wrap slim-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Source</th>
                <th>Resolved schedule</th>
                <th>Rest day</th>
                <th>Work location</th>
              </tr>
            </thead>
            <tbody>
              {(preview?.resolvedDays ?? []).map((day) => (
                <tr key={day.date}>
                  <td>
                    <strong>{displayDate(day.date)}</strong>
                    <div className="id">{day.date}</div>
                  </td>
                  <td><Status value={day.source === "override" ? "Override" : day.source === "pattern" ? "Pattern" : "Unassigned"} /></td>
                  <td>{scheduleLabel(day)}</td>
                  <td>{day.isRestDay ? <Status value="Rest day" /> : <span className="id">Working day</span>}</td>
                  <td>
                    {day.worksiteId != null
                      ? catalog?.worksites.find((site) => site.id === day.worksiteId)?.name ?? `Worksite #${day.worksiteId}`
                      : day.workLocationOrgUnitId != null
                        ? `Legacy org unit #${day.workLocationOrgUnitId}`
                        : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loadingPreview && (preview?.resolvedDays.length ?? 0) === 0 && (
            <EmptyState icon={<CalendarRange size={20} className="i-slate" />} title="No roster preview">
              Assign a schedule pattern to this employee, or select another date window.
            </EmptyState>
          )}
        </div>
      </article>

      {canManage && (
        <section className="module-grid two" style={{ marginTop: 16 }}>
          <article className="card">
            <div className="card-header">
              <div>
                <div className="card-kicker">Shift library</div>
                <h2>Create a reusable shift</h2>
                <p>Cross-midnight status is derived automatically when the end time is not later than the start time.</p>
              </div>
              <Clock3 size={18} className="i-cyan" />
            </div>
            <div className="setting-form">
              <label>Code<input value={shiftCode} onChange={(event) => setShiftCode(event.target.value)} /></label>
              <label>Name<input value={shiftName} onChange={(event) => setShiftName(event.target.value)} /></label>
              <label>Start<input type="time" value={shiftStart} onChange={(event) => setShiftStart(event.target.value)} /></label>
              <label>End<input type="time" value={shiftEnd} onChange={(event) => setShiftEnd(event.target.value)} /></label>
              <label>Unpaid break minutes<input type="number" min={0} max={480} value={shiftBreak} onChange={(event) => setShiftBreak(event.target.value)} /></label>
            </div>
            <div className="run-actions">
              <button className="primary-button brand" onClick={() => void createShift()} disabled={saving !== null}>
                {saving === "create_shift" ? <Spinner label="Saving" /> : <Plus size={14} />} Create shift
              </button>
            </div>
            <div className="policy-lines">
              {(catalog?.shifts ?? []).map((shift) => (
                <span key={shift.id}>
                  <b>{shift.code} · {shift.name}</b>
                  <small style={{ display: "block", color: "var(--muted)" }}>
                    {shift.startTime}–{shift.endTime} · {shift.breakMinutes}m break{shift.spansMidnight ? " · crosses midnight" : ""}
                  </small>
                </span>
              ))}
            </div>
          </article>

          <article className="card">
            <div className="card-header">
              <div>
                <div className="card-kicker">Rotation template</div>
                <h2>Build a seven-day pattern</h2>
                <p>Each day is explicitly assigned a shift or marked as a rest day.</p>
              </div>
              <Layers3 size={18} className="i-purple" />
            </div>
            <div className="setting-form">
              <label>Code<input value={patternCode} onChange={(event) => setPatternCode(event.target.value)} /></label>
              <label>Name<input value={patternName} onChange={(event) => setPatternName(event.target.value)} /></label>
              {WEEKDAYS.map((day, index) => (
                <label key={day}>
                  {day}
                  <select
                    value={patternChoices[index]}
                    onChange={(event) => setPatternChoices((current) => current.map((value, dayIndex) => dayIndex === index ? event.target.value : value))}
                  >
                    <option value="">Choose...</option>
                    <option value="REST">Rest day</option>
                    {(catalog?.shifts ?? []).map((shift) => <option key={shift.id} value={shift.id}>{shift.code} · {shift.name}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className="run-actions">
              <button className="primary-button brand" onClick={() => void createPattern()} disabled={saving !== null || !(catalog?.shifts.length)}>
                {saving === "create_pattern" ? <Spinner label="Saving" /> : <Save size={14} />} Save rotation
              </button>
            </div>
            <div className="policy-lines">
              {(catalog?.patterns ?? []).map((pattern) => (
                <span key={pattern.id}>
                  <b>{pattern.code} · {pattern.name}</b>
                  <small style={{ display: "block", color: "var(--muted)" }}>{pattern.cycleDays}-day cycle</small>
                  <button type="button" className="secondary-button"
                    onClick={() => useExistingPatternAsTemplate(pattern)} disabled={saving !== null}
                    aria-label={`Use ${pattern.name} as a new rotation template`}>
                    Use as template
                  </button>
                </span>
              ))}
            </div>
          </article>

          <article className="card">
            <div className="card-header">
              <div>
                <div className="card-kicker">Employee assignment</div>
                <h2>Apply a rotation with an effective date</h2>
                <p>The anchor date determines which day of the rotation applies on each calendar date.</p>
              </div>
              <UserRound size={18} className="i-green" />
            </div>
            <div className="setting-form">
              <label>
                Employee
                <select value={employeeId || ""} onChange={(event) => setEmployeeId(Number(event.target.value))}>
                  {data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNo} · {employee.firstName} {employee.lastName}</option>)}
                </select>
              </label>
              <label>
                Rotation
                <select value={assignmentPatternId} onChange={(event) => setAssignmentPatternId(event.target.value)}>
                  <option value="">Choose...</option>
                  {(catalog?.patterns ?? []).map((pattern) => <option key={pattern.id} value={pattern.id}>{pattern.code} · {pattern.name}</option>)}
                </select>
              </label>
              <label>Effective from<input type="date" value={assignmentStart} onChange={(event) => setAssignmentStart(event.target.value)} /></label>
              <label>Effective until (optional)<input type="date" min={assignmentStart} value={assignmentEnd} onChange={(event) => setAssignmentEnd(event.target.value)} /></label>
              <label>
                Worksite override (optional)
                <select value={assignmentWorksiteId} onChange={(event) => setAssignmentWorksiteId(event.target.value)}>
                  <option value="">Use employee default worksite</option>
                  {(catalog?.worksites ?? []).filter((site) => site.active).map((site) => (
                    <option key={site.id} value={site.id}>{site.code} · {site.name}</option>
                  ))}
                </select>
              </label>
              <label>Reason<input value={assignmentReason} onChange={(event) => setAssignmentReason(event.target.value)} /></label>
            </div>
            <div className="run-actions">
              <button className="primary-button brand" onClick={() => void assignPattern()} disabled={saving !== null || !assignmentPatternId}>
                {saving === "assign_schedule" ? <Spinner label="Saving" /> : <Save size={14} />} Assign rotation
              </button>
            </div>
            <div className="policy-lines">
              {selectedAssignments.map((assignment) => {
                const pattern = catalog?.patterns.find((item) => item.id === assignment.patternId);
                return (
                  <span key={assignment.id}>
                    <b>{pattern?.code ?? `Pattern #${assignment.patternId}`}</b>
                    <small style={{ display: "block", color: "var(--muted)" }}>
                      {assignment.effectiveFrom} → {assignment.effectiveUntil ?? "open-ended"}
                      {assignment.worksiteId ? ` · ${catalog?.worksites.find((site) => site.id === assignment.worksiteId)?.code ?? `site #${assignment.worksiteId}`}` : ""}
                      · {assignment.reason}
                    </small>
                  </span>
                );
              })}
            </div>
          </article>

          <article className="card">
            <div className="card-header">
              <div>
                <div className="card-kicker">Day-level control</div>
                <h2>Override a shift or rest day</h2>
                <p>Use for temporary schedule changes, substitute rest days and one-off assignments.</p>
              </div>
              <CalendarRange size={18} className="i-amber" />
            </div>
            <div className="setting-form">
              <label>Work date<input type="date" value={overrideDate} onChange={(event) => setOverrideDate(event.target.value)} /></label>
              <label>
                Override
                <select value={overrideMode} onChange={(event) => setOverrideMode(event.target.value)}>
                  <option value="REST">Rest day / off</option>
                  {(catalog?.shifts ?? []).map((shift) => <option key={shift.id} value={shift.id}>{shift.code} · {shift.name}</option>)}
                </select>
              </label>
              <label>
                Worksite override (optional)
                <select value={overrideWorksiteId} onChange={(event) => setOverrideWorksiteId(event.target.value)}>
                  <option value="">Keep resolved worksite</option>
                  {(catalog?.worksites ?? []).filter((site) => site.active).map((site) => (
                    <option key={site.id} value={site.id}>{site.code} · {site.name}</option>
                  ))}
                </select>
              </label>
              <label>Reason<input value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} /></label>
            </div>
            <div className="run-actions">
              <button className="primary-button brand" onClick={() => void createOverride()} disabled={saving !== null || (!catalog?.shifts.length && overrideMode !== "REST")}>
                {saving === "create_override" ? <Spinner label="Saving" /> : <Save size={14} />} Save override
              </button>
            </div>
            <div className="policy-lines">
              {selectedOverrides.map((override) => (
                <span key={override.id}>
                  <b>{override.workDate} · {override.isRestDay ? "Rest day" : override.kind}</b>
                  <small style={{ display: "block", color: "var(--muted)" }}>{override.reason} · {override.status}</small>
                </span>
              ))}
            </div>
          </article>
        </section>
      )}

      {!canManage && (
        <div className="notice notice-amber" style={{ marginTop: 16 }}>
          <ShieldCheck size={15} />
          <span>This role can review workforce schedules but cannot change roster definitions or employee assignments.</span>
        </div>
      )}

      {loadingCatalog && !catalog && (
        <div className="notice notice-slate" style={{ marginTop: 16 }}>
          <Spinner label="Loading workforce configuration" />
        </div>
      )}
      </div>
      <div role="tabpanel" id="wfm-panel-team" aria-labelledby="wfm-tab-team" hidden={workspaceTab !== 'team'}><WorkforceTeamRosterPanel organizationId={organizationId} canManage={canManage} notify={notify} onScheduleChanged={() => { void loadCatalog(); void loadPreview(); }} /></div>
      <div role="tabpanel" id="wfm-panel-coverage" aria-labelledby="wfm-tab-coverage" hidden={workspaceTab !== 'coverage'}><WorkforceCoveragePanel data={data} notify={notify} canManage={canManage} /></div>
      <div role="tabpanel" id="wfm-panel-timesheets" aria-labelledby="wfm-tab-timesheets" hidden={workspaceTab !== 'timesheets'}><WorkforceTimesheetPanel data={data} notify={notify} canManage={canManage} /></div>
      <div role="tabpanel" id="wfm-panel-overtime" aria-labelledby="wfm-tab-overtime" hidden={workspaceTab !== 'overtime'}><WorkforceOvertimePanel data={data} notify={notify} /></div>
      <div role="tabpanel" id="wfm-panel-swaps" aria-labelledby="wfm-tab-swaps" hidden={workspaceTab !== 'swaps'}><WorkforceScheduleSwapPanel data={data} notify={notify} /></div>
      <div role="tabpanel" id="wfm-panel-worksites" aria-labelledby="wfm-tab-worksites" hidden={workspaceTab !== 'worksites'}><WorkforceWorksitesPanel data={data} notify={notify} canManage={canManage} /></div>
      <div role="tabpanel" id="wfm-panel-costing" aria-labelledby="wfm-tab-costing" hidden={workspaceTab !== 'costing'}><LaborCostingPanel data={data} notify={notify} /></div>
      <div role="tabpanel" id="wfm-panel-guardrails" aria-labelledby="wfm-tab-guardrails" hidden={workspaceTab !== 'guardrails'}><WorkforceScheduleGuardrailsPanel data={data} notify={notify} canManage={canManage} onSaved={() => void loadPreview()} /></div>
    </>
  );
}
