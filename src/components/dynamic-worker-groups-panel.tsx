"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Pencil, Plus, RefreshCw, ShieldCheck, UsersRound } from "lucide-react";

type GroupField = {
  value: string;
  label: string;
  kind: "string" | "number" | "string_array" | "number_array";
};

type GroupRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  conditions: unknown;
  version: number;
  active: boolean;
  automationDependencyCount?: number;
  activeAutomationDependencyCount?: number;
  permissionAssignmentCount?: number;
  activeApprovalPolicyCount?: number;
  automationDependencies?: Array<{ id: number; name: string; active: boolean }>;
  createdAt: string;
  updatedAt: string;
};

type GroupPayload = {
  groups: GroupRow[];
  catalogs: {
    fields: GroupField[];
    operators: string[];
  };
};

type ConditionDraft = {
  id: string;
  field: string;
  operator: string;
  value: string;
};

type PreviewPayload = {
  group: {
    id: number;
    code: string;
    name: string;
    version: number;
    active: boolean;
  };
  preview: {
    totalWorkersEvaluated: number;
    memberCount: number;
    sampleMembers: Array<{
      employeeId: number;
      employeeNo: string;
      employeeName: string;
      department: string | null;
      role: string;
      location: string;
      employmentType: string;
      verifiedSkillCodes: string[];
      validCredentialCodes: string[];
    }>;
  };
  generatedAt: string;
};

function conditionObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { all: [] as Array<Record<string, unknown>>, any: [] as Array<Record<string, unknown>> };
  }
  const row = value as Record<string, unknown>;
  return {
    all: Array.isArray(row.all) ? row.all.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as Array<Record<string, unknown>> : [],
    any: Array.isArray(row.any) ? row.any.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as Array<Record<string, unknown>> : [],
  };
}

function valueText(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (value === undefined || value === null) return "";
  return String(value);
}

function allowedOperators(kind: GroupField["kind"], operators: string[]) {
  const allowed = kind === "number"
    ? new Set(["eq", "neq", "gt", "gte", "lt", "lte", "in", "exists"])
    : kind === "number_array" || kind === "string_array"
      ? new Set(["contains", "in", "exists"])
      : new Set(["eq", "neq", "contains", "in", "exists"]);
  return operators.filter((operator) => allowed.has(operator));
}

export function DynamicWorkerGroupsPanel({
  organizationId,
  setNotice,
}: {
  organizationId: number;
  setNotice: (message: string) => void;
}) {
  const [data, setData] = useState<GroupPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [matchMode, setMatchMode] = useState<"all" | "any">("all");
  const [conditions, setConditions] = useState<ConditionDraft[]>([]);
  const [previewingId, setPreviewingId] = useState<number | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/dynamic-worker-groups?organizationId=${organizationId}`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load Dynamic Groups.");
      setData(payload as GroupPayload);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load Dynamic Groups.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  const fieldByValue = useMemo(
    () => new Map((data?.catalogs.fields ?? []).map((field) => [field.value, field])),
    [data],
  );

  function resetBuilder() {
    setEditingId(null);
    setName("");
    setCode("");
    setDescription("");
    setMatchMode("all");
    setConditions([]);
  }

  function addCondition() {
    const field = data?.catalogs.fields[0];
    if (!field) return;
    setConditions((rows) => [...rows, {
      id: "gc-" + Date.now() + "-" + rows.length,
      field: field.value,
      operator: field.kind.includes("array") ? "contains" : "eq",
      value: "",
    }]);
  }

  function updateCondition(id: string, patch: Partial<ConditionDraft>) {
    setConditions((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function editGroup(group: GroupRow) {
    const parsed = conditionObject(group.conditions);
    const source = parsed.any.length > 0 && parsed.all.length === 0 ? parsed.any : parsed.all;
    setEditingId(group.id);
    setName(group.name);
    setCode(group.code);
    setDescription(group.description ?? "");
    setMatchMode(parsed.any.length > 0 && parsed.all.length === 0 ? "any" : "all");
    setConditions(source.map((row, index) => ({
      id: `edit-${group.id}-${index}`,
      field: String(row.field ?? ""),
      operator: String(row.operator ?? "eq"),
      value: valueText(row.value),
    })));
    setShowBuilder(true);
    setPreview(null);
  }

  function serializeCondition(row: ConditionDraft) {
    const field = fieldByValue.get(row.field);
    if (row.operator === "exists") {
      return { field: row.field, operator: row.operator, value: row.value !== "false" };
    }
    if (row.operator === "in") {
      const values = row.value.split(",").map((item) => item.trim()).filter(Boolean);
      const numeric = field?.kind === "number" || field?.kind === "number_array";
      return {
        field: row.field,
        operator: row.operator,
        value: numeric ? values.map(Number) : values,
      };
    }
    const numeric = field?.kind === "number";
    return {
      field: row.field,
      operator: row.operator,
      value: numeric ? Number(row.value) : row.value,
    };
  }

  async function saveGroup(event: React.FormEvent) {
    event.preventDefault();
    if (!conditions.length) {
      setNotice("Add at least one live-worker condition to the dynamic group.");
      return;
    }
    setSaving(true);
    try {
      const rows = conditions.map(serializeCondition);
      const response = await fetch("/api/dynamic-worker-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "save-group",
          id: editingId,
          name,
          code,
          description,
          conditions: {
            version: 1,
            all: matchMode === "all" ? rows : [],
            any: matchMode === "any" ? rows : [],
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not save dynamic group.");
      const group = payload.group as GroupRow;
      resetBuilder();
      setShowBuilder(false);
      await load();
      setNotice(`${group.name} saved as Dynamic Group v${group.version}. Future worker events will resolve membership from this live definition.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save dynamic group.");
    } finally {
      setSaving(false);
    }
  }

  async function setActive(group: GroupRow, active: boolean) {
    setSaving(true);
    try {
      const response = await fetch("/api/dynamic-worker-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "set-active",
          id: group.id,
          active,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not update dynamic group.");
      await load();
      setPreview((current) => current?.group.id === group.id ? null : current);
      setNotice(`${group.name} ${active ? "enabled" : "disabled"} as version ${payload.group?.version ?? ""}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update dynamic group.");
    } finally {
      setSaving(false);
    }
  }

  async function previewGroup(group: GroupRow) {
    setPreviewingId(group.id);
    try {
      const response = await fetch(
        `/api/dynamic-worker-groups?organizationId=${organizationId}&previewGroupId=${group.id}`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not preview dynamic group.");
      setPreview(payload as PreviewPayload);
      setNotice(`${group.name}: ${payload.preview?.memberCount ?? 0} live member(s) from ${payload.preview?.totalWorkersEvaluated ?? 0} worker(s) evaluated.`);
    } catch (error) {
      setPreview(null);
      setNotice(error instanceof Error ? error.message : "Could not preview dynamic group.");
    } finally {
      setPreviewingId(null);
    }
  }

  if (!data) {
    return (
      <article className="card" style={{ marginTop: 16, padding: 18 }}>
        {loading ? "Loading Dynamic Groups…" : "Dynamic Groups unavailable."}
      </article>
    );
  }

  return (
    <section className="card" style={{ marginTop: 16 }} data-dynamic-worker-groups>
      <div className="card-header">
        <div>
          <div className="card-kicker">DYNAMIC GROUPS · SUPERGROUPS</div>
          <h2>Define live worker populations once</h2>
          <p>
            Reuse the same governed population across Automation Studio today, with WFM, permissions,
            approvals and reporting able to consume the same resolver next. Membership is calculated from
            authoritative worker attributes rather than manually maintained lists.
          </p>
        </div>
        <div className="run-actions" style={{ margin: 0 }}>
          <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => {
              resetBuilder();
              setShowBuilder((value) => !value);
            }}
          >
            <Plus size={14} /> Group
          </button>
        </div>
      </div>

      <div className="notice notice-slate" style={{ margin: "0 18px 18px" }}>
        <ShieldCheck size={16} />
        <span>
          <strong>Live and versioned.</strong> Editing or enabling a group creates a new group version.
          Employee-scoped Automation Studio events snapshot the resolved group ID, code, name and version into execution/event evidence.
        </span>
      </div>

      {showBuilder && (
        <form onSubmit={saveGroup} className="card" style={{ boxShadow: "none", margin: "0 18px 18px" }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">{editingId ? "EDIT LIVE GROUP" : "NEW LIVE GROUP"}</div>
              <h3>{editingId ? "Update a reusable population" : "Create a reusable population"}</h3>
            </div>
          </div>
          <div className="card-body">
            <div className="module-grid two" style={{ marginBottom: 12 }}>
              <label>
                Group name
                <input
                  required
                  value={name}
                  onChange={(event) => {
                    const next = event.target.value;
                    setName(next);
                    if (!editingId && (!code || code === name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))) {
                      setCode(next.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
                    }
                  }}
                  placeholder="Night shift support agents"
                  style={{ width: "100%", marginTop: 6 }}
                />
              </label>
              <label>
                Stable code
                <input
                  required
                  value={code}
                  disabled={editingId != null}
                  onChange={(event) => setCode(event.target.value.toLowerCase())}
                  placeholder="night-shift-support"
                  style={{ width: "100%", marginTop: 6 }}
                />
                {editingId != null && (
                  <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>
                    Stable identifier: code is immutable after creation so downstream workflow references do not break.
                  </small>
                )}
              </label>
            </div>
            <label style={{ display: "block", marginBottom: 12 }}>
              Description
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Reusable population for scheduling, automation and controls"
                style={{ width: "100%", marginTop: 6 }}
              />
            </label>

            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 12 }}>Match</span>
              <select value={matchMode} onChange={(event) => setMatchMode(event.target.value as "all" | "any")}>
                <option value="all">ALL conditions</option>
                <option value="any">ANY condition</option>
              </select>
              <button type="button" className="secondary-button" onClick={addCondition}>
                <Plus size={14} /> Condition
              </button>
            </div>

            {conditions.length === 0 && (
              <div className="empty-state">Add at least one condition. Empty groups are deliberately invalid.</div>
            )}

            {conditions.map((row) => {
              const field = fieldByValue.get(row.field);
              const operators = allowedOperators(field?.kind ?? "string", data.catalogs.operators);
              return (
                <div key={row.id} style={{ display: "grid", gridTemplateColumns: "1.25fr .8fr 1fr auto", gap: 8, marginBottom: 8 }}>
                  <select
                    value={row.field}
                    onChange={(event) => {
                      const nextField = fieldByValue.get(event.target.value);
                      updateCondition(row.id, {
                        field: event.target.value,
                        operator: nextField?.kind.includes("array") ? "contains" : "eq",
                        value: "",
                      });
                    }}
                  >
                    {data.catalogs.fields.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                  <select
                    value={row.operator}
                    onChange={(event) => updateCondition(row.id, { operator: event.target.value, value: "" })}
                  >
                    {operators.map((operator) => <option key={operator} value={operator}>{operator}</option>)}
                  </select>
                  {row.operator === "exists" ? (
                    <select value={row.value || "true"} onChange={(event) => updateCondition(row.id, { value: event.target.value })}>
                      <option value="true">exists</option>
                      <option value="false">does not exist</option>
                    </select>
                  ) : (
                    <input
                      required
                      type={field?.kind === "number" ? "number" : "text"}
                      value={row.value}
                      onChange={(event) => updateCondition(row.id, { value: event.target.value })}
                      placeholder={row.operator === "in" ? "comma,separated,values" : field?.kind.includes("array") ? "exact code" : "value"}
                    />
                  )}
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setConditions((rows) => rows.filter((item) => item.id !== row.id))}
                  >
                    Remove
                  </button>
                </div>
              );
            })}

            <div className="run-actions" style={{ marginTop: 14 }}>
              <button type="button" className="secondary-button" onClick={() => { resetBuilder(); setShowBuilder(false); }}>
                Cancel
              </button>
              <button className="primary-button" disabled={saving || !name.trim() || !code.trim() || conditions.length === 0}>
                {saving ? "Saving…" : editingId ? "Save new version" : "Create group"}
              </button>
            </div>
          </div>
        </form>
      )}

      <div className="card-body" style={{ paddingTop: 0 }}>
        {data.groups.length === 0 && (
          <div className="empty-state">No Dynamic Groups yet. Start with a population you currently repeat across workflows.</div>
        )}
        {data.groups.map((group) => (
          <div className="leave-request" key={group.id}>
            <div className="inline-icon purple"><UsersRound size={16} /></div>
            <div style={{ flex: 1 }}>
              <strong>{group.name}</strong>
              <span>
                {group.code} · v{group.version} · {group.active ? "live" : "disabled"}
                {(group.automationDependencyCount ?? 0) > 0 ? ` · used by ${group.automationDependencyCount} workflow(s)` : ""}
                {(group.permissionAssignmentCount ?? 0) > 0 ? ` · ${group.permissionAssignmentCount} permission guard(s)` : ""}
                {(group.activeApprovalPolicyCount ?? 0) > 0 ? ` · ${group.activeApprovalPolicyCount} active approval policy(ies)` : ""}
              </span>
              {group.description && <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>{group.description}</small>}
              {((group.permissionAssignmentCount ?? 0) > 0 || (group.activeApprovalPolicyCount ?? 0) > 0) && (
                <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>
                  Unlink permission guards and disable dependent approval policies before editing or disabling this group.
                </small>
              )}
              {(group.activeAutomationDependencyCount ?? 0) > 0 && (
                <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>
                  {group.activeAutomationDependencyCount} active automation dependency(ies) must be disabled before membership logic can change.
                </small>
              )}
            </div>
            <div className="run-actions" style={{ margin: 0 }}>
              <button className="secondary-button" type="button" onClick={() => void previewGroup(group)} disabled={previewingId === group.id}>
                <Eye size={14} /> {previewingId === group.id ? "Previewing…" : "Members"}
              </button>
              <button className="secondary-button" type="button" onClick={() => editGroup(group)}>
                <Pencil size={14} /> Edit
              </button>
              <button className="secondary-button" type="button" onClick={() => void setActive(group, !group.active)} disabled={saving}>
                {group.active ? "Disable" : "Enable"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {preview && (
        <article className="card" style={{ boxShadow: "none", margin: "0 18px 18px" }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">LIVE MEMBERSHIP · {preview.group.code} · V{preview.group.version}</div>
              <h3>{preview.preview.memberCount} member(s)</h3>
              <p>{preview.preview.totalWorkersEvaluated} current worker record(s) evaluated from authoritative HCM data.</p>
            </div>
            <span className={preview.group.active ? "status status-verified" : "status"}>
              {preview.group.active ? "Live" : "Disabled"}
            </span>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>WORKER</th><th>ORG / ROLE</th><th>LOCATION</th><th>CAPABILITY EVIDENCE</th></tr></thead>
              <tbody>
                {preview.preview.sampleMembers.length === 0 && (
                  <tr><td colSpan={4}><div className="empty-state">No workers currently match this definition.</div></td></tr>
                )}
                {preview.preview.sampleMembers.map((member) => (
                  <tr key={member.employeeId}>
                    <td><strong>{member.employeeName}</strong><small style={{ display: "block", color: "var(--muted)" }}>{member.employeeNo}</small></td>
                    <td>{member.department ?? "Unassigned"}<small style={{ display: "block", color: "var(--muted)" }}>{member.role} · {member.employmentType}</small></td>
                    <td>{member.location}</td>
                    <td>
                      <small style={{ display: "block" }}>
                        Skills: {member.verifiedSkillCodes.length ? member.verifiedSkillCodes.join(", ") : "—"}
                      </small>
                      <small style={{ display: "block", color: "var(--muted)" }}>
                        Credentials: {member.validCredentialCodes.length ? member.validCredentialCodes.join(", ") : "—"}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}
    </section>
  );
}
