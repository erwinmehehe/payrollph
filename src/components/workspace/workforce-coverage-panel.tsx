"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CircleAlert, Plus, RefreshCcw, UsersRound } from "lucide-react";
import type { DashboardData, Notify } from "./types";
import { EmptyState, Metric, Spinner, Status } from "./ui";

type Shift = {
  id: number;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
};

type Worksite = {
  id: number;
  code: string;
  name: string;
  active: boolean;
};

type JobProfile = {
  id: number;
  title: string;
  family: string;
  level: string;
  active: boolean;
};

type Requirement = {
  id: number;
  worksiteId: number;
  workDate: string;
  shiftDefinitionId: number;
  jobProfileId: number | null;
  requiredHeadcount: number;
  notes: string | null;
};

type Coverage = {
  requirementId: number;
  worksiteId: number;
  workDate: string;
  shiftDefinitionId: number;
  jobProfileId: number | null;
  requiredHeadcount: number;
  scheduledHeadcount: number;
  unavailableScheduledHeadcount: number;
  capabilityIneligibleHeadcount: number;
  approvedLeaveScheduledHeadcount: number;
  availableScheduledHeadcount: number;
  gap: number;
  overage: number;
};

type Availability = {
  id: number;
  employeeId: number;
  weekday: number;
  startTime: string;
  endTime: string;
  availabilityType: "unavailable" | "preferred" | string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  notes: string | null;
};

type OpenShift = {
  id: number;
  worksiteId: number;
  workDate: string;
  shiftDefinitionId: number;
  jobProfileId: number | null;
  slots: number;
  status: string;
  sourceRequirementId: number | null;
  reason: string;
  approvedClaims: number;
  remainingSlots: number;
};

type Claim = {
  id: number;
  openShiftId: number;
  employeeId: number;
  status: string;
  reason: string;
  requestedBy: string;
};

type LaborVarianceRow = {
  requirementId: number;
  worksiteId: number;
  workDate: string;
  shiftDefinitionId: number;
  jobProfileId: number | null;
  requiredHeadcount: number;
  scheduledHeadcount: number;
  actualHeadcount: number;
  requiredHours: number;
  scheduledHours: number;
  actualHours: number;
  scheduledCoveragePercent: number;
  actualCoveragePercent: number;
  scheduledVsRequiredHours: number;
  actualVsScheduledHours: number;
  actualVsRequiredHours: number;
  benchmarkHourlyRate: number | null;
  requiredCostBasis: string | null;
  requiredBaseCost: number | null;
  scheduledBaseCost: number | null;
  actualBaseCost: number | null;
  scheduledVsRequiredBaseCost: number | null;
  actualVsScheduledBaseCost: number | null;
  actualVsRequiredBaseCost: number | null;
  attendanceFlags: string[];
};

type LaborVariance = {
  version: string;
  costingBoundary: string;
  costVisible: boolean;
  rows: LaborVarianceRow[];
  summary: {
    requiredHours: number;
    scheduledHours: number;
    actualHours: number;
    scheduledVsRequiredHours: number;
    actualVsScheduledHours: number;
    actualVsRequiredHours: number;
    requiredBaseCost: number | null;
    scheduledBaseCost: number | null;
    actualBaseCost: number | null;
    scheduledVsRequiredBaseCost: number | null;
    actualVsScheduledBaseCost: number | null;
    actualVsRequiredBaseCost: number | null;
    unmatchedActualHours: number;
    unmatchedActualBaseCost: number | null;
    scheduledOutsideRequirementHours: number;
    scheduledOutsideRequirementBaseCost: number | null;
    attendanceExceptionCount: number;
  };
  quality: {
    missingPayProfileEmployeeIds: number[];
    invalidPayProfileEmployeeIds: number[];
    unmatchedPunchRows: number;
    roleEvidenceIssues: string[];
    capabilityEvidenceIssues: string[];
    absenceEvidenceIssues: string[];
  };
};

type Payload = {
  shifts: Shift[];
  worksites: Worksite[];
  jobProfiles: JobProfile[];
  requirements: Requirement[];
  coverage: Coverage[];
  availability: Availability[];
  openShifts: OpenShift[];
  claims: Claim[];
  laborVariance: LaborVariance;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

function hours(value: number) {
  return `${value.toLocaleString("en-PH", { maximumFractionDigits: 1 })}h`;
}

function signedHours(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toLocaleString("en-PH", { maximumFractionDigits: 1 })}h`;
}

function peso(value: number | null | undefined) {
  if (value == null) return "Restricted";
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(value);
}

export function WorkforceCoveragePanel({
  data,
  notify,
  canManage,
}: {
  data: DashboardData;
  notify: Notify;
  canManage: boolean;
}) {
  const organizationId = data.selectedOrganization.id;
  const [startDate, setStartDate] = useState(localToday());
  const endDate = useMemo(() => addDays(startDate, 13), [startDate]);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const [requirementDate, setRequirementDate] = useState(localToday());
  const [requirementWorksiteId, setRequirementWorksiteId] = useState("");
  const [requirementShiftId, setRequirementShiftId] = useState("");
  const [requirementJobProfileId, setRequirementJobProfileId] = useState("");
  const [requiredHeadcount, setRequiredHeadcount] = useState("1");

  const [availabilityEmployeeId, setAvailabilityEmployeeId] = useState(data.employees[0]?.id ?? 0);
  const [availabilityWeekday, setAvailabilityWeekday] = useState("1");
  const [availabilityStart, setAvailabilityStart] = useState("00:00");
  const [availabilityEnd, setAvailabilityEnd] = useState("23:59");
  const [availabilityType, setAvailabilityType] = useState<"unavailable" | "preferred">("unavailable");
  const [availabilityFrom, setAvailabilityFrom] = useState(localToday());
  const [availabilityUntil, setAvailabilityUntil] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        organizationId: String(organizationId),
        startDate,
        endDate,
      });
      const response = await fetch(`/api/workforce/coverage?${params.toString()}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not load coverage planning.");
      setPayload(body as Payload);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load coverage planning.", "err");
    } finally {
      setLoading(false);
    }
  }, [endDate, notify, organizationId, startDate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!requirementWorksiteId && payload?.worksites[0]) {
      setRequirementWorksiteId(String(payload.worksites[0].id));
    }
    if (!requirementShiftId && payload?.shifts[0]) {
      setRequirementShiftId(String(payload.shifts[0].id));
    }
  }, [payload, requirementShiftId, requirementWorksiteId]);

  async function mutate(action: string, extra: Record<string, unknown>, success: string) {
    setSaving(action);
    try {
      const response = await fetch("/api/workforce/coverage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, action, ...extra }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Coverage change could not be saved.");
      notify(success, "ok");
      await load();
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Coverage change could not be saved.", "err");
      return false;
    } finally {
      setSaving(null);
    }
  }

  async function saveRequirement() {
    if (!requirementWorksiteId || !requirementShiftId || !requirementDate) {
      notify("Worksite, shift and date are required.", "err");
      return;
    }
    await mutate("create_requirement", {
      worksiteId: Number(requirementWorksiteId),
      shiftDefinitionId: Number(requirementShiftId),
      jobProfileId: requirementJobProfileId ? Number(requirementJobProfileId) : null,
      workDate: requirementDate,
      requiredHeadcount: Number(requiredHeadcount),
    }, "Staffing requirement saved.");
  }

  async function saveAvailability() {
    if (!availabilityEmployeeId) return;
    await mutate("create_availability", {
      employeeId: availabilityEmployeeId,
      weekday: Number(availabilityWeekday),
      startTime: availabilityStart,
      endTime: availabilityEnd,
      availabilityType,
      effectiveFrom: availabilityFrom,
      effectiveUntil: availabilityUntil || null,
    }, "Employee availability rule saved.");
  }

  async function openGap(row: Coverage) {
    if (row.gap <= 0) return;
    await mutate("create_open_shift", {
      worksiteId: row.worksiteId,
      workDate: row.workDate,
      shiftDefinitionId: row.shiftDefinitionId,
      slots: row.gap,
      sourceRequirementId: row.requirementId,
      reason: `Coverage gap: ${row.gap} slot${row.gap === 1 ? "" : "s"}`,
    }, "Open shift created from the coverage gap.");
  }

  async function decideClaim(claimId: number, decision: "approved" | "rejected") {
    await mutate("decide_claim", {
      claimId,
      decision,
      decisionNote: decision === "approved" ? "Coverage claim approved" : "Coverage claim declined",
    }, decision === "approved" ? "Open-shift claim approved and rostered." : "Open-shift claim rejected.");
  }

  const worksiteById = useMemo(
    () => new Map((payload?.worksites ?? []).map((site) => [site.id, site])),
    [payload],
  );
  const shiftById = useMemo(
    () => new Map((payload?.shifts ?? []).map((shift) => [shift.id, shift])),
    [payload],
  );
  const jobProfileById = useMemo(
    () => new Map((payload?.jobProfiles ?? []).map((profile) => [profile.id, profile])),
    [payload],
  );
  const employeeById = useMemo(
    () => new Map(data.employees.map((employee) => [employee.id, employee])),
    [data.employees],
  );

  const gapCount = (payload?.coverage ?? []).filter((row) => row.gap > 0).length;
  const missingSlots = (payload?.coverage ?? []).reduce((sum, row) => sum + row.gap, 0);
  const pendingClaims = (payload?.claims ?? []).filter((claim) => claim.status === "pending").length;
  const availabilityConflicts = (payload?.coverage ?? []).reduce(
    (sum, row) => sum + row.unavailableScheduledHeadcount,
    0,
  );
  const capabilityConflicts = (payload?.coverage ?? []).reduce(
    (sum, row) => sum + row.capabilityIneligibleHeadcount,
    0,
  );
  const approvedLeaveConflicts = (payload?.coverage ?? []).reduce(
    (sum, row) => sum + row.approvedLeaveScheduledHeadcount,
    0,
  );
  const labor = payload?.laborVariance;

  return (
    <article className="card" style={{ marginTop: 16 }} data-wfm-coverage>
      <div className="card-header">
        <div>
          <div className="card-kicker">Coverage operations</div>
          <h2>Staff the work, not just the calendar.</h2>
          <p>
            Set minimum staffing by worksite, shift, and job profile; account for employee availability, expose role-specific roster gaps, and turn uncovered slots into auditable open shifts.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner label="Loading" /> : <RefreshCcw size={14} />} Refresh
        </button>
      </div>

      <section className="stats-grid" style={{ padding: "0 18px 18px" }}>
        <Metric label="Coverage gaps" value={String(gapCount)} hint={`${missingSlots} uncovered slot(s)`} icon={<CircleAlert size={16} />} tone={gapCount ? "amber" : "mint"} />
        <Metric
          label="Roster exclusions"
          value={String(availabilityConflicts + capabilityConflicts + approvedLeaveConflicts)}
          hint={availabilityConflicts + " unavailable · " + capabilityConflicts + " unqualified · " + approvedLeaveConflicts + " on leave"}
          icon={<CalendarClock size={16} />}
          tone={availabilityConflicts + capabilityConflicts + approvedLeaveConflicts ? "amber" : "slate"}
        />
        <Metric label="Open shifts" value={String((payload?.openShifts ?? []).filter((row) => row.status === "open").length)} hint="coverage recovery" icon={<UsersRound size={16} />} tone="blue" />
        <Metric label="Pending claims" value={String(pendingClaims)} hint="manager decision needed" icon={<UsersRound size={16} />} tone={pendingClaims ? "amber" : "slate"} />
      </section>

      <div className="setting-form" style={{ padding: "0 18px 18px" }}>
        <label>Coverage window<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
        <label>Window end<input value={endDate} readOnly /></label>
      </div>

      {labor && (
        <section style={{ padding: "0 18px 18px" }} data-wfm-labor-variance>
          <div className="card-header" style={{ paddingLeft: 0, paddingRight: 0 }}>
            <div>
              <div className="card-kicker">Required → scheduled → actual</div>
              <h3>Labor plan variance</h3>
              <p>Compare staffing demand, rostered capacity, and attendance actually worked for the same worksite and shift.</p>
            </div>
          </div>

          <section className="stats-grid" style={{ padding: 0, marginBottom: 14 }}>
            <Metric label="Required hours" value={hours(labor.summary.requiredHours)} hint="minimum staffing demand" icon={<UsersRound size={16} />} tone="slate" />
            <Metric label="Scheduled hours" value={hours(labor.summary.scheduledHours)} hint={`${signedHours(labor.summary.scheduledVsRequiredHours)} vs required`} icon={<CalendarClock size={16} />} tone={labor.summary.scheduledVsRequiredHours < 0 ? "amber" : "blue"} />
            <Metric label="Actual hours" value={hours(labor.summary.actualHours)} hint={`${signedHours(labor.summary.actualVsScheduledHours)} vs roster`} icon={<UsersRound size={16} />} tone={labor.summary.actualVsScheduledHours < 0 ? "amber" : "mint"} />
            <Metric label="Attendance exceptions" value={String(labor.summary.attendanceExceptionCount)} hint={`${labor.quality.unmatchedPunchRows} unmatched punch row(s)`} icon={<CircleAlert size={16} />} tone={labor.summary.attendanceExceptionCount ? "amber" : "mint"} />
          </section>

          {labor.costVisible ? (
            <div className="notice notice-slate" style={{ marginBottom: 14 }}>
              <span>
                <strong>Base labor cost:</strong> required {peso(labor.summary.requiredBaseCost)} · scheduled {peso(labor.summary.scheduledBaseCost)} · actual {peso(labor.summary.actualBaseCost)} · actual vs required {peso(labor.summary.actualVsRequiredBaseCost)}.
                {" "}{labor.costingBoundary}
              </span>
            </div>
          ) : (
            <div className="notice notice-slate" style={{ marginBottom: 14 }}>
              <span><strong>Labor-cost variance is restricted.</strong> WFM hours and coverage remain visible; pay-rate-derived cost needs People/Payroll access.</span>
            </div>
          )}

          {labor.quality.roleEvidenceIssues.length > 0 && (
            <div className="notice notice-amber" style={{ marginBottom: 14 }}>
              <CircleAlert size={15} />
              <span>
                <strong>Role evidence needs review.</strong> {labor.quality.roleEvidenceIssues.length} employee-day record(s) have ambiguous active job-profile evidence and are excluded from role-specific coverage until position assignments are resolved.
              </span>
            </div>
          )}

          {(labor.summary.unmatchedActualHours > 0 || labor.summary.scheduledOutsideRequirementHours > 0) && (
            <div className="notice notice-amber" style={{ marginBottom: 14 }}>
              <CircleAlert size={15} />
              <span>
                <strong>Variance evidence needs review.</strong> {hours(labor.summary.unmatchedActualHours)} actual labor could not be tied to a staffing requirement, and {hours(labor.summary.scheduledOutsideRequirementHours)} is scheduled outside recorded staffing requirements.
              </span>
            </div>
          )}

          <div className="data-table-wrap slim-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Worksite / shift</th>
                  <th>Required</th>
                  <th>Scheduled</th>
                  <th>Actual</th>
                  <th>Actual vs required</th>
                  <th>{labor.costVisible ? "Base cost variance" : "Evidence"}</th>
                </tr>
              </thead>
              <tbody>
                {labor.rows.map((row) => (
                  <tr key={row.requirementId}>
                    <td><strong>{row.workDate}</strong></td>
                    <td>
                      <strong>{worksiteById.get(row.worksiteId)?.name ?? `Site #${row.worksiteId}`}</strong>
                      <div className="id">{shiftById.get(row.shiftDefinitionId)?.code ?? `Shift #${row.shiftDefinitionId}`} · {row.jobProfileId ? jobProfileById.get(row.jobProfileId)?.title ?? `Profile #${row.jobProfileId}` : "Any role"}</div>
                    </td>
                    <td><strong>{row.requiredHeadcount}</strong><div className="id">{hours(row.requiredHours)}</div></td>
                    <td><strong>{row.scheduledHeadcount}</strong><div className="id">{hours(row.scheduledHours)} · {row.scheduledCoveragePercent}%</div></td>
                    <td><strong>{row.actualHeadcount}</strong><div className="id">{hours(row.actualHours)} · {row.actualCoveragePercent}%</div></td>
                    <td><Status value={signedHours(row.actualVsRequiredHours)} /></td>
                    <td>
                      {labor.costVisible
                        ? <><strong>{peso(row.actualVsRequiredBaseCost)}</strong><div className="id">actual {peso(row.actualBaseCost)}</div></>
                        : row.attendanceFlags.length
                          ? <Status value={`${row.attendanceFlags.length} flag(s)`} />
                          : <span className="id">Matched</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {canManage && (
        <section className="module-grid two" style={{ padding: "0 18px 18px" }}>
          <article className="card" style={{ margin: 0 }}>
            <div className="card-header">
              <div><div className="card-kicker">Demand</div><h3>Set required headcount</h3></div>
            </div>
            <div className="setting-form">
              <label>Date<input type="date" value={requirementDate} onChange={(event) => setRequirementDate(event.target.value)} /></label>
              <label>
                Worksite
                <select value={requirementWorksiteId} onChange={(event) => setRequirementWorksiteId(event.target.value)}>
                  {(payload?.worksites ?? []).map((site) => <option key={site.id} value={site.id}>{site.code} · {site.name}</option>)}
                </select>
              </label>
              <label>
                Shift
                <select value={requirementShiftId} onChange={(event) => setRequirementShiftId(event.target.value)}>
                  {(payload?.shifts ?? []).map((shift) => <option key={shift.id} value={shift.id}>{shift.code} · {shift.name}</option>)}
                </select>
              </label>
              <label>
                Job profile
                <select value={requirementJobProfileId} onChange={(event) => setRequirementJobProfileId(event.target.value)}>
                  <option value="">Any job profile</option>
                  {(payload?.jobProfiles ?? []).map((profile) => <option key={profile.id} value={profile.id}>{profile.title} · {profile.level}</option>)}
                </select>
              </label>
              <label>Required headcount<input type="number" min={1} max={10000} value={requiredHeadcount} onChange={(event) => setRequiredHeadcount(event.target.value)} /></label>
            </div>
            <div className="run-actions">
              <button className="primary-button brand" onClick={() => void saveRequirement()} disabled={saving !== null}>
                {saving === "create_requirement" ? <Spinner label="Saving" /> : <Plus size={14} />} Save requirement
              </button>
            </div>
          </article>

          <article className="card" style={{ margin: 0 }}>
            <div className="card-header">
              <div><div className="card-kicker">Availability</div><h3>Record recurring availability</h3></div>
            </div>
            <div className="setting-form">
              <label>
                Employee
                <select value={availabilityEmployeeId || ""} onChange={(event) => setAvailabilityEmployeeId(Number(event.target.value))}>
                  {data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNo} · {employee.firstName} {employee.lastName}</option>)}
                </select>
              </label>
              <label>
                Day
                <select value={availabilityWeekday} onChange={(event) => setAvailabilityWeekday(event.target.value)}>
                  {WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
                </select>
              </label>
              <label>From<input type="time" value={availabilityStart} onChange={(event) => setAvailabilityStart(event.target.value)} /></label>
              <label>To<input type="time" value={availabilityEnd} onChange={(event) => setAvailabilityEnd(event.target.value)} /></label>
              <label>
                Rule
                <select value={availabilityType} onChange={(event) => setAvailabilityType(event.target.value === "preferred" ? "preferred" : "unavailable")}>
                  <option value="unavailable">Unavailable</option>
                  <option value="preferred">Preferred</option>
                </select>
              </label>
              <label>Effective from<input type="date" value={availabilityFrom} onChange={(event) => setAvailabilityFrom(event.target.value)} /></label>
              <label>Effective until<input type="date" min={availabilityFrom} value={availabilityUntil} onChange={(event) => setAvailabilityUntil(event.target.value)} /></label>
            </div>
            <div className="run-actions">
              <button className="primary-button brand" onClick={() => void saveAvailability()} disabled={saving !== null}>
                {saving === "create_availability" ? <Spinner label="Saving" /> : <CalendarClock size={14} />} Save availability
              </button>
            </div>
          </article>
        </section>
      )}

      <div className="data-table-wrap slim-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Worksite / shift</th>
              <th>Required</th>
              <th>Scheduled</th>
              <th>Excluded</th>
              <th>Gap</th>
              <th>Recovery</th>
            </tr>
          </thead>
          <tbody>
            {(payload?.coverage ?? []).map((row) => (
              <tr key={row.requirementId}>
                <td><strong>{row.workDate}</strong></td>
                <td>
                  <strong>{worksiteById.get(row.worksiteId)?.name ?? `Site #${row.worksiteId}`}</strong>
                  <div className="id">{shiftById.get(row.shiftDefinitionId)?.code ?? `Shift #${row.shiftDefinitionId}`} · {row.jobProfileId ? jobProfileById.get(row.jobProfileId)?.title ?? `Profile #${row.jobProfileId}` : "Any role"}</div>
                </td>
                <td>{row.requiredHeadcount}</td>
                <td>{row.availableScheduledHeadcount}</td>
                <td>
                  {row.unavailableScheduledHeadcount ? <Status value={String(row.unavailableScheduledHeadcount) + " unavailable"} /> : null}
                  {row.capabilityIneligibleHeadcount ? <Status value={String(row.capabilityIneligibleHeadcount) + " unqualified"} /> : null}
                  {row.approvedLeaveScheduledHeadcount ? <Status value={String(row.approvedLeaveScheduledHeadcount) + " on leave"} /> : null}
                  {!row.unavailableScheduledHeadcount && !row.capabilityIneligibleHeadcount && !row.approvedLeaveScheduledHeadcount ? "0" : null}
                </td>
                <td>{row.gap ? <Status value={`${row.gap} short`} /> : row.overage ? <Status value={`+${row.overage} covered`} /> : <Status value="Covered" />}</td>
                <td>
                  {row.gap > 0 && canManage ? (
                    <button className="secondary-button" onClick={() => void openGap(row)} disabled={saving !== null}>
                      Open {row.gap} shift{row.gap === 1 ? "" : "s"}
                    </button>
                  ) : <span className="id">No action</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && (payload?.coverage.length ?? 0) === 0 && (
          <EmptyState icon={<UsersRound size={20} />} title="No staffing requirements in this window">
            Add required headcount for a worksite and shift to start measuring roster coverage.
          </EmptyState>
        )}
      </div>

      {(payload?.openShifts.length ?? 0) > 0 && (
        <div style={{ padding: 18 }}>
          <div className="card-kicker" style={{ marginBottom: 8 }}>Open shifts and claims</div>
          <div className="policy-lines">
            {(payload?.openShifts ?? []).map((shift) => {
              const claims = (payload?.claims ?? []).filter((claim) => claim.openShiftId === shift.id);
              return (
                <span key={shift.id}>
                  <b>{shift.workDate} · {worksiteById.get(shift.worksiteId)?.code ?? `Site #${shift.worksiteId}`} · {shiftById.get(shift.shiftDefinitionId)?.code ?? `Shift #${shift.shiftDefinitionId}`} · {shift.jobProfileId ? jobProfileById.get(shift.jobProfileId)?.title ?? `Profile #${shift.jobProfileId}` : "Any role"}</b>
                  <small style={{ display: "block", color: "var(--muted)" }}>
                    {shift.remainingSlots} of {shift.slots} slot(s) remaining · {shift.status} · {shift.reason}
                  </small>
                  {claims.map((claim) => {
                    const employee = employeeById.get(claim.employeeId);
                    return (
                      <small key={claim.id} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                        <strong>{employee ? `${employee.firstName} ${employee.lastName}` : `Employee #${claim.employeeId}`}</strong>
                        <Status value={claim.status} />
                        {claim.status === "pending" && canManage && (
                          <>
                            <button className="secondary-button" onClick={() => void decideClaim(claim.id, "approved")} disabled={saving !== null}>Approve</button>
                            <button className="secondary-button" onClick={() => void decideClaim(claim.id, "rejected")} disabled={saving !== null}>Reject</button>
                          </>
                        )}
                      </small>
                    );
                  })}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}
