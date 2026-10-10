"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, Check, Clock3, Clock, Download, Search, Timer } from "lucide-react";
import { AttendanceCorrectionsPanel } from "./attendance-corrections-panel";
import { AttendanceExceptionsPanel } from "./attendance-exceptions-panel";
import type { DashboardData, Notify, Punch } from "./types";
import { Avatar, EmptyState, Metric, PageHeading, Progress, Segmented, Status, formatDate, formatTimeOnly } from "./ui";

/** A punch counts as complete only when both ends exist. Nothing is inferred. */
const isComplete = (punch: Punch) => Boolean(punch.timeIn && punch.timeOut);

export function TimeView({
  data,
  onOpenBundy,
  notify,
  canManage = true,
  taskFilter,
  taskSequence,
}: {
  data: DashboardData;
  onOpenBundy: () => void;
  notify: Notify;
  canManage?: boolean;
  taskFilter?: "attendance-exceptions";
  taskSequence?: number;
}) {
  const punches = useMemo(() => data.punches ?? [], [data.punches]);
  const [view, setView] = useState<"all" | "incomplete">("all");
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (taskSequence === undefined) return;
    setView(taskFilter === "attendance-exceptions" ? "incomplete" : "all");
    setQuery("");
  }, [taskSequence, taskFilter]);

  const stats = useMemo(() => {
    const complete = punches.filter(isComplete);
    const incomplete = punches.filter((punch) => !isComplete(punch));
    const byStatus = new Map<string, number>();
    for (const punch of punches) byStatus.set(punch.status, (byStatus.get(punch.status) ?? 0) + 1);
    const peopleWithPunches = new Set(punches.map((punch) => punch.employeeId)).size;
    return { complete, incomplete, byStatus, peopleWithPunches };
  }, [punches]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return punches
      .filter((punch) => (view === "incomplete" ? !isComplete(punch) : true))
      .map((punch) => ({ punch, employee: data.employees.find((person) => person.id === punch.employeeId) }))
      .filter(({ punch, employee }) => {
        if (!needle) return true;
        return `${employee?.firstName ?? ""} ${employee?.lastName ?? ""} ${employee?.employeeNo ?? ""} ${punch.status}`
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => b.punch.workDate.localeCompare(a.punch.workDate) || b.punch.id - a.punch.id);
  }, [punches, data.employees, view, query]);
  const rows = filtered.slice(0, 60);

  const completionPercent = punches.length ? (stats.complete.length / punches.length) * 100 : 0;

  return (
    <>
      <PageHeading
        eyebrow="Time &amp; attendance"
        title="Attendance"
        copy="Review time records, resolve missing punches and check payroll exceptions."
        actions={
          canManage ? (
            <>
              <button className="secondary-button" onClick={onOpenBundy}>
                <Clock size={15} className="i-cyan" /> Web bundy
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  window.open(`/api/exports?organizationId=${data.selectedOrganization.id}&kind=all`, "_blank", "noopener");
                  notify("Punch data is included in the full company export, the download is audit-logged.", "info");
                }}
              >
                <Download size={15} className="i-teal" /> Export data
              </button>
            </>
          ) : undefined
        }
      />

      <section className="stats-grid">
        <Metric
          label="Punches on file"
          value={String(punches.length)}
          hint={`${stats.peopleWithPunches} employee${stats.peopleWithPunches === 1 ? "" : "s"} with records`}
          icon={<Clock3 size={16} className="i-cyan" />}
          tone="blue"
        />
        <Metric
          label="Complete pairs"
          value={String(stats.complete.length)}
          hint={punches.length ? `${Math.round(completionPercent)}% of all punches` : "no punches yet"}
          icon={<Check size={16} className="i-green" />}
          tone="mint"
        />
        <Metric
          label="Incomplete"
          value={String(stats.incomplete.length)}
          hint="derive zero hours until corrected"
          icon={<AlertTriangle size={16} className="i-red" />}
          tone={stats.incomplete.length ? "amber" : "slate"}
        />
        <Metric
          label="Live run exceptions"
          value={String(data.payrollEntries.filter((entry) => entry.status === "Exception").length)}
          hint="flagged during calculation"
          icon={<Timer size={16} className="i-cyan" />}
          tone={data.payrollEntries.some((entry) => entry.status === "Exception") ? "red" : "slate"}
        />
      </section>

      <article className="card table-card" style={{ marginTop: 16 }}>
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={15} className="i-slate" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search punches by person or status"
              aria-label="Search punches"
            />
          </div>
          <div className="toolbar-spacer" />
          <Segmented
            label="Punch filter"
            value={view}
            onChange={setView}
            options={[
              { value: "all", label: `All (${punches.length})` },
              { value: "incomplete", label: `Incomplete (${stats.incomplete.length})` },
            ]}
          />
        </div>

        <div className="data-table-wrap slim-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Work date</th>
                <th>Time in</th>
                <th>Time out</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ punch, employee }) => (
                <tr key={punch.id}>
                  <td>
                    <div className="person-cell">
                      <Avatar initials={employee?.avatarInitials ?? "??"} index={punch.employeeId} />
                      <div>
                        <strong>{employee ? `${employee.firstName} ${employee.lastName}` : `Employee #${punch.employeeId}`}</strong>
                        <span>
                          <span className="id">{employee?.employeeNo ?? "-"}</span>
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                      <CalendarDays size={13} style={{ color: "var(--muted-light)" }} />
                      {formatDate(punch.workDate)}
                    </span>
                  </td>
                  <td className="num">{formatTimeOnly(punch.timeIn)}</td>
                  <td className="num">{formatTimeOnly(punch.timeOut)}</td>
                  <td>
                    <Status value={isComplete(punch) ? punch.status : "Incomplete punch"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {rows.length === 0 && (
            <EmptyState icon={<Search size={20} className="i-slate" />} title={punches.length ? "Nothing matches" : "No punches yet"}>
              {punches.length
                ? "Clear the search or switch back to all punches."
                : "Capture time through the web bundy or sync a biometric device."}
            </EmptyState>
          )}
          {rows.length === 0 && (query || view !== "all") && <div className="empty-state-action"><button type="button" className="secondary-button" onClick={() => { setQuery(""); setView("all"); }}>Clear filters</button></div>}
        </div>

        {rows.length > 0 && (
          <div className="pagination">
            <span>
              Showing <span className="mono">{rows.length}</span> of <span className="mono">{filtered.length}</span> matching punches{filtered.length !== punches.length ? ` (${punches.length} total)` : ""},
              newest first
            </span>
          </div>
        )}
      </article>

      <section className="module-grid two" style={{ marginTop: 0 }}>
        <article className="card time-summary">
          <div className="card-header">
            <div>
              <div className="card-kicker">Punch completeness</div>
              <h2>Derived from {punches.length} stored punch{punches.length === 1 ? "" : "es"}</h2>
              <p>Grouped by the status the server assigned at capture time.</p>
            </div>
          </div>

          {punches.length === 0 ? (
            <EmptyState icon={<Clock3 size={20} className="i-cyan" />} title="No punches captured">
              Punches arrive from the web bundy or a biometric device sync. Payroll derives hours only from what is
              actually recorded.
            </EmptyState>
          ) : (
            <div className="time-bars">
              {[...stats.byStatus.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([status, value]) => (
                  <div className="time-bar" key={status}>
                    <div>
                      <strong>{status}</strong>
                      <span>
                        {value} · {Math.round((value / punches.length) * 100)}%
                      </span>
                    </div>
                    <Progress percent={(value / punches.length) * 100} tone={toneForStatus(status)} />
                  </div>
                ))}
            </div>
          )}

          <div className="notice notice-amber" style={{ margin: "0 18px 16px" }}>
            <Clock3 size={15} className="i-cyan" />
            <span>
              A missing IN or OUT punch derives <strong>zero</strong> hours and raises an exception. No phantom time is ever
              manufactured to fill a gap.
            </span>
          </div>
        </article>

        <article className="card">
          <div className="card-header">
            <div>
              <div className="card-kicker">Shift policy</div>
              <h2>How hours are derived</h2>
              <p>These rules live in the payroll engine and are unit-tested.</p>
            </div>
            <Status value="Active" />
          </div>
          <div className="policy-lines">
            <span>
              <b>Standard shift 09:00–18:00</b>
              <small style={{ display: "block", color: "var(--muted)" }}>8 paid hours with a 60-minute unpaid break</small>
            </span>
            <span>
              <b>Tardiness from the grace period</b>
              <small style={{ display: "block", color: "var(--muted)" }}>Late minutes deduct against the hourly rate</small>
            </span>
            <span>
              <b>Overtime at 125%</b>
              <small style={{ display: "block", color: "var(--muted)" }}>Minutes beyond the shift, computed per punch pair</small>
            </span>
            <span>
              <b>Night differential 22:00–06:00 at +10%</b>
              <small style={{ display: "block", color: "var(--muted)" }}>Applied across midnight boundaries</small>
            </span>
            <span>
              <b>Holiday and rest-day stacking</b>
              <small style={{ display: "block", color: "var(--muted)" }}>
                Punch dates matched against the 2026 holiday calendar
              </small>
            </span>
          </div>
        </article>
      </section>

      <AttendanceExceptionsPanel
        organizationId={data.selectedOrganization.id}
        notify={notify}
      />

      <AttendanceCorrectionsPanel
        organizationId={data.selectedOrganization.id}
        punches={punches}
        employees={data.employees}
        notify={notify}
        canManage={canManage}
        canDecide={["owner", "admin", "bookkeeper", "hr", "manager"].includes(data.access?.role ?? "")}
        currentUserId={data.user?.id ?? null}
      />


    </>
  );
}

function toneForStatus(status: string): "amber" | "blue" | "red" | undefined {
  const lower = status.toLowerCase();
  if (lower.includes("incomplete") || lower.includes("missing")) return "red";
  if (lower.includes("late") || lower.includes("tardy") || lower.includes("undertime")) return "amber";
  if (lower.includes("overtime") || lower.includes("night")) return "blue";
  return undefined;
}
