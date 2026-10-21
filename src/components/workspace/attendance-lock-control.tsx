"use client";

import { useCallback, useMemo, useState } from "react";
import { LockKeyhole, ShieldCheck, UnlockKeyhole } from "lucide-react";
import type { Notify } from "./types";
import { ErrorState, Spinner, Status } from "./ui";
import { useScopedAsyncResource } from "./use-scoped-async-resource";
import { readVerifiedAttendanceLocks, type AttendanceLockRow as LockRow } from "@/lib/attendance-lock-read";

export function AttendanceLockControl({
  organizationId,
  startDate,
  endDate,
  notify,
}: {
  organizationId: number;
  startDate: string;
  endDate: string;
  notify: Notify;
}) {
  const [reason, setReason] = useState("Attendance cutoff review complete");
  const [busy, setBusy] = useState(false);

  const fetchLocks = useCallback((signal: AbortSignal) =>
    readVerifiedAttendanceLocks(organizationId, fetch, signal), [organizationId]);
  const { data: payload, error: loadError, loading, reload: load } =
    useScopedAsyncResource(String(organizationId), fetchLocks);

  const coveringLocks = useMemo(
    () => (payload?.locks ?? []).filter((row) =>
      row.status === "locked"
      && row.periodStart <= startDate
      && row.periodEnd >= endDate
    ),
    [endDate, payload, startDate],
  );
  const attendanceLock = coveringLocks.find((row) => row.lockType === "attendance") ?? null;
  const cutoffLock = coveringLocks.find((row) => row.lockType === "payroll_cutoff") ?? null;

  async function mutate(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch("/api/workforce/attendance-locks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, ...body }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Attendance lock update failed.");
      await load();
      notify("Attendance change was accepted. Review the refreshed lock state before taking further action.", "info");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Attendance lock update failed.", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card" style={{ marginTop: 14 }}>
      <div className="table-toolbar" style={{ border: 0, padding: 0 }}>
        <div>
          <div className="card-kicker">Cutoff control</div>
          <h3 style={{ margin: "3px 0 0" }}>Attendance period locks</h3>
          <div className="id" style={{ marginTop: 4 }}>
            Capture locks stop new clock/device writes. Payroll-cutoff locks also freeze governed corrections.
          </div>
        </div>
        <div className="toolbar-spacer" />
        <Status value={loading ? "Loading locks" : !payload || loadError ? "Lock status unavailable" : cutoffLock ? "Payroll cutoff locked" : attendanceLock ? "Capture locked" : "Open"} />
      </div>

      {!loading && !payload && (
        <ErrorState
          title="Attendance lock status unavailable"
          detail="Period lock settings could not be verified. No locks were changed."
          onRetry={() => void load()}
        />
      )}

      {payload && !payload.canManage && (
        <div className="notice notice-slate" style={{ margin: "12px 0 0" }}>
          <ShieldCheck size={14} className="i-green" />
          <span>Lock status is visible here. Company-wide People or Payroll access is required to change period locks.</span>
        </div>
      )}

      {payload?.canManage && <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1fr) auto auto", gap: 10, alignItems: "end", marginTop: 12 }}>
        <label className="id" style={{ display: "grid", gap: 5 }}>
          Reason
          <input
            value={reason}
            maxLength={240}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why this period is being locked"
          />
        </label>
        <button
          className="secondary-button"
          disabled={busy || Boolean(attendanceLock) || !startDate || !endDate}
          onClick={() => void mutate({
            action: "lock_period",
            lockType: "attendance",
            periodStart: startDate,
            periodEnd: endDate,
            reason,
          })}
        >
          {busy ? <Spinner label="Saving" /> : <LockKeyhole size={14} />} Lock capture
        </button>
        <button
          className="primary-button"
          disabled={busy || Boolean(cutoffLock) || !startDate || !endDate}
          onClick={() => void mutate({
            action: "lock_period",
            lockType: "payroll_cutoff",
            periodStart: startDate,
            periodEnd: endDate,
            reason,
          })}
        >
          {busy ? <Spinner label="Saving" /> : <ShieldCheck size={14} />} Lock payroll cutoff
        </button>
      </div>}

      {payload?.canManage && (attendanceLock || cutoffLock) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {[attendanceLock, cutoffLock].filter((row): row is LockRow => Boolean(row)).map((row) => (
            <button
              className="secondary-button"
              key={row.id}
              disabled={busy}
              onClick={() => void mutate({
                action: "unlock_period",
                lockId: row.id,
                unlockReason: reason || "Attendance period reopened for governed correction",
              })}
            >
              <UnlockKeyhole size={14} /> Unlock {row.lockType === "payroll_cutoff" ? "cutoff" : "capture"}
            </button>
          ))}
        </div>
      )}

      {payload?.canManage && <label className="notice notice-slate" style={{ margin: "12px 0 0", display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={Boolean(payload?.policy.requirePayrollCutoffLock)}
          disabled={busy}
          onChange={(event) => void mutate({
            action: "set_policy",
            requirePayrollCutoffLock: event.target.checked,
          })}
        />
        <span>
          Require an active payroll-cutoff lock before payroll calculation.
        </span>
      </label>}
    </article>
  );
}
