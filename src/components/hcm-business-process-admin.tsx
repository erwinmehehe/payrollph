"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Save, Settings2, Trash2 } from "lucide-react";

type Step = {
  type: "approval" | "review" | "to_do";
  label: string;
  assignee: string;
  dueDays: number;
  priority: "Low" | "Normal" | "High";
};

type Definition = {
  id: number;
  code: string;
  name: string;
  processType: string;
  supervisoryOrgUnitId: number | null;
  version: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  steps: Step[];
  active: boolean;
};

type SupervisoryOrg = {
  id: number;
  parentId: number | null;
  code: string;
  name: string;
  managerEmployeeId: number | null;
  active: boolean;
};

type Payload = {
  definitions: Definition[];
  supervisoryOrganizations: SupervisoryOrg[];
  processTypes: string[];
};

function phToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

function defaultSteps(): Step[] {
  return [
    { type: "approval", label: "People review", assignee: "role:hr", dueDays: 2, priority: "High" },
    { type: "approval", label: "Executive approval", assignee: "role:owner", dueDays: 2, priority: "High" },
  ];
}

export function HcmBusinessProcessAdmin({ organizationId }: { organizationId: number }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [code, setCode] = useState("change-job-enterprise");
  const [name, setName] = useState("Enterprise Change Job");
  const [processType, setProcessType] = useState("change_job");
  const [supervisoryOrgUnitId, setSupervisoryOrgUnitId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(phToday());
  const [effectiveUntil, setEffectiveUntil] = useState("");
  const [steps, setSteps] = useState<Step[]>(defaultSteps());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const response = await fetch(
      `/api/hcm/business-processes/definitions?organizationId=${organizationId}`,
      { cache: "no-store" },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "Could not load HCM business-process definitions.");
    setPayload(data as Payload);
  }, [organizationId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load HCM business-process definitions.");
      }
    })();
    return () => { cancelled = true; };
  }, [load]);

  function resetForm() {
    setEditingId(null);
    setCode("change-job-enterprise");
    setName("Enterprise Change Job");
    setProcessType("change_job");
    setSupervisoryOrgUnitId("");
    setEffectiveFrom(phToday());
    setEffectiveUntil("");
    setSteps(defaultSteps());
  }

  function edit(definition: Definition) {
    setEditingId(definition.id);
    setCode(definition.code);
    setName(definition.name);
    setProcessType(definition.processType);
    setSupervisoryOrgUnitId(definition.supervisoryOrgUnitId ? String(definition.supervisoryOrgUnitId) : "");
    setEffectiveFrom(definition.effectiveFrom);
    setEffectiveUntil(definition.effectiveUntil ?? "");
    setSteps(Array.isArray(definition.steps) && definition.steps.length ? definition.steps : defaultSteps());
  }

  function patchStep(index: number, patch: Partial<Step>) {
    setSteps((current) => current.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step));
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/hcm/business-processes/definitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "save",
          id: editingId,
          code,
          name,
          processType,
          supervisoryOrgUnitId: supervisoryOrgUnitId || null,
          effectiveFrom,
          effectiveUntil: effectiveUntil || null,
          steps,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not save the HCM business process.");
      await load();
      resetForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the HCM business process.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(definition: Definition) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/hcm/business-processes/definitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "set-active",
          id: definition.id,
          active: !definition.active,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not update the HCM business process.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the HCM business process.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ marginBottom: 18 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">ENTERPRISE HCM · BUSINESS PROCESS FRAMEWORK</div>
          <h2>Configure governed HCM transactions</h2>
          <p>
            Scope a process to the whole company or one supervisory organization. Child supervisory organizations
            inherit the closest active definition unless they define their own.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={busy}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && <div className="notice notice-amber" style={{ margin: "0 16px 12px" }}><span>{error}</span></div>}

      <div className="card-body">
        <div className="module-grid two" style={{ margin: 0 }}>
          <div className="setting-form">
            <div className="card-kicker">{editingId ? "REVISE PROCESS" : "NEW PROCESS"}</div>
            <label>
              Code
              <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="change-job-enterprise" />
            </label>
            <label>
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Enterprise Change Job" />
            </label>
            <label>
              Transaction
              <select value={processType} onChange={(event) => setProcessType(event.target.value)}>
                {(payload?.processTypes ?? ["change_job"]).map((value) => (
                  <option key={value} value={value}>{value.replaceAll("_", " ")}</option>
                ))}
              </select>
            </label>
            <label>
              Supervisory organization scope
              <select value={supervisoryOrgUnitId} onChange={(event) => setSupervisoryOrgUnitId(event.target.value)}>
                <option value="">Company default</option>
                {(payload?.supervisoryOrganizations ?? []).filter((row) => row.active).map((row) => (
                  <option key={row.id} value={row.id}>{row.code} · {row.name}</option>
                ))}
              </select>
            </label>
            <label>
              Effective from
              <input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
            </label>
            <label>
              Effective until
              <input type="date" min={effectiveFrom} value={effectiveUntil} onChange={(event) => setEffectiveUntil(event.target.value)} />
            </label>
          </div>

          <div>
            <div className="card-kicker" style={{ marginBottom: 8 }}>ORDERED STEPS</div>
            {steps.map((step, index) => (
              <div className="card" key={index} style={{ boxShadow: "none", marginBottom: 10, padding: 12 }}>
                <div className="setting-form">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <strong style={{ fontSize: 12 }}>Step {index + 1}</strong>
                    {steps.length > 1 && (
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => setSteps((current) => current.filter((_, stepIndex) => stepIndex !== index))}
                        aria-label={`Remove step ${index + 1}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                  <label>
                    Type
                    <select value={step.type} onChange={(event) => patchStep(index, { type: event.target.value as Step["type"] })}>
                      <option value="approval">Approval</option>
                      <option value="review">Review</option>
                      <option value="to_do">To do</option>
                    </select>
                  </label>
                  <label>
                    Label
                    <input value={step.label} onChange={(event) => patchStep(index, { label: event.target.value })} />
                  </label>
                  <label>
                    Assignee
                    <input
                      value={step.assignee}
                      onChange={(event) => patchStep(index, { assignee: event.target.value })}
                      placeholder="role:hr, role:owner or a named approver"
                    />
                  </label>
                  <label>
                    Priority
                    <select
                      value={step.priority}
                      onChange={(event) => patchStep(index, { priority: event.target.value as Step["priority"] })}
                    >
                      <option value="Low">Low</option>
                      <option value="Normal">Normal</option>
                      <option value="High">High</option>
                    </select>
                  </label>
                  <label>
                    Due in days
                    <input
                      type="number"
                      min={0}
                      max={90}
                      value={step.dueDays}
                      onChange={(event) => patchStep(index, { dueDays: Number(event.target.value) })}
                    />
                  </label>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="secondary-button"
              onClick={() => setSteps((current) => [
                ...current,
                { type: "approval", label: "Additional approval", assignee: "role:owner", dueDays: 2, priority: "Normal" },
              ])}
              disabled={steps.length >= 12}
            >
              <Plus size={14} /> Add step
            </button>
          </div>
        </div>

        <div className="run-actions" style={{ marginTop: 16 }}>
          {editingId && <button className="secondary-button" onClick={resetForm}>Cancel edit</button>}
          <button className="primary-button brand" onClick={() => void save()} disabled={busy || !code || !name || !effectiveFrom}>
            <Save size={14} /> {editingId ? "Save new version" : "Create process"}
          </button>
        </div>

        {(payload?.definitions.length ?? 0) > 0 && (
          <div className="data-table-wrap slim-scroll" style={{ marginTop: 18 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Definition</th>
                  <th>Scope</th>
                  <th>Version</th>
                  <th>Status</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payload!.definitions.map((definition) => {
                  const scope = payload!.supervisoryOrganizations.find((row) => row.id === definition.supervisoryOrgUnitId);
                  return (
                    <tr key={definition.id}>
                      <td>
                        <strong>{definition.name}</strong>
                        <small style={{ display: "block", color: "var(--muted)" }}>
                          {definition.code} · {definition.processType.replaceAll("_", " ")}
                        </small>
                      </td>
                      <td>{scope ? scope.name : "Company default"}</td>
                      <td className="mono">v{definition.version}</td>
                      <td><span className={`status ${definition.active ? "status-complete" : "status-muted"}`}>{definition.active ? "Active" : "Inactive"}</span></td>
                      <td className="right">
                        <div style={{ display: "inline-flex", gap: 6 }}>
                          <button className="secondary-button" onClick={() => edit(definition)}>
                            <Settings2 size={13} /> Edit
                          </button>
                          <button className="secondary-button" onClick={() => void toggle(definition)} disabled={busy}>
                            {definition.active ? "Disable" : "Enable"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
