"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCcw, ShieldCheck } from "lucide-react";
import type { ManagerReceiptDay, ManagerReceiptSummary, ManagerReceiptAccount } from "@/lib/workforce-schedule-receipt-review";
import { Status } from "./ui";

type ReceiptView = {
  employee: { employeeNo: string; name: string };
  account: ManagerReceiptAccount;
  days: ManagerReceiptDay[];
  summary: ManagerReceiptSummary | null;
  boundary: string;
};
type Employee = { id: number; employeeNo: string; name: string };

function formatManila(value: string) {
  const instant = new Date(value);
  return Number.isFinite(instant.getTime())
    ? new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short",
    }).format(instant) : "Timestamp unavailable";
}

function validView(value: unknown, employee: Employee): value is ReceiptView {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<ReceiptView>;
  if (result.employee?.employeeNo !== employee.employeeNo ||
    result.employee?.name !== employee.name ||
    !["ready", "not_enrolled", "identity_review"].includes(result.account ?? "") ||
    typeof result.boundary !== "string") return false;
  if (result.account !== "ready") return Array.isArray(result.days) &&
    result.days.length === 0 && result.summary === null;
  if (!Array.isArray(result.days) || result.days.length !== 7 || !result.summary) return false;
  const validStates = ["acknowledged", "pending", "changed", "unavailable"];
  if (result.days.some(day =>
    !/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !validStates.includes(day.state) ||
    (day.state === "acknowledged" && (typeof day.acknowledgedAt !== "string" ||
      !Number.isFinite(Date.parse(day.acknowledgedAt)))) ||
    (day.state !== "acknowledged" && day.acknowledgedAt !== null))) return false;
  return result.summary.acknowledged + result.summary.pending +
    result.summary.changed + result.summary.unavailable === 7;
}

export function WorkforceScheduleReceiptReview({
  organizationId,
  employee,
  onClose,
}: {
  organizationId: number;
  employee: Employee;
  onClose: () => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const [snapshot, setSnapshot] = useState<{ scope: string; value: ReceiptView } | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const [loadingScope, setLoadingScope] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const scope = JSON.stringify([organizationId, employee.id, employee.employeeNo, employee.name]);

  const load = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoadingScope(scope);
    setFailure(null);
    try {
      const params = new URLSearchParams({
        organizationId: String(organizationId),
        employeeId: String(employee.id),
      });
      const response = await fetch("/api/workforce/schedule-receipt-review?" + params, {
        cache: "no-store", signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(response.status === 403
          ? "People access or employee scope was denied."
          : response.status === 404
            ? "Schedule receipt review is unavailable for this employer."
            : "Current schedule receipt status could not be verified.");
      }
      if (!validView(body, employee)) {
        throw new Error("The receipt review source returned incomplete evidence.");
      }
      if (pending.current !== controller || controller.signal.aborted) return;
      setSnapshot({ scope, value: body });
      setFailure(null);
    } catch (error) {
      if (pending.current !== controller || controller.signal.aborted) return;
      setSnapshot(null);
      setFailure({ scope, message: error instanceof Error ? error.message : "Receipt review unavailable." });
    } finally {
      if (pending.current === controller && !controller.signal.aborted) {
        setLoadingScope(null);
      }
    }
  }, [organizationId, employee.id, employee.employeeNo, employee.name, scope]);

  useEffect(() => {
    void load();
    return () => pending.current?.abort();
  }, [load, refresh]);

  const value = snapshot?.scope === scope ? snapshot.value : null;
  const error = failure?.scope === scope ? failure.message : "";
  const busy = loadingScope === scope;

  return (
    <article className="card" data-wfm-manager-schedule-receipts style={{ marginTop: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">Employee schedule visibility · read only</div>
          <h2>Schedule acknowledgments · {employee.name}</h2>
          <p>Current seven Philippine work dates. This is independent of the historical week selected in the roster above.</p>
        </div>
        <div className="run-actions" style={{ gap: 8 }}>
          <button type="button" className="secondary-button" onClick={() => setRefresh(n => n + 1)}
            disabled={busy}><RefreshCcw size={15} aria-hidden="true" /> Refresh</button>
          <button type="button" className="secondary-button" onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="notice notice-slate" style={{ margin: "0 18px 16px" }}>
        <ShieldCheck size={16} aria-hidden="true" />
        <span>An acknowledgment means an employee saw a specific version of a schedule. Missing or outdated acknowledgment does not establish absence, lateness, consent to changes, or a payroll exception.</span>
      </div>
      {busy && <p role="status" style={{ padding: "0 18px 16px" }}>Checking current employee schedule and receipt records…</p>}
      {error && <div className="notice notice-amber" role="alert" style={{ margin: "0 18px 16px" }}>{error}</div>}
      {value?.account === "not_enrolled" && <div className="notice notice-slate" style={{ margin: "0 18px 16px" }}>
        This employee does not have one active employee self-service sign-in. A missing receipt must not be treated as noncompliance.
      </div>}
      {value?.account === "identity_review" && <div className="notice notice-amber" style={{ margin: "0 18px 16px" }}>
        Multiple active employee sign-ins need an HR identity review before receipt status can be interpreted.
      </div>}
      {value?.account === "ready" && value.summary && (
        <>
          <div className="stats-grid" style={{ padding: "0 18px 16px" }}>
            <div className="metric"><div className="metric-label">Seen current schedule</div><strong>{value.summary.acknowledged}</strong></div>
            <div className="metric"><div className="metric-label">Not yet acknowledged</div><strong>{value.summary.pending}</strong></div>
            <div className="metric"><div className="metric-label">Schedule changed</div><strong>{value.summary.changed}</strong></div>
            <div className="metric"><div className="metric-label">Needs source review</div><strong>{value.summary.unavailable}</strong></div>
          </div>
          <div className="data-table-wrap slim-scroll">
            <table className="data-table" aria-label="Employee current schedule acknowledgment status">
              <thead><tr><th scope="col">Work date</th><th scope="col">Receipt state</th><th scope="col">Current version last acknowledged</th></tr></thead>
              <tbody>{value.days.map(day => <tr key={day.date}>
                <td>{day.date}</td>
                <td><Status value={
                  day.state === "acknowledged" ? "Acknowledged" :
                    day.state === "changed" ? "Changed schedule" :
                      day.state === "unavailable" ? "Schedule needs review" : "Not yet acknowledged"
                } /></td>
                <td>{day.acknowledgedAt ? formatManila(day.acknowledgedAt) : "—"}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </>
      )}
    </article>
  );
}
