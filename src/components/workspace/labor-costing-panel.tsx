"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Plus, RefreshCcw, Save, Trash2 } from "lucide-react";
import type { DashboardData, Notify } from "./types";
import { EmptyState, Metric, Spinner, Status } from "./ui";

type CostCenterRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
};

type AllocationRow = {
  id: number;
  employeeId: number;
  costCenterId: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  allocationPercent: string;
  clientCode: string | null;
  projectCode: string | null;
  jobCode: string | null;
  reason: string;
};

type DraftAllocation = {
  key: number;
  costCenterId: string;
  allocationPercent: string;
  clientCode: string;
  projectCode: string;
  jobCode: string;
};

function localToday() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function LaborCostingPanel({
  data,
  notify,
}: {
  data: DashboardData;
  notify: Notify;
}) {
  const organizationId = data.selectedOrganization.id;
  const [costCenters, setCostCenters] = useState<CostCenterRow[]>([]);
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const [centerCode, setCenterCode] = useState("OPS");
  const [centerName, setCenterName] = useState("Operations");
  const [centerDescription, setCenterDescription] = useState("");

  const [employeeId, setEmployeeId] = useState(data.employees[0]?.id ?? 0);
  const [effectiveFrom, setEffectiveFrom] = useState(localToday());
  const [effectiveUntil, setEffectiveUntil] = useState("");
  const [reason, setReason] = useState("Labor costing allocation");
  const [nextKey, setNextKey] = useState(2);
  const [drafts, setDrafts] = useState<DraftAllocation[]>([
    { key: 1, costCenterId: "", allocationPercent: "100", clientCode: "", projectCode: "", jobCode: "" },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/workforce/labor-costing?organizationId=${organizationId}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not load labor costing.");
      setCostCenters(Array.isArray(body.costCenters) ? body.costCenters : []);
      setAllocations(Array.isArray(body.allocations) ? body.allocations : []);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load labor costing.", "err");
    } finally {
      setLoading(false);
    }
  }, [notify, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!costCenters.length) return;
    setDrafts((current) => current.map((draft, index) => (
      !draft.costCenterId && index === 0
        ? { ...draft, costCenterId: String(costCenters[0].id) }
        : draft
    )));
  }, [costCenters]);

  const totalPercent = useMemo(
    () => Math.round(drafts.reduce((sum, row) => sum + (Number(row.allocationPercent) || 0), 0) * 1000) / 1000,
    [drafts],
  );

  const selectedHistory = useMemo(
    () => allocations
      .filter((row) => row.employeeId === employeeId)
      .sort((a, b) => String(b.effectiveFrom).localeCompare(String(a.effectiveFrom)) || b.id - a.id),
    [allocations, employeeId],
  );

  async function mutate(action: string, payload: Record<string, unknown>, success: string) {
    setSaving(action);
    try {
      const response = await fetch("/api/workforce/labor-costing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, action, ...payload }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(body.error ?? "The labor-costing change could not be saved.", "err");
        return false;
      }
      await load();
      notify(success);
      return true;
    } catch {
      notify("Could not reach the labor-costing service.", "err");
      return false;
    } finally {
      setSaving(null);
    }
  }

  async function createCostCenter() {
    if (!centerCode.trim() || !centerName.trim()) {
      notify("Cost center code and name are required.", "err");
      return;
    }
    await mutate("create_cost_center", {
      code: centerCode,
      name: centerName,
      description: centerDescription || null,
    }, `Cost center ${centerCode.toUpperCase()} created.`);
  }

  function updateDraft(key: number, patch: Partial<DraftAllocation>) {
    setDrafts((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  }

  function addDraft() {
    if (drafts.length >= 20) return;
    const centerId = costCenters.find((center) => !drafts.some((row) => row.costCenterId === String(center.id)))?.id
      ?? costCenters[0]?.id
      ?? "";
    setDrafts((current) => [...current, {
      key: nextKey,
      costCenterId: String(centerId),
      allocationPercent: "0",
      clientCode: "",
      projectCode: "",
      jobCode: "",
    }]);
    setNextKey((value) => value + 1);
  }

  function removeDraft(key: number) {
    setDrafts((current) => current.length === 1 ? current : current.filter((row) => row.key !== key));
  }

  async function saveAllocations() {
    if (!employeeId || !effectiveFrom || drafts.length === 0) {
      notify("Employee, effective date and allocation rows are required.", "err");
      return;
    }
    if (Math.abs(totalPercent - 100) > 0.001) {
      notify(`Allocation must total exactly 100.000%. Current total: ${totalPercent.toFixed(3)}%.`, "err");
      return;
    }
    if (drafts.some((row) => !row.costCenterId || Number(row.allocationPercent) <= 0)) {
      notify("Every allocation row needs a cost center and a positive percentage.", "err");
      return;
    }

    await mutate("set_employee_allocations", {
      employeeId,
      effectiveFrom,
      effectiveUntil: effectiveUntil || null,
      reason,
      allocations: drafts.map((row) => ({
        costCenterId: Number(row.costCenterId),
        allocationPercent: Number(row.allocationPercent),
        clientCode: row.clientCode || null,
        projectCode: row.projectCode || null,
        jobCode: row.jobCode || null,
      })),
    }, "Effective-dated labor allocation saved.");
  }

  return (
    <section style={{ marginTop: 16 }}>
      <div className="card-header" style={{ padding: "0 0 12px" }}>
        <div>
          <div className="card-kicker">Enterprise labor costing</div>
          <h2>Cost centers & allocations</h2>
          <p>Allocate employee labor across finance dimensions without changing payroll entitlement or gross/net pay.</p>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner label="Loading" /> : <RefreshCcw size={14} className="i-cyan" />} Refresh
        </button>
      </div>

      <section className="stats-grid">
        <Metric label="Cost centers" value={String(costCenters.length)} hint="organization finance dimensions" icon={<Building2 size={16} className="i-cyan" />} tone="blue" />
        <Metric label="Employee plans" value={String(new Set(allocations.map((row) => row.employeeId)).size)} hint="employees with allocation history" icon={<Save size={16} className="i-green" />} tone="mint" />
        <Metric label="Draft total" value={`${totalPercent.toFixed(3)}%`} hint={Math.abs(totalPercent - 100) <= 0.001 ? "reconciled" : "must equal 100.000%"} icon={<Building2 size={16} className={Math.abs(totalPercent - 100) <= 0.001 ? "i-green" : "i-amber"} />} tone={Math.abs(totalPercent - 100) <= 0.001 ? "mint" : "amber"} />
        <Metric label="Allocation basis" value="%" hint="hours-based allocation comes later" icon={<Building2 size={16} className="i-slate" />} tone="slate" />
      </section>

      <div className="notice notice-slate">
        <Building2 size={15} className="i-green" />
        <span>
          <strong>Finance allocation, not wage calculation.</strong> This module records where labor cost belongs. It does not change statutory wages, contributions, withholding or net pay.
        </span>
      </div>

      <section className="module-grid two" style={{ marginTop: 16 }}>
        <article className="card">
          <div className="card-header">
            <div>
              <div className="card-kicker">Master data</div>
              <h2>Create a cost center</h2>
              <p>Organization-wide cost-center creation is restricted server-side to company-wide administrators.</p>
            </div>
          </div>
          <div className="setting-form">
            <label>Code<input value={centerCode} onChange={(event) => setCenterCode(event.target.value)} /></label>
            <label>Name<input value={centerName} onChange={(event) => setCenterName(event.target.value)} /></label>
            <label>Description<input value={centerDescription} onChange={(event) => setCenterDescription(event.target.value)} /></label>
          </div>
          <div className="run-actions">
            <button className="primary-button brand" disabled={saving !== null} onClick={() => void createCostCenter()}>
              {saving === "create_cost_center" ? <Spinner label="Saving" /> : <Plus size={14} />} Create cost center
            </button>
          </div>
          <div className="policy-lines">
            {costCenters.map((center) => (
              <span key={center.id}>
                <b>{center.code} · {center.name}</b>
                <small style={{ display: "block", color: "var(--muted)" }}>{center.description || "No description"} · {center.active ? "Active" : "Inactive"}</small>
              </span>
            ))}
          </div>
        </article>

        <article className="card">
          <div className="card-header">
            <div>
              <div className="card-kicker">Effective-dated split</div>
              <h2>Set employee labor allocation</h2>
              <p>The active allocation set must reconcile to exactly 100.000% before the server will persist it.</p>
            </div>
            <Status value={Math.abs(totalPercent - 100) <= 0.001 ? "Reconciled" : "Needs balancing"} />
          </div>

          <div className="setting-form">
            <label>
              Employee
              <select value={employeeId || ""} onChange={(event) => setEmployeeId(Number(event.target.value))}>
                {data.employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.employeeNo} · {employee.firstName} {employee.lastName}</option>
                ))}
              </select>
            </label>
            <label>Effective from<input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label>
            <label>Effective until (optional)<input type="date" min={effectiveFrom} value={effectiveUntil} onChange={(event) => setEffectiveUntil(event.target.value)} /></label>
            <label>Reason<input value={reason} maxLength={240} onChange={(event) => setReason(event.target.value)} /></label>
          </div>

          <div className="policy-lines">
            {drafts.map((draft) => (
              <span key={draft.key} style={{ display: "grid", gap: 8 }}>
                <div className="setting-form" style={{ padding: 0 }}>
                  <label>
                    Cost center
                    <select value={draft.costCenterId} onChange={(event) => updateDraft(draft.key, { costCenterId: event.target.value })}>
                      <option value="">Choose...</option>
                      {costCenters.filter((center) => center.active).map((center) => (
                        <option key={center.id} value={center.id}>{center.code} · {center.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>Percent<input type="number" min={0.001} max={100} step={0.001} value={draft.allocationPercent} onChange={(event) => updateDraft(draft.key, { allocationPercent: event.target.value })} /></label>
                  <label>Client code<input value={draft.clientCode} onChange={(event) => updateDraft(draft.key, { clientCode: event.target.value })} /></label>
                  <label>Project code<input value={draft.projectCode} onChange={(event) => updateDraft(draft.key, { projectCode: event.target.value })} /></label>
                  <label>Job code<input value={draft.jobCode} onChange={(event) => updateDraft(draft.key, { jobCode: event.target.value })} /></label>
                </div>
                <button className="tiny-button decline" type="button" disabled={drafts.length === 1} onClick={() => removeDraft(draft.key)}>
                  <Trash2 size={13} /> Remove row
                </button>
              </span>
            ))}
          </div>

          <div className="run-actions">
            <button className="secondary-button" type="button" disabled={drafts.length >= 20 || !costCenters.length} onClick={addDraft}>
              <Plus size={14} /> Add split
            </button>
            <button className="primary-button brand" disabled={saving !== null || !costCenters.length || Math.abs(totalPercent - 100) > 0.001} onClick={() => void saveAllocations()}>
              {saving === "set_employee_allocations" ? <Spinner label="Saving" /> : <Save size={14} />} Save allocation
            </button>
          </div>
        </article>
      </section>

      <article className="card table-card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">Allocation history</div>
            <h2>Selected employee</h2>
            <p>Effective dates are retained so finance reporting can reconstruct historical labor ownership.</p>
          </div>
        </div>
        <div className="data-table-wrap slim-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Effective window</th>
                <th>Cost center</th>
                <th>Allocation</th>
                <th>Client / project / job</th>
              </tr>
            </thead>
            <tbody>
              {selectedHistory.map((row) => {
                const center = costCenters.find((item) => item.id === row.costCenterId);
                return (
                  <tr key={row.id}>
                    <td><strong>{row.effectiveFrom}</strong><div className="id">to {row.effectiveUntil ?? "open-ended"}</div></td>
                    <td>{center ? `${center.code} · ${center.name}` : `Cost center #${row.costCenterId}`}</td>
                    <td className="num">{Number(row.allocationPercent).toFixed(3)}%</td>
                    <td>{[row.clientCode, row.projectCode, row.jobCode].filter(Boolean).join(" / ") || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && selectedHistory.length === 0 && (
            <EmptyState icon={<Building2 size={20} className="i-slate" />} title="No labor allocation history">
              Save a 100% cost-center allocation for this employee to start finance tracking.
            </EmptyState>
          )}
        </div>
      </article>
    </section>
  );
}
