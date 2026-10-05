"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import type { ScheduleGuardrailPolicy } from "@/lib/workforce-schedule-guardrails";
import type { DashboardData, Notify } from "./types";
import { Spinner, Status } from "./ui";

export function WorkforceScheduleGuardrailsPanel({
  data,
  notify,
  canManage,
  onSaved,
}: {
  data: DashboardData;
  notify: Notify;
  canManage: boolean;
  onSaved?: () => void;
}) {
  const organizationId = data.selectedOrganization.id;
  const [policy, setPolicy] = useState<ScheduleGuardrailPolicy | null>(null);
  const [configured, setConfigured] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/workforce/schedule-guardrails?organizationId=${organizationId}`,
      { cache: "no-store" },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Could not load schedule guardrails.");
    setPolicy(body.policy as ScheduleGuardrailPolicy);
    setConfigured(Boolean(body.configured));
  }, [organizationId]);

  useEffect(() => {
    void load().catch((error) => {
      notify(error instanceof Error ? error.message : "Could not load schedule guardrails.", "err");
    });
  }, [load, notify]);

  async function save() {
    if (!policy) return;
    setSaving(true);
    try {
      const response = await fetch("/api/workforce/schedule-guardrails", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "update_policy",
          ...policy,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not save schedule guardrails.");
      setPolicy(body.policy as ScheduleGuardrailPolicy);
      setConfigured(true);
      notify("WFM schedule guardrails saved.", "ok");
      onSaved?.();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save schedule guardrails.", "err");
    } finally {
      setSaving(false);
    }
  }

  if (!policy) return null;

  const editable = canManage && data.access?.companyWide === true;

  return (
    <article className="card" style={{ marginTop: 16 }} data-wfm-schedule-guardrails>
      <div className="card-header">
        <div>
          <div className="card-kicker">Schedule safety policy</div>
          <h2>WFM guardrails</h2>
          <p>
            Detect overlapping work, short rest between scheduled blocks, long working-day streaks, and high rolling 7-day scheduled hours.
            Thresholds are company policy controls, not universal statutory entitlements.
          </p>
        </div>
        <Status value={policy.active ? (policy.enforcementMode === "block" ? "Blocking" : "Advisory") : "Inactive"} />
      </div>

      <div className="setting-form" style={{ padding: "0 18px 18px" }}>
        <label>
          Minimum rest minutes
          <input
            type="number"
            min={0}
            max={1440}
            step={30}
            disabled={!editable}
            value={policy.minimumRestMinutes}
            onChange={(event) => setPolicy((current) => current && ({
              ...current,
              minimumRestMinutes: Number(event.target.value),
            }))}
          />
          <small>0 disables this threshold.</small>
        </label>
        <label>
          Max consecutive working days
          <input
            type="number"
            min={0}
            max={31}
            disabled={!editable}
            value={policy.maxConsecutiveWorkingDays}
            onChange={(event) => setPolicy((current) => current && ({
              ...current,
              maxConsecutiveWorkingDays: Number(event.target.value),
            }))}
          />
          <small>0 disables this threshold.</small>
        </label>
        <label>
          Rolling 7-day scheduled minutes
          <input
            type="number"
            min={0}
            max={10080}
            step={60}
            disabled={!editable}
            value={policy.rollingSevenDayMinutes}
            onChange={(event) => setPolicy((current) => current && ({
              ...current,
              rollingSevenDayMinutes: Number(event.target.value),
            }))}
          />
          <small>Example: 2880 = 48 hours. 0 disables this threshold.</small>
        </label>
        <label>
          Enforcement
          <select
            disabled={!editable}
            value={policy.enforcementMode}
            onChange={(event) => setPolicy((current) => current && ({
              ...current,
              enforcementMode: event.target.value === "block" ? "block" : "advisory",
            }))}
          >
            <option value="advisory">Advisory: warn but allow</option>
            <option value="block">Block policy breaches</option>
          </select>
        </label>
        <label>
          Guardrails
          <select
            disabled={!editable}
            value={policy.active ? "active" : "inactive"}
            onChange={(event) => setPolicy((current) => current && ({
              ...current,
              active: event.target.value === "active",
            }))}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive except overlap protection</option>
          </select>
        </label>
      </div>

      <div className="notice notice-amber" style={{ margin: "0 18px 18px" }}>
        <ShieldAlert size={15} />
        <span>
          Overlapping scheduled intervals are always blocked. Other thresholds only block changes when enforcement is set to Blocking.
          {!configured ? " No company thresholds have been configured yet." : ""}
        </span>
      </div>

      {editable && (
        <div className="run-actions" style={{ padding: "0 18px 18px" }}>
          <button className="primary-button brand" onClick={() => void save()} disabled={saving}>
            {saving ? <Spinner label="Saving" /> : <ShieldAlert size={14} />} Save guardrails
          </button>
        </div>
      )}
    </article>
  );
}
