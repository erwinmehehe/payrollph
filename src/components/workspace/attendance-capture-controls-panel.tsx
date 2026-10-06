"use client";

import { useCallback, useEffect, useState } from "react";
import { Laptop, Save, ShieldCheck, Smartphone } from "lucide-react";
import type { Notify } from "./types";
import { Spinner } from "./ui";

type Policy = {
  webBundyEnabled: boolean;
  mobileClockEnabled: boolean;
  kioskClockEnabled: boolean;
  offlineSyncEnabled: boolean;
  requireLocation: boolean;
  maxOfflineAgeMinutes: number;
};

export function AttendanceCaptureControlsPanel({
  organizationId,
  notify,
  canManage,
}: {
  organizationId: number;
  notify: Notify;
  canManage: boolean;
}) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/workforce/attendance-capture?organizationId=${organizationId}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not load attendance capture controls.");
      setPolicy(body.policy as Policy);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load attendance capture controls.", "err");
    }
  }, [notify, organizationId]);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!policy || !canManage) return;
    setBusy(true);
    try {
      const response = await fetch("/api/workforce/attendance-capture", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, ...policy }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Attendance capture controls could not be saved.");
      setPolicy(body.policy as Policy);
      notify("Attendance capture controls saved.", "ok");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Attendance capture controls could not be saved.", "err");
    } finally {
      setBusy(false);
    }
  }

  if (!policy) return null;

  const toggle = (key: keyof Pick<Policy, "webBundyEnabled" | "mobileClockEnabled" | "kioskClockEnabled" | "offlineSyncEnabled" | "requireLocation">) => (
    <input
      type="checkbox"
      checked={policy[key]}
      disabled={!canManage}
      onChange={(event) => setPolicy((current) => current ? { ...current, [key]: event.target.checked } : current)}
    />
  );

  return (
    <article className="card" style={{ marginTop: 16 }} data-wfm-attendance-capture-controls>
      <div className="card-header">
        <div>
          <div className="card-kicker">Attendance capture controls</div>
          <h2>Govern browser, mobile, kiosk and offline punches.</h2>
          <p>Offline events are replay-safe and preserve the original occurrence time. Kiosks require a registered device credential.</p>
        </div>
        {canManage && (
          <button className="secondary-button" onClick={() => void save()} disabled={busy}>
            {busy ? <Spinner label="Saving" /> : <Save size={14} />} Save controls
          </button>
        )}
      </div>

      <div className="setting-form" style={{ padding: "0 18px 18px" }}>
        <label><span><Laptop size={14} /> Web Bundy</span>{toggle("webBundyEnabled")}</label>
        <label><span><Smartphone size={14} /> Mobile clock</span>{toggle("mobileClockEnabled")}</label>
        <label><span><Laptop size={14} /> Registered kiosk</span>{toggle("kioskClockEnabled")}</label>
        <label><span><ShieldCheck size={14} /> Offline synchronization</span>{toggle("offlineSyncEnabled")}</label>
        <label><span><ShieldCheck size={14} /> Require location evidence</span>{toggle("requireLocation")}</label>
        <label>
          Maximum offline age (minutes)
          <input
            type="number"
            min={15}
            max={10080}
            value={policy.maxOfflineAgeMinutes}
            disabled={!canManage}
            onChange={(event) => setPolicy((current) => current ? { ...current, maxOfflineAgeMinutes: Number(event.target.value) } : current)}
          />
        </label>
      </div>
      <div className="notice notice-slate" style={{ margin: "0 18px 18px" }}>
        <ShieldCheck size={15} />
        <span>Hardware acceptance remains a certification step. Enabling kiosk capture does not claim a device model is certified for production use.</span>
      </div>
    </article>
  );
}
