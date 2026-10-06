"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Copy, Plus, RefreshCcw, Save, Trash2 } from "lucide-react";
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

function blankDraft(key: number, costCenterId: number | string = "", allocationPercent = "100"): DraftAllocation {
  return {
    key,
    costCenterId: String(costCenterId),
    allocationPercent,
    clientCode: "",
    projectCode: "",
    jobCode: "",
  };
}

function normalizeDimensionCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_.-]/g, "").slice(0, 64);
}

function dimensionKey(row: DraftAllocation) {
  return [
    row.costCenterId,
    normalizeDimensionCode(row.clientCode),
    normalizeDimensionCode(row.projectCode),
    normalizeDimensionCode(row.jobCode),
  ].join("|");
}

function windowStatus(row: AllocationRow, today: string) {
  if (row.effectiveFrom > today) return "Future";
  if (row.effectiveUntil && row.effectiveUntil < today) return "Expired";
  return "Current";
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
  const [drafts, setDrafts] = useState<DraftAllocation[]>([blankDraft(1)]);

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
    setCostCenters([]);
    setAllocations([]);
    setEmployeeId(data.employees[0]?.id ?? 0);
    setEffectiveFrom(localToday());
    setEffectiveUntil("");
    setReason("Labor costing allocation");
    setDrafts([blankDraft(1)]);
    setNextKey(2);
    void load();
  }, [organizationId, load]);

  useEffect(() => {
    if (data.employees.some((employee) => employee.id === employeeId)) return;
    setEmployeeId(data.employees[0]?.id ?? 0);
  }, [data.employees, employeeId]);

  const activeCostCenters = useMemo(
    () => costCenters.filter((center) => center.active),
    [costCenters],
  );

  useEffect(() => {
    const firstActiveId = activeCostCenters[0]?.id;
    if (!firstActiveId) return;
    const activeIds = new Set(activeCostCenters.map((center) => String(center.id)));
    setDrafts((current) => current.map((draft, index) => {
      if (activeIds.has(draft.costCenterId)) return draft;
      return index === 0 ? { ...draft, costCenterId: String(firstActiveId) } : { ...draft, costCenterId: "" };
    }));
  }, [activeCostCenters]);

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

  const selectedEmployee = useMemo(
    () => data.employees.find((employee) => employee.id === employeeId) ?? null,
    [data.employees, employeeId],
  );

  const activeCenterIds = useMemo(
    () => new Set(activeCostCenters.map((center) => String(center.id))),
    [activeCostCenters],
  );

  const invalidPercent = drafts.some((row) => {
    const value = Number(row.allocationPercent);
    return !Number.isFinite(value) || value <= 0 || value > 100;
  });
  const inactiveOrMissingCenter = drafts.some((row) => !activeCenterIds.has(row.costCenterId));
  const duplicateDimensions = useMemo(() => {
    const seen = new Set<string>();
    for (const row of drafts) {
      if (!row.costCenterId) continue;
      const key = dimensionKey(row);
      if (seen.has(key)) return true;
      seen.add(key);
    }
    return false;
  }, [drafts]);
  const dateRangeInvalid = Boolean(effectiveUntil && effectiveUntil < effectiveFrom);
  const reconciled = Math.abs(totalPercent - 100) <= 0.001;
  const canSave = Boolean(
    employeeId
    && effectiveFrom
    && drafts.length
    && activeCostCenters.length
    && reconciled
    && !invalidPercent
    && !inactiveOrMissingCenter
    && !duplicateDimensions
    && !dateRangeInvalid
    && saving === null,
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
    const created = await mutate("create_cost_center", {
      code: centerCode,
      name: centerName,
      description: centerDescription || null,
    }, `Cost center ${centerCode.toUpperCase()} created.`);
    if (created) {
      setCenterCode("");
      setCenterName("");
      setCenterDescription("");
    }
  }

  function resetDraftForEmployee(nextEmployeeId: number) {
    setEmployeeId(nextEmployeeId);
    setEffectiveFrom(localToday());
    setEffectiveUntil("");
    setReason("Labor costing allocation");
    setDrafts([blankDraft(1, activeCostCenters[0]?.id ?? "")]);
    setNextKey(2);
  }

  function updateDraft(key: number, patch: Partial<DraftAllocation>) {
    setDrafts((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  }

  function addDraft() {
    if (drafts.length >= 20) return;
    const centerId = activeCostCenters.find((center) => !drafts.some((row) => row.costCenterId === String(center.id)))?.id
      ?? activeCostCenters[0]?.id
      ?? "";
    setDrafts((current) => [...current, blankDraft(nextKey, centerId, "0")]);
    setNextKey((value) => value + 1);
  }

  function removeDraft(key: number) {
    setDrafts((current) => current.length === 1 ? current : current.filter((row) => row.key !== key));
  }

  function copyLatestPlan() {
    if (!selectedHistory.length) return;
    const latestStart = selectedHistory[0].effectiveFrom;
    const latestRows = selectedHistory
      .filter((row) => row.effectiveFrom === latestStart)
      .sort((a, b) => a.id - b.id);
    setDrafts(latestRows.map((row, index) => ({
      key: index + 1,
      costCenterId: String(row.costCenterId),
      allocationPercent: String(row.allocationPercent),
      clientCode: row.clientCode ?? "",
      projectCode: row.projectCode ?? "",
      jobCode: row.jobCode ?? "",
    })));
    setNextKey(latestRows.length + 1);
    setReason(`Updated from allocation effective ${latestStart}`);
    notify(`Loaded the latest ${latestRows.length}-row allocation as a new draft.`, "info");
  }

  async function saveAllocations() {
    if (!employeeId || !effectiveFrom || drafts.length === 0) {
      notify("Employee, effective date and allocation rows are required.", "err");
      return;
    }
    if (dateRangeInvalid) {
      notify("Effective until cannot be earlier than effective from.", "err");
      return;
    }
    if (!reconciled) {
      notify(`Allocation must total exactly 100.000%. Current total: ${totalPercent.toFixed(3)}%.`, "err");
      return;
    }
    if (invalidPercent || inactiveOrMissingCenter) {
      notify("Every allocation row needs an active cost center and a percentage greater than 0 and no more than 100.", "err");
      return;
    }
    if (duplicateDimensions) {
      notify("Duplicate cost center/client/project/job combinations are not allowed in the same allocation set.", "err");
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

  const today = localToday();

  return (
    <section style={{ marginTop: 16 }}>
      <div className="card-header" style={{ padding: "0 0 12px" }}>
        <div>
          <div className="card-kicker">Enterprise labor costing</div>
          <h2>Cost centers & allocations</h2>
          <p>Allocate employee labor across finance dimensions without changing payroll entitlement or gross/net pay.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner label="Loading" /> : <RefreshCcw size={14} className="i-cyan" />} Refresh
        </button>
      </div>

      <section className="stats-grid">
        <Metric label="Cost centers" value={String(costCenters.length)} hint={`${activeCostCenters.length} active finance dimensions`} icon={<Building2 size={16} className="i-cyan" />} tone="blue" />
        <Metric label="Employee plans" value={String(new Set(allocations.map((row) => row.employeeId)).size)} hint="employees with allocation history" icon={<Save size={16} className="i-green" />} tone="mint" />
        <Metric label="Draft total" value={`${totalPercent.toFixed(3)}%`} hint={reconciled ? "reconciled" : "must equal 100.000%"} icon={<Building2 size={16} className={reconciled ? "i-green" : "i-amber"} />} tone={reconciled ? "mint" : "amber"} />
        <Metric label="Allocation basis" value="%" hint="hours-based allocation comes later" icon={<Building2 size={16} className="i-slate" />} tone="slate" />
      </section>

      <div className="notice notice-slate">
        <Building2 size={15} className="i-green" />
        <span>
          <strong>Finance allocation, not wage calculation.</strong> This module records where labor cost belongs. It does not change statutory wages, contributions, withholding or net pay.
        </span>
      </div>

      {duplicateDimensions && (
        <div className="notice notice-amber">
          <Building2 size={15} className="i-amber" />
          <span><strong>Duplicate allocation dimension.</strong> Each cost center/client/project/job combination can appear only once in an effective allocation set.</span>
        </div>
      )}

      {dateRangeInvalid && (
        <div className="notice notice-amber">
          <Building2 size={15} className="i-amber" />
          <span><strong>Invalid effective window.</strong> Effective until must be the same as or later than effective from.</span>
        </div>
      )}

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
            <label>Code<input value={centerCode} maxLength={40} onChange={(event) => setCenterCode(event.target.value)} /></label>
            <label>Name<input value={centerName} maxLength={140} onChange={(event) => setCenterName(event.target.value)} /></label>
            <label>Description<input value={centerDescription} maxLength={500} onChange={(event) => setCenterDescription(event.target.value)} /></label>
          </div>
          <div className="run-actions">
            <button className="primary-button brand" type="button" disabled={saving !== null || !centerCode.trim() || !centerName.trim()} onClick={() => void createCostCenter()}>
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
            {!loading && costCenters.length === 0 && (
              <EmptyState icon={<Building2 size={20} className="i-slate" />} title="No cost centers yet">
                Create the first finance dimension before assigning employee labor.
              </EmptyState>
            )}
          </div>
        </article>

        <article className="card">
          <div className="card-header">
            <div>
              <div className="card-kicker">Effective-dated split</div>
              <h2>Set employee labor allocation</h2>
              <p>The active allocation set must reconcile to exactly 100.000% before the server will persist it.</p>
            </div>
            <Status value={canSave ? "Reconciled" : "Needs review"} />
          </div>

          <div className="setting-form">
            <label>
              Employee
              <select value={employeeId || ""} onChange={(event) => resetDraftForEmployee(Number(event.target.value))} disabled={!data.employees.length}>
                {!data.employees.length && <option value="">No employees available</option>}
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
                      {activeCostCenters.map((center) => (
                        <option key={center.id} value={center.id}>{center.code} · {center.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>Percent<input type="number" min={0.001} max={100} step={0.001} value={draft.allocationPercent} onChange={(event) => updateDraft(draft.key, { allocationPercent: event.target.value })} /></label>
                  <label>Client code<input maxLength={64} value={draft.clientCode} onChange={(event) => updateDraft(draft.key, { clientCode: event.target.value })} /></label>
                  <label>Project code<input maxLength={64} value={draft.projectCode} onChange={(event) => updateDraft(draft.key, { projectCode: event.target.value })} /></label>
                  <label>Job code<input maxLength={64} value={draft.jobCode} onChange={(event) => updateDraft(draft.key, { jobCode: event.target.value })} /></label>
                </div>
                <button className="tiny-button decline" type="button" disabled={drafts.length === 1} onClick={() => removeDraft(draft.key)}>
                  <Trash2 size={13} /> Remove row
                </button>
              </span>
            ))}
          </div>

          <div className="run-actions">
            <button className="secondary-button" type="button" disabled={!selectedHistory.length || saving !== null} onClick={copyLatestPlan}>
              <Copy size={14} /> Copy latest plan
            </button>
            <button className="secondary-button" type="button" disabled={drafts.length >= 20 || !activeCostCenters.length || saving !== null} onClick={addDraft}>
              <Plus size={14} /> Add split
            </button>
            <button className="primary-button brand" type="button" disabled={!canSave} onClick={() => void saveAllocations()}>
              {saving === "set_employee_allocations" ? <Spinner label="Saving" /> : <Save size={14} />} Save allocation
            </button>
          </div>
        </article>
      </section>

      <article className="card table-card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">Allocation history</div>
            <h2>{selectedEmployee ? `${selectedEmployee.firstName} ${selectedEmployee.lastName}` : "Selected employee"}</h2>
            <p>Effective dates and reasons are retained so finance reporting can reconstruct historical labor ownership.</p>
          </div>
        </div>
        <div className="data-table-wrap slim-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Effective window</th>
                <th>Cost center</th>
                <th>Allocation</th>
                <th>Client / project / job</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {selectedHistory.map((row) => {
                const center = costCenters.find((item) => item.id === row.costCenterId);
                return (
                  <tr key={row.id}>
                    <td><Status value={windowStatus(row, today)} /></td>
                    <td><strong>{row.effectiveFrom}</strong><div className="id">to {row.effectiveUntil ?? "open-ended"}</div></td>
                    <td>{center ? `${center.code} · ${center.name}` : `Cost center #${row.costCenterId}`}</td>
                    <td className="num">{Number(row.allocationPercent).toFixed(3)}%</td>
                    <td>{[row.clientCode, row.projectCode, row.jobCode].filter(Boolean).join(" / ") || "—"}</td>
                    <td>{row.reason || "—"}</td>
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
