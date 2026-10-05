"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, MapPin, Plus, RefreshCcw, Save, UserRound } from "lucide-react";
import type { DashboardData, Notify } from "./types";
import { EmptyState, Metric, Spinner, Status } from "./ui";

type Worksite = {
  id: number;
  orgUnitId: number | null;
  code: string;
  name: string;
  siteType: string;
  timezone: string;
  region: string | null;
  province: string | null;
  cityMunicipality: string | null;
  addressLine1: string | null;
  active: boolean;
};

type WorksiteAssignment = {
  id: number;
  employeeId: number;
  worksiteId: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  reason: string;
  createdBy: string;
};

type Payload = {
  worksites: Worksite[];
  assignments: WorksiteAssignment[];
};

function localToday() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function WorkforceWorksitesPanel({
  data,
  notify,
  canManage,
}: {
  data: DashboardData;
  notify: Notify;
  canManage: boolean;
}) {
  const organizationId = data.selectedOrganization.id;
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const [code, setCode] = useState("MAIN");
  const [name, setName] = useState("Main office");
  const [siteType, setSiteType] = useState("office");
  const [orgUnitId, setOrgUnitId] = useState("");
  const [region, setRegion] = useState("NCR");
  const [province, setProvince] = useState("");
  const [cityMunicipality, setCityMunicipality] = useState("");
  const [addressLine1, setAddressLine1] = useState("");

  const [employeeId, setEmployeeId] = useState(data.employees[0]?.id ?? 0);
  const [worksiteId, setWorksiteId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(localToday());
  const [effectiveUntil, setEffectiveUntil] = useState("");
  const [reason, setReason] = useState("Primary worksite assignment");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/workforce/worksites?organizationId=${organizationId}`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not load worksites.");
      setPayload(body as Payload);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load worksites.", "err");
    } finally {
      setLoading(false);
    }
  }, [notify, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!worksiteId && payload?.worksites.some((site) => site.active)) {
      setWorksiteId(String(payload.worksites.find((site) => site.active)!.id));
    }
  }, [payload, worksiteId]);

  const activeWorksites = useMemo(
    () => (payload?.worksites ?? []).filter((site) => site.active),
    [payload],
  );

  const currentAssignments = useMemo(() => {
    const today = localToday();
    return (payload?.assignments ?? []).filter((assignment) =>
      assignment.effectiveFrom <= today
      && (!assignment.effectiveUntil || assignment.effectiveUntil >= today),
    );
  }, [payload]);

  const employeeById = useMemo(
    () => new Map(data.employees.map((employee) => [employee.id, employee])),
    [data.employees],
  );
  const worksiteById = useMemo(
    () => new Map((payload?.worksites ?? []).map((site) => [site.id, site])),
    [payload],
  );

  async function mutate(action: string, body: Record<string, unknown>, success: string) {
    setSaving(action);
    try {
      const response = await fetch("/api/workforce/worksites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, action, ...body }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Worksite change could not be saved.");
      notify(success, "ok");
      await load();
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Worksite change could not be saved.", "err");
      return false;
    } finally {
      setSaving(null);
    }
  }

  async function createWorksite() {
    const ok = await mutate("create_worksite", {
      code,
      name,
      siteType,
      timezone: "Asia/Manila",
      orgUnitId: orgUnitId ? Number(orgUnitId) : null,
      region,
      province,
      cityMunicipality,
      addressLine1,
    }, "Worksite created and audit-logged.");
    if (ok) {
      setCode("");
      setName("");
      setProvince("");
      setCityMunicipality("");
      setAddressLine1("");
    }
  }

  async function assignEmployee() {
    if (!employeeId || !worksiteId || !effectiveFrom || !reason.trim()) {
      notify("Employee, worksite, effective date and reason are required.", "err");
      return;
    }
    await mutate("assign_employee", {
      employeeId,
      worksiteId: Number(worksiteId),
      effectiveFrom,
      effectiveUntil: effectiveUntil || null,
      reason,
    }, "Effective-dated employee worksite assignment saved.");
  }

  return (
    <article className="card" style={{ marginTop: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">Physical work locations</div>
          <h2>Worksites</h2>
          <p>
            Keep physical place-of-work separate from departments and reporting lines. Worksite history is effective-dated so later payroll and local-holiday rules can use the location that was actually assigned for that period.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner label="Loading" /> : <RefreshCcw size={14} className="i-cyan" />} Refresh
        </button>
      </div>

      <section className="stats-grid" style={{ padding: "0 18px 18px" }}>
        <Metric
          label="Active worksites"
          value={String(activeWorksites.length)}
          hint="physical payroll locations"
          icon={<Building2 size={16} className="i-cyan" />}
          tone="blue"
        />
        <Metric
          label="Current assignments"
          value={String(currentAssignments.length)}
          hint="effective today"
          icon={<UserRound size={16} className="i-green" />}
          tone="mint"
        />
        <Metric
          label="Timezone"
          value="PH"
          hint="Asia/Manila enforced for payroll safety"
          icon={<MapPin size={16} className="i-purple" />}
          tone="purple"
        />
      </section>

      {canManage && data.access?.companyWide && (
        <div style={{ padding: "0 18px 18px" }}>
          <div className="card-kicker" style={{ marginBottom: 8 }}>Create worksite</div>
          <div className="setting-form">
            <label>Code<input value={code} onChange={(event) => setCode(event.target.value)} placeholder="CRK-BPO" /></label>
            <label>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Clark operations center" /></label>
            <label>
              Type
              <select value={siteType} onChange={(event) => setSiteType(event.target.value)}>
                <option value="office">Office</option>
                <option value="branch">Branch</option>
                <option value="plant">Plant / factory</option>
                <option value="hospital">Hospital</option>
                <option value="hotel">Hotel</option>
                <option value="store">Retail store</option>
                <option value="warehouse">Warehouse</option>
                <option value="operations_site">Operations site</option>
                <option value="remote_hub">Remote hub</option>
              </select>
            </label>
            <label>
              Owning org unit (optional)
              <select value={orgUnitId} onChange={(event) => setOrgUnitId(event.target.value)}>
                <option value="">Organization-wide</option>
                {(data.orgUnits ?? []).map((unit) => (
                  <option key={unit.id} value={unit.id}>{unit.name}</option>
                ))}
              </select>
            </label>
            <label>Region<input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="Region III" /></label>
            <label>Province<input value={province} onChange={(event) => setProvince(event.target.value)} placeholder="Pampanga" /></label>
            <label>City / municipality<input value={cityMunicipality} onChange={(event) => setCityMunicipality(event.target.value)} placeholder="Mabalacat City" /></label>
            <label>Address<input value={addressLine1} onChange={(event) => setAddressLine1(event.target.value)} placeholder="Street / building / site" /></label>
          </div>
          <div className="run-actions">
            <button className="primary-button brand" onClick={() => void createWorksite()} disabled={saving !== null || !code.trim() || !name.trim()}>
              {saving === "create_worksite" ? <Spinner label="Saving" /> : <Plus size={14} />} Create worksite
            </button>
          </div>
        </div>
      )}

      {canManage && activeWorksites.length > 0 && (
        <div style={{ padding: "0 18px 18px" }}>
          <div className="card-kicker" style={{ marginBottom: 8 }}>Assign employee default worksite</div>
          <div className="setting-form">
            <label>
              Employee
              <select value={employeeId || ""} onChange={(event) => setEmployeeId(Number(event.target.value))}>
                {data.employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.employeeNo} · {employee.firstName} {employee.lastName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Worksite
              <select value={worksiteId} onChange={(event) => setWorksiteId(event.target.value)}>
                {activeWorksites.map((site) => (
                  <option key={site.id} value={site.id}>{site.code} · {site.name}</option>
                ))}
              </select>
            </label>
            <label>Effective from<input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label>
            <label>Effective until (optional)<input type="date" min={effectiveFrom} value={effectiveUntil} onChange={(event) => setEffectiveUntil(event.target.value)} /></label>
            <label>Reason<input value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          </div>
          <div className="run-actions">
            <button className="primary-button brand" onClick={() => void assignEmployee()} disabled={saving !== null || !worksiteId}>
              {saving === "assign_employee" ? <Spinner label="Saving" /> : <Save size={14} />} Assign worksite
            </button>
          </div>
        </div>
      )}

      <div className="data-table-wrap slim-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Worksite</th>
              <th>Type</th>
              <th>Location</th>
              <th>Org unit</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(payload?.worksites ?? []).map((site) => (
              <tr key={site.id}>
                <td>
                  <strong>{site.name}</strong>
                  <div className="id">{site.code}</div>
                </td>
                <td><Status value={site.siteType.replaceAll("_", " ")} /></td>
                <td>
                  {site.cityMunicipality || site.province || site.region || "Not set"}
                  <div className="id">{site.addressLine1 || site.timezone}</div>
                </td>
                <td className="num">
                  {site.orgUnitId == null
                    ? "Organization-wide"
                    : (data.orgUnits ?? []).find((unit) => unit.id === site.orgUnitId)?.name ?? `#${site.orgUnitId}`}
                </td>
                <td><Status value={site.active ? "Active" : "Inactive"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && (payload?.worksites.length ?? 0) === 0 && (
          <EmptyState icon={<Building2 size={20} className="i-cyan" />} title="No physical worksites yet">
            Create the first branch, office, plant, hospital, warehouse or operating site before assigning employees.
          </EmptyState>
        )}
      </div>

      {(payload?.assignments.length ?? 0) > 0 && (
        <div style={{ padding: 18 }}>
          <div className="card-kicker" style={{ marginBottom: 8 }}>Assignment history</div>
          <div className="policy-lines">
            {[...(payload?.assignments ?? [])]
              .sort((a, b) => String(b.effectiveFrom).localeCompare(String(a.effectiveFrom)))
              .slice(0, 20)
              .map((assignment) => {
                const employee = employeeById.get(assignment.employeeId);
                const site = worksiteById.get(assignment.worksiteId);
                return (
                  <span key={assignment.id}>
                    <b>{employee ? `${employee.firstName} ${employee.lastName}` : `Employee #${assignment.employeeId}`} · {site?.code ?? `Site #${assignment.worksiteId}`}</b>
                    <small style={{ display: "block", color: "var(--muted)" }}>
                      {assignment.effectiveFrom} → {assignment.effectiveUntil ?? "open-ended"} · {assignment.reason}
                    </small>
                  </span>
                );
              })}
          </div>
        </div>
      )}
    </article>
  );
}
