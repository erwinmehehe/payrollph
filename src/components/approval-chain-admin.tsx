"use client";

import { useCallback, useEffect, useState } from "react";
import { GitBranch, Plus, RefreshCw, Save, ShieldCheck, Trash2 } from "lucide-react";

type ChainStep = {
  label: string;
  approver: string;
  dueLabel?: string;
  priority?: string;
  minimumAmount?: number;
  dynamicGroupCode?: string;
};

type ChainPolicy = {
  id: number;
  code: string;
  name: string;
  purpose: string;
  version: number;
  steps: unknown;
  active: boolean;
};

function normalizedSteps(value: unknown): ChainStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const row = raw as Record<string, unknown>;
    const label = String(row.label ?? "");
    const approver = String(row.approver ?? "");
    if (!label || !approver) return [];
    return [{
      label,
      approver,
      dueLabel: String(row.dueLabel ?? "Review required"),
      priority: String(row.priority ?? "Normal"),
      minimumAmount: Number(row.minimumAmount ?? 0),
      dynamicGroupCode: String(row.dynamicGroupCode ?? ""),
    }];
  });
}

export function ApprovalChainAdmin({
  organizationId,
  setNotice,
  onChanged,
}: {
  organizationId: number;
  setNotice: (message: string) => void;
  onChanged?: () => void | Promise<void>;
}) {
  const [policies, setPolicies] = useState<ChainPolicy[]>([]);
  const [dynamicGroups, setDynamicGroups] = useState<Array<{ id: number; code: string; name: string; version: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState<"automation" | "workforce_plan">("automation");
  const [steps, setSteps] = useState<ChainStep[]>([
    { label: "Primary approval", approver: "People Ops", dueLabel: "Review required", priority: "Normal", minimumAmount: 0 },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/approval-chains?organizationId=${organizationId}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load approval chains.");
      setPolicies(Array.isArray(payload.policies) ? payload.policies : []);
      setDynamicGroups(Array.isArray(payload.dynamicGroups) ? payload.dynamicGroups : []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load approval chains.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  function reset() {
    setEditingId(null);
    setCode("");
    setName("");
    setPurpose("automation");
    setSteps([{ label: "Primary approval", approver: "People Ops", dueLabel: "Review required", priority: "Normal", minimumAmount: 0 }]);
  }

  function edit(policy: ChainPolicy) {
    setEditingId(policy.id);
    setCode(policy.code);
    setName(policy.name);
    setPurpose(policy.purpose === "workforce_plan" ? "workforce_plan" : "automation");
    const parsed = normalizedSteps(policy.steps);
    setSteps(parsed.length ? parsed : [{ label: "Primary approval", approver: "People Ops", dueLabel: "Review required", priority: "Normal", minimumAmount: 0 }]);
  }

  async function save() {
    const thresholdsValid = steps.every((step, index) => {
      const current = Number(step.minimumAmount ?? 0);
      const previous = index === 0 ? 0 : Number(steps[index - 1]?.minimumAmount ?? 0);
      return Number.isFinite(current) && current >= 0 && (index === 0 ? current === 0 : current >= previous);
    });
    if (!code.trim() || !name.trim() || steps.some((step) => !step.label.trim() || !step.approver.trim()) || !thresholdsValid) {
      setNotice("Approval-chain code, name, approvers, and non-decreasing amount thresholds are required. Step 1 must start at PHP 0.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/approval-chains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "save-policy",
          id: editingId,
          code,
          name,
          purpose,
          steps,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not save approval chain.");
      setNotice(`${payload.name} saved as approval-chain version ${payload.version}.`);
      reset();
      await load();
      await onChanged?.();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save approval chain.");
    } finally {
      setSaving(false);
    }
  }

  async function setActive(policy: ChainPolicy, active: boolean) {
    try {
      const response = await fetch("/api/approval-chains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "set-active",
          id: policy.id,
          active,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not update approval chain.");
      await load();
      await onChanged?.();
      setNotice(`${policy.name} ${active ? "enabled" : "disabled"}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update approval chain.");
    }
  }

  return (
    <article className="card" style={{ marginTop: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">APPROVAL ROUTING</div>
          <h2>Configurable approval chains</h2>
          <p>Ordered approvers, amount thresholds and optional Dynamic Group IDs/versions are frozen when a request starts. A group restriction narrows the existing approver and is checked live at the decision.</p>
        </div>
        <div className="run-actions" style={{ margin: 0 }}>
          <button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
          <GitBranch size={18} className="i-purple" />
        </div>
      </div>

      <div className="card-body">
        <div className="notice notice-slate" style={{ marginBottom: 14 }}>
          <ShieldCheck size={15} className="i-purple" />
          <span>Chain changes require company-wide admin, MFA, same-origin, rate-limit, and audit controls. Steps keep their named approver or role:hr, role:finance, role:manager or role:owner authority. An optional Dynamic Group adds a live worker-membership requirement; it never grants approvals or bypasses delegation, maker-checker or payroll controls. Group identity and version are frozen when a request starts.</span>
        </div>

        <div className="setting-form">
          <label>Chain code
            <input
              value={code}
              disabled={editingId !== null}
              onChange={(event) => setCode(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
              placeholder="people-change"
            />
          </label>
          <label>Chain name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="People change approval" />
          </label>
          <label>Business process
            <select value={purpose} onChange={(event) => setPurpose(event.target.value === "workforce_plan" ? "workforce_plan" : "automation")}>
              <option value="automation">Automation</option>
              <option value="workforce_plan">Workforce planning</option>
            </select>
          </label>
        </div>

        <div style={{ marginTop: 12 }}>
          {steps.map((step, index) => (
            <div className="card" key={index} style={{ boxShadow: "none", padding: 12, marginBottom: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(125px,1fr))", gap: 8, alignItems: "end" }}>
                <strong style={{ fontSize: 12 }}>#{index + 1}</strong>
                <label>Step label<input value={step.label} onChange={(event) => setSteps((rows) => rows.map((row, i) => i === index ? { ...row, label: event.target.value } : row))} /></label>
                <label>Approver<input value={step.approver} onChange={(event) => setSteps((rows) => rows.map((row, i) => i === index ? { ...row, approver: event.target.value } : row))} placeholder="Name or role:hr / role:finance / role:owner" /></label>
                <label>Required Dynamic Group
                  <select
                    value={step.dynamicGroupCode ?? ""}
                    onChange={(event) => setSteps((rows) => rows.map((row, i) =>
                      i === index ? { ...row, dynamicGroupCode: event.target.value } : row
                    ))}
                  >
                    <option value="">No group restriction</option>
                    {dynamicGroups.map((group) => (
                      <option value={group.code} key={group.id}>{group.name} · v{group.version}</option>
                    ))}
                  </select>
                </label>
                <label>Starts at (PHP)<input type="number" min="0" step="0.01" disabled={index === 0} value={step.minimumAmount ?? 0} onChange={(event) => setSteps((rows) => rows.map((row, i) => i === index ? { ...row, minimumAmount: Number(event.target.value) } : row))} /></label>
                <label>Priority<select value={step.priority ?? "Normal"} onChange={(event) => setSteps((rows) => rows.map((row, i) => i === index ? { ...row, priority: event.target.value } : row))}><option>Normal</option><option>High</option></select></label>
                <button type="button" className="icon-button" disabled={steps.length === 1} onClick={() => setSteps((rows) => rows.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </div>

        <div className="run-actions" style={{ marginTop: 12 }}>
          <button type="button" className="secondary-button" onClick={() => {
            setEditingId(null);
            setCode("workforce-plan");
            setName("Workforce plan approval");
            setPurpose("workforce_plan");
            setSteps([
              { label: "HR review", approver: "role:hr", dueLabel: "HR review required", priority: "Normal", minimumAmount: 0 },
              { label: "Finance review", approver: "role:finance", dueLabel: "Finance review required", priority: "High", minimumAmount: 0 },
              { label: "Business owner approval", approver: "role:owner", dueLabel: "Owner review required", priority: "High", minimumAmount: 1000000 },
              { label: "Executive approval", approver: "role:owner", dueLabel: "Executive review required", priority: "High", minimumAmount: 5000000 },
            ]);
          }}>
            Workforce plan template
          </button>
          <button type="button" className="secondary-button" disabled={steps.length >= 12} onClick={() => setSteps((rows) => [...rows, { label: `Approval ${rows.length + 1}`, approver: "People Ops", dueLabel: "Review required", priority: "Normal", minimumAmount: Number(rows[rows.length - 1]?.minimumAmount ?? 0) }])}>
            <Plus size={14} /> Step
          </button>
          {editingId && <button type="button" className="secondary-button" onClick={reset}>Cancel edit</button>}
          <button type="button" className="primary-button" disabled={saving} onClick={() => void save()}>
            <Save size={14} /> {saving ? "Saving…" : editingId ? "Save new version" : "Create chain"}
          </button>
        </div>

        <div style={{ marginTop: 16 }}>
          {policies.length === 0 && <div className="empty-state">No approval chains configured yet.</div>}
          {policies.map((policy) => {
            const parsedSteps = normalizedSteps(policy.steps);
            const count = parsedSteps.length;
            const highestThreshold = parsedSteps.reduce((max, step) => Math.max(max, Number(step.minimumAmount ?? 0)), 0);
            return (
              <div className="leave-request" key={policy.id}>
                <div className="inline-icon purple"><GitBranch size={15} /></div>
                <div style={{ flex: 1 }}>
                  <strong>{policy.name}</strong>
                  <span>{policy.code} · {policy.purpose === "workforce_plan" ? "workforce planning" : "automation"} · v{policy.version} · {count} step{count === 1 ? "" : "s"} · thresholds through PHP {highestThreshold.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · {policy.active ? "active" : "disabled"}</span>
                </div>
                <button type="button" className="secondary-button" onClick={() => edit(policy)}>Edit</button>
                <button type="button" className="secondary-button" onClick={() => void setActive(policy, !policy.active)}>{policy.active ? "Disable" : "Enable"}</button>
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}
