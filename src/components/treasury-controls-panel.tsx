"use client";

import { useCallback, useEffect, useState } from "react";
import { Landmark, RefreshCw, Save, ShieldCheck } from "lucide-react";

type Candidate = {
  membershipId: number;
  userId: number;
  name: string;
  email: string;
  role: string;
};

type TreasuryPayload = {
  policy: {
    enabled: boolean;
    requireReleaseSubmitterSeparation: boolean;
    enabledAt: string | null;
  };
  candidates: Candidate[];
  operatorUserIds: number[];
  currentUserAssigned: boolean;
  canConfigure: boolean;
};

export function TreasuryControlsPanel({
  organizationId,
  setNotice,
}: {
  organizationId: number;
  setNotice: (message: string) => void;
}) {
  const [data, setData] = useState<TreasuryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [operatorUserIds, setOperatorUserIds] = useState<number[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/treasury-controls?organizationId=${organizationId}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load treasury controls.");
      setData(payload);
      setEnabled(Boolean(payload.policy?.enabled));
      setOperatorUserIds(Array.isArray(payload.operatorUserIds) ? payload.operatorUserIds.map(Number) : []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load treasury controls.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (enabled && operatorUserIds.length === 0) {
      setNotice("Assign at least one treasury operator before enabling separation.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/treasury-controls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "save-policy",
          enabled,
          requireReleaseSubmitterSeparation: true,
          operatorUserIds,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not save treasury controls.");
      setNotice(enabled
        ? "Treasury separation enabled. Payroll release and payout submission must use different people."
        : "Treasury separation disabled; legacy owner-only payout authorization applies.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save treasury controls.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="card" style={{ padding: 20, marginBottom: 16 }} data-treasury-controls>
      <div className="card-header">
        <div>
          <div className="card-kicker">TREASURY SEPARATION</div>
          <h2>Separate payroll release from money movement</h2>
          <p>Assign stable-user treasury operators. When enabled, the person who released a payroll cannot submit, retry, export its final bank file, or confirm that same payout.</p>
        </div>
        <div className="run-actions" style={{ margin: 0 }}>
          <button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
          <Landmark size={19} className="i-purple" />
        </div>
      </div>

      <div className="notice notice-slate" style={{ marginBottom: 14 }}>
        <ShieldCheck size={15} className="i-purple" />
        <span>Enabling this control preserves existing payroll checker/release rules. It adds a separate treasury boundary after release; permission sets can still deny payroll.disburse.</span>
      </div>

      <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={!data?.canConfigure}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span><strong>Require enterprise treasury separation</strong><br /><small>Release actor and payout operator must be different stable users.</small></span>
      </label>

      <div className="data-table-wrap">
        <table className="data-table">
          <thead><tr><th>TREASURY OPERATOR</th><th>BASE ROLE</th><th>ASSIGNED</th></tr></thead>
          <tbody>
            {(data?.candidates ?? []).map((candidate) => {
              const checked = operatorUserIds.includes(candidate.userId);
              return (
                <tr key={candidate.userId}>
                  <td><strong>{candidate.name}</strong><small style={{ display: "block", color: "var(--muted)" }}>{candidate.email}</small></td>
                  <td>{candidate.role}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!data?.canConfigure}
                      onChange={(event) => setOperatorUserIds((ids) =>
                        event.target.checked
                          ? [...new Set([...ids, candidate.userId])]
                          : ids.filter((id) => id !== candidate.userId)
                      )}
                      aria-label={`Assign ${candidate.name} as treasury operator`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data?.policy.enabledAt && (
        <p className="field-help" style={{ marginTop: 10 }}>
          Current separation policy enabled {new Date(data.policy.enabledAt).toLocaleString("en-PH")}. Payrolls released after this point require stable release-user evidence.
        </p>
      )}

      {data?.canConfigure ? (
        <div className="run-actions">
          <button type="button" className="primary-button" disabled={saving || loading} onClick={() => void save()}>
            <Save size={14} /> {saving ? "Saving…" : "Save treasury controls"}
          </button>
        </div>
      ) : (
        <div className="notice notice-blue" style={{ marginTop: 12 }}>
          <span>Only the workspace owner can change treasury assignments. Company-wide administrators and bookkeepers can view the policy.</span>
        </div>
      )}
    </article>
  );
}
