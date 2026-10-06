"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  CircleAlert,
  GitBranch,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Workflow,
  Zap,
} from "lucide-react";

type TriggerCatalog = {
  value: string;
  label: string;
  category: string;
  employeeScoped: boolean;
  live: boolean;
};

type ConditionCatalog = {
  value: string;
  label: string;
  kind: string;
};

type ActionCatalog = {
  value: string;
  label: string;
  category: string;
};

type AutomationRule = {
  id: number;
  name: string;
  trigger: string;
  conditions: unknown;
  actions: unknown;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type Execution = {
  id: number;
  ruleId: number;
  employeeId: number | null;
  trigger: string;
  eventKey: string;
  status: string;
  result: unknown;
  error: string | null;
  cursor?: number;
  resumeAt?: string | null;
  waitingApprovalTaskId?: number | null;
  createdAt: string;
};

type StudioData = {
  rules: AutomationRule[];
  executions: Execution[];
  catalogs: {
    triggers: TriggerCatalog[];
    liveTriggers: string[];
    plannedTriggers: string[];
    conditions: ConditionCatalog[];
    operators: string[];
    actions: ActionCatalog[];
  };
  orgUnits: Array<{ id: number; name: string; code: string }>;
  permissionSets: Array<{ id: number; name: string; active: boolean }>;
  benefitPlans: Array<{
    id: number;
    name: string;
    category: string;
    active: boolean;
    employeeShare: string;
    cap: string | null;
  }>;
  analytics: {
    activeRules: number;
    recentExecutions: number;
    completed: number;
    partial: number;
    failed: number;
    waiting: number;
    successRate: number;
  };
};

type ConditionDraft = {
  id: string;
  field: string;
  operator: string;
  value: string;
};

type ActionDraft = {
  id: string;
  type: string;
  title: string;
  owner: string;
  detail: string;
  approver: string;
  priority: string;
  recipient: string;
  email: string;
  subject: string;
  body: string;
  permissionSetId: string;
  planId: string;
  monthlyContribution: string;
  amount: string;
  reason: string;
  checklist: string;
  waitAmount: string;
  waitUnit: string;
  branchField: string;
  branchOperator: string;
  branchValue: string;
  branchThenTitle: string;
  branchElseTitle: string;
};

const defaultAction = (id: string): ActionDraft => ({
  id,
  type: "create_task",
  title: "",
  owner: "People Ops",
  detail: "",
  approver: "People Ops",
  priority: "Normal",
  recipient: "employee",
  email: "",
  subject: "",
  body: "",
  permissionSetId: "",
  planId: "",
  monthlyContribution: "",
  amount: "",
  reason: "",
  checklist: "",
  waitAmount: "1",
  waitUnit: "days",
  branchField: "department",
  branchOperator: "eq",
  branchValue: "",
  branchThenTitle: "",
  branchElseTitle: "",
});

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });

function conditionCount(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const row = value as Record<string, unknown>;
  if (Array.isArray(row.all) || Array.isArray(row.any)) {
    return (Array.isArray(row.all) ? row.all.length : 0) + (Array.isArray(row.any) ? row.any.length : 0);
  }
  return Object.keys(row).length;
}

function actionCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function actionAllowed(trigger: TriggerCatalog | undefined, type: string) {
  if (!trigger) return false;
  if (["revoke_sessions", "deactivate_access"].includes(type)) return trigger.value === "employee.separated";
  if (["assign_permission_set", "assign_benefit"].includes(type)) {
    return ["employee.hired", "employee.updated", "employee.moved", "employee.promoted", "candidate.hired"].includes(trigger.value);
  }
  if (["create_task", "create_onboarding_checklist"].includes(type)) return trigger.employeeScoped;
  return true;
}

export function AutomationStudioPanel({
  organizationId,
  setNotice,
}: {
  organizationId: number;
  setNotice: (message: string) => void;
}) {
  const [data, setData] = useState<StudioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("employee.hired");
  const [matchMode, setMatchMode] = useState<"all" | "any">("all");
  const [conditions, setConditions] = useState<ConditionDraft[]>([]);
  const [actions, setActions] = useState<ActionDraft[]>([defaultAction("a1")]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/automation-studio?organizationId=${organizationId}`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load Automation Studio.");
      setData(payload as StudioData);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load Automation Studio.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  const selectedTrigger = useMemo(
    () => data?.catalogs.triggers.find((item) => item.value === trigger),
    [data, trigger],
  );
  const ruleById = useMemo(
    () => new Map((data?.rules ?? []).map((rule) => [rule.id, rule])),
    [data],
  );

  function resetBuilder() {
    setName("");
    setTrigger("employee.hired");
    setMatchMode("all");
    setConditions([]);
    setActions([defaultAction("a" + Date.now())]);
  }

  function addCondition() {
    const field = data?.catalogs.conditions[0]?.value ?? "department";
    setConditions((rows) => [...rows, {
      id: "c" + Date.now() + rows.length,
      field,
      operator: "eq",
      value: "",
    }]);
  }

  function updateCondition(id: string, patch: Partial<ConditionDraft>) {
    setConditions((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function addAction() {
    setActions((rows) => [...rows, defaultAction("a" + Date.now() + rows.length)]);
  }

  function updateAction(id: string, patch: Partial<ActionDraft>) {
    setActions((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function serializeCondition(row: ConditionDraft) {
    const field = data?.catalogs.conditions.find((item) => item.value === row.field);
    if (row.operator === "exists") {
      return { field: row.field, operator: row.operator, value: row.value !== "false" };
    }
    if (row.operator === "in") {
      const values = row.value.split(",").map((item) => item.trim()).filter(Boolean);
      return {
        field: row.field,
        operator: row.operator,
        value: field?.kind === "number" ? values.map(Number) : values,
      };
    }
    return {
      field: row.field,
      operator: row.operator,
      value: field?.kind === "number" ? Number(row.value) : row.value,
    };
  }

  function serializeAction(row: ActionDraft): Record<string, unknown> {
    if (row.type === "wait") {
      return { type: row.type, amount: Number(row.waitAmount), unit: row.waitUnit };
    }
    if (row.type === "approval_gate") {
      return {
        type: row.type,
        title: row.title,
        detail: row.detail,
        approver: row.approver,
        priority: row.priority,
        dueLabel: "Workflow paused for approval",
      };
    }
    if (row.type === "branch") {
      const field = data?.catalogs.conditions.find((item) => item.value === row.branchField);
      const value = row.branchOperator === "exists"
        ? row.branchValue !== "false"
        : row.branchOperator === "in"
          ? row.branchValue.split(",").map((item) => item.trim()).filter(Boolean).map((item) => field?.kind === "number" ? Number(item) : item)
          : field?.kind === "number" ? Number(row.branchValue) : row.branchValue;
      return {
        type: row.type,
        conditions: {
          version: 1,
          all: [{ field: row.branchField, operator: row.branchOperator, value }],
          any: [],
        },
        then: [{ type: "create_task", title: row.branchThenTitle, owner: row.owner || "People Ops" }],
        else: row.branchElseTitle.trim()
          ? [{ type: "create_task", title: row.branchElseTitle, owner: row.owner || "People Ops" }]
          : [],
      };
    }
    if (row.type === "create_task") {
      return { type: row.type, title: row.title, owner: row.owner };
    }
    if (row.type === "create_onboarding_checklist") {
      return {
        type: row.type,
        items: row.checklist.split("\n").map((title) => title.trim()).filter(Boolean).map((title) => ({
          title,
          owner: row.owner || "People Ops",
          kind: "automation",
        })),
      };
    }
    if (row.type === "request_approval") {
      return {
        type: row.type,
        title: row.title,
        detail: row.detail,
        approver: row.approver,
        priority: row.priority,
      };
    }
    if (row.type === "send_email") {
      return {
        type: row.type,
        recipient: row.recipient,
        ...(row.recipient === "custom" ? { email: row.email } : {}),
        subject: row.subject,
        body: row.body,
      };
    }
    if (row.type === "assign_permission_set") {
      return { type: row.type, permissionSetId: Number(row.permissionSetId) };
    }
    if (row.type === "assign_benefit") {
      return {
        type: row.type,
        planId: Number(row.planId),
        ...(row.monthlyContribution ? { monthlyContribution: Number(row.monthlyContribution) } : {}),
      };
    }
    if (row.type === "request_payroll_adjustment") {
      return {
        type: row.type,
        amount: Number(row.amount),
        reason: row.reason,
        approver: row.approver || "Payroll",
      };
    }
    return { type: row.type };
  }

  async function saveRule(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedTrigger?.live) {
      setNotice("That trigger is planned but its authoritative event adapter is not live yet.");
      return;
    }

    const invalidAction = actions.find((row) => !actionAllowed(selectedTrigger, row.type));
    if (invalidAction) {
      setNotice("One or more THEN actions are not allowed for this trigger.");
      return;
    }

    setSaving(true);
    try {
      const conditionRows = conditions.map(serializeCondition);
      const response = await fetch("/api/automation-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "save-rule",
          name,
          trigger,
          conditions: {
            version: 1,
            all: matchMode === "all" ? conditionRows : [],
            any: matchMode === "any" ? conditionRows : [],
          },
          actions: actions.map(serializeAction),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not save automation rule.");
      resetBuilder();
      setShowBuilder(false);
      await load();
      setNotice("Automation Studio rule saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save automation rule.");
    } finally {
      setSaving(false);
    }
  }

  async function setRuleActive(rule: AutomationRule, active: boolean) {
    try {
      const response = await fetch("/api/automation-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "set-active",
          ruleId: rule.id,
          active,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not update automation rule.");
      await load();
      setNotice(rule.name + (active ? " enabled." : " disabled."));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update automation rule.");
    }
  }

  if (!data) {
    return (
      <div className="card" style={{ padding: 24 }}>
        {loading ? "Loading Automation Studio…" : "Automation Studio unavailable."}
      </div>
    );
  }

  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">AUTOMATION STUDIO</div>
          <h1>Build governed WHEN / IF / THEN workflows with waits, approvals and branches.</h1>
          <p>
            Connect authoritative payroll, workforce, HCM, access and integration events without letting automation bypass approval, payroll or security controls.
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </button>
          <button className="primary-button" onClick={() => setShowBuilder((value) => !value)}>
            <Plus size={15} /> Workflow
          </button>
        </div>
      </div>

      <section className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="stat-card">
          <div className="stat-icon purple"><Workflow size={19} /></div>
          <p>ACTIVE RULES</p>
          <h3>{data.analytics.activeRules}</h3>
          <span>{data.rules.length} configured</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon blue"><Activity size={19} /></div>
          <p>RECENT RUNS</p>
          <h3>{data.analytics.recentExecutions}</h3>
          <span>Last 100 execution records</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon green"><CheckCircle2 size={19} /></div>
          <p>SUCCESS RATE</p>
          <h3>{data.analytics.successRate}%</h3>
          <span>{data.analytics.completed} fully completed</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon amber"><CircleAlert size={19} /></div>
          <p>PAUSED / ATTENTION</p>
          <h3>{data.analytics.waiting}</h3>
          <span>{data.analytics.failed} failed · {data.analytics.partial} partial</span>
        </article>
      </section>

      <article className="card" style={{ marginTop: 16, padding: 18 }}>
        <div className="notice notice-slate" style={{ margin: 0 }}>
          <ShieldCheck size={16} className="i-purple" />
          <span>
            <strong>Governed execution.</strong> Studio runs after authoritative transactions commit. Timed waits persist across worker restarts, approval gates pause the exact execution, payroll adjustments remain approval requests, access removal is separation-only, and external calls use registered signed webhooks rather than arbitrary URLs.
          </span>
        </div>
      </article>

      {showBuilder && (
        <form onSubmit={saveRule} className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">WORKFLOW BUILDER</div>
              <h2>Configure one deterministic automation</h2>
              <p>Steps execute from top to bottom. Waits resume from the scheduler, approval gates pause until a decision, and branches evaluate the original event context.</p>
            </div>
          </div>

          <div className="card-body">
            <label style={{ display: "block", marginBottom: 16 }}>
              Workflow name
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Finance new-hire onboarding"
                style={{ width: "100%", marginTop: 6 }}
              />
            </label>

            <div className="module-grid" style={{ gridTemplateColumns: "1fr", gap: 12 }}>
              <section className="card" style={{ boxShadow: "none", borderLeft: "4px solid var(--brand)" }}>
                <div className="card-header">
                  <div>
                    <div className="card-kicker">WHEN</div>
                    <h2 style={{ fontSize: 15 }}>Authoritative event</h2>
                  </div>
                  <Zap size={17} className="i-purple" />
                </div>
                <div className="card-body">
                  <select
                    value={trigger}
                    onChange={(event) => {
                      setTrigger(event.target.value);
                      setActions((rows) => rows.map((row) => (
                        actionAllowed(data.catalogs.triggers.find((item) => item.value === event.target.value), row.type)
                          ? row
                          : { ...row, type: "request_approval" }
                      )));
                    }}
                    style={{ width: "100%" }}
                  >
                    {data.catalogs.triggers.map((item) => (
                      <option key={item.value} value={item.value} disabled={!item.live}>
                        {item.category} · {item.label}{item.live ? "" : " · planned"}
                      </option>
                    ))}
                  </select>
                  <div className="modal-note" style={{ marginTop: 8 }}>
                    {selectedTrigger?.live
                      ? "Live adapter: this event is emitted by the governed source transaction."
                      : "Planned adapter: visible on the Studio roadmap but not selectable until the authoritative event source is connected."}
                  </div>
                </div>
              </section>

              <section className="card" style={{ boxShadow: "none", borderLeft: "4px solid var(--amber, #D99C28)" }}>
                <div className="card-header">
                  <div>
                    <div className="card-kicker">IF</div>
                    <h2 style={{ fontSize: 15 }}>Data conditions</h2>
                  </div>
                  <button type="button" className="secondary-button" onClick={addCondition}>
                    <Plus size={14} /> Condition
                  </button>
                </div>
                <div className="card-body">
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 12 }}>Match</span>
                    <select value={matchMode} onChange={(event) => setMatchMode(event.target.value as "all" | "any")}>
                      <option value="all">ALL conditions</option>
                      <option value="any">ANY condition</option>
                    </select>
                  </div>
                  {conditions.length === 0 && (
                    <div className="empty-state">No IF filter. Every matching WHEN event can run this workflow.</div>
                  )}
                  {conditions.map((row) => {
                    const field = data.catalogs.conditions.find((item) => item.value === row.field);
                    return (
                      <div key={row.id} style={{ display: "grid", gridTemplateColumns: "1.3fr .8fr 1fr auto", gap: 8, marginBottom: 8 }}>
                        <select value={row.field} onChange={(event) => updateCondition(row.id, { field: event.target.value, value: "" })}>
                          {data.catalogs.conditions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </select>
                        <select value={row.operator} onChange={(event) => updateCondition(row.id, { operator: event.target.value })}>
                          {data.catalogs.operators.map((operator) => <option key={operator} value={operator}>{operator}</option>)}
                        </select>
                        {row.operator === "exists" ? (
                          <select value={row.value || "true"} onChange={(event) => updateCondition(row.id, { value: event.target.value })}>
                            <option value="true">exists</option>
                            <option value="false">does not exist</option>
                          </select>
                        ) : (
                          <input
                            required
                            type={field?.kind === "number" && row.operator !== "in" ? "number" : "text"}
                            value={row.value}
                            onChange={(event) => updateCondition(row.id, { value: event.target.value })}
                            placeholder={row.operator === "in" ? "Comma-separated values" : field?.kind === "number" ? "0" : "Value"}
                          />
                        )}
                        <button type="button" className="icon-button" onClick={() => setConditions((rows) => rows.filter((item) => item.id !== row.id))}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="card" style={{ boxShadow: "none", borderLeft: "4px solid var(--green, #2E9B74)" }}>
                <div className="card-header">
                  <div>
                    <div className="card-kicker">THEN</div>
                    <h2 style={{ fontSize: 15 }}>Governed actions</h2>
                  </div>
                  <button type="button" className="secondary-button" onClick={addAction}>
                    <Plus size={14} /> Action
                  </button>
                </div>
                <div className="card-body">
                  {actions.map((row, index) => (
                    <div key={row.id} className="card" style={{ boxShadow: "none", padding: 12, marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 10 }}>
                        <strong style={{ fontSize: 12 }}>THEN {index + 1}</strong>
                        {actions.length > 1 && (
                          <button type="button" className="icon-button" onClick={() => setActions((items) => items.filter((item) => item.id !== row.id))}>
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                      <select
                        value={row.type}
                        onChange={(event) => updateAction(row.id, { type: event.target.value })}
                        style={{ width: "100%", marginBottom: 10 }}
                      >
                        {data.catalogs.actions.map((item) => (
                          <option
                            key={item.value}
                            value={item.value}
                            disabled={!actionAllowed(selectedTrigger, item.value)}
                          >
                            {item.category} · {item.label}
                          </option>
                        ))}
                      </select>

                      {row.type === "wait" && (
                        <div className="setting-form">
                          <label>Wait amount<input required type="number" min="1" value={row.waitAmount} onChange={(event) => updateAction(row.id, { waitAmount: event.target.value })} /></label>
                          <label>Unit<select value={row.waitUnit} onChange={(event) => updateAction(row.id, { waitUnit: event.target.value })}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option></select></label>
                          <div className="modal-note">The execution is persisted and resumed by the scheduler. Maximum delay is 30 days.</div>
                        </div>
                      )}

                      {row.type === "approval_gate" && (
                        <div className="setting-form">
                          <label>Approval title<input required value={row.title} onChange={(event) => updateAction(row.id, { title: event.target.value })} /></label>
                          <label>Approver<input value={row.approver} onChange={(event) => updateAction(row.id, { approver: event.target.value })} placeholder="manager or named approver" /></label>
                          <label>Detail<input required value={row.detail} onChange={(event) => updateAction(row.id, { detail: event.target.value })} /></label>
                          <label>Priority<select value={row.priority} onChange={(event) => updateAction(row.id, { priority: event.target.value })}><option>Normal</option><option>High</option></select></label>
                          <div className="modal-note">This is a true gate: later workflow steps do not execute until the task is approved. A decline ends the execution as failed evidence.</div>
                        </div>
                      )}

                      {row.type === "branch" && (() => {
                        const branchField = data.catalogs.conditions.find((item) => item.value === row.branchField);
                        return (
                          <div className="setting-form">
                            <label>Branch field<select value={row.branchField} onChange={(event) => updateAction(row.id, { branchField: event.target.value, branchValue: "" })}>{data.catalogs.conditions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                            <label>Operator<select value={row.branchOperator} onChange={(event) => updateAction(row.id, { branchOperator: event.target.value })}>{data.catalogs.operators.map((operator) => <option key={operator} value={operator}>{operator}</option>)}</select></label>
                            {row.branchOperator === "exists" ? (
                              <label>Value<select value={row.branchValue || "true"} onChange={(event) => updateAction(row.id, { branchValue: event.target.value })}><option value="true">exists</option><option value="false">does not exist</option></select></label>
                            ) : (
                              <label>Value<input required type={branchField?.kind === "number" && row.branchOperator !== "in" ? "number" : "text"} value={row.branchValue} onChange={(event) => updateAction(row.id, { branchValue: event.target.value })} placeholder={row.branchOperator === "in" ? "Comma-separated values" : "Value"} /></label>
                            )}
                            <label>TRUE branch task<input required value={row.branchThenTitle} onChange={(event) => updateAction(row.id, { branchThenTitle: event.target.value })} placeholder="Create task when condition matches" /></label>
                            <label>ELSE branch task<input value={row.branchElseTitle} onChange={(event) => updateAction(row.id, { branchElseTitle: event.target.value })} placeholder="Optional fallback task" /></label>
                            <label>Task owner<input value={row.owner} onChange={(event) => updateAction(row.id, { owner: event.target.value })} /></label>
                            <div className="modal-note">The engine supports nested branch step arrays; this first builder surface creates a governed task on the TRUE branch and an optional task on ELSE.</div>
                          </div>
                        );
                      })()}

                      {row.type === "create_task" && (
                        <div className="setting-form">
                          <label>Task<input required value={row.title} onChange={(event) => updateAction(row.id, { title: event.target.value })} /></label>
                          <label>Owner<input value={row.owner} onChange={(event) => updateAction(row.id, { owner: event.target.value })} /></label>
                        </div>
                      )}

                      {row.type === "create_onboarding_checklist" && (
                        <div className="setting-form">
                          <label>Checklist items, one per line<textarea required value={row.checklist} onChange={(event) => updateAction(row.id, { checklist: event.target.value })} rows={5} /></label>
                          <label>Owner<input value={row.owner} onChange={(event) => updateAction(row.id, { owner: event.target.value })} /></label>
                        </div>
                      )}

                      {row.type === "request_approval" && (
                        <div className="setting-form">
                          <label>Approval title<input required value={row.title} onChange={(event) => updateAction(row.id, { title: event.target.value })} /></label>
                          <label>Approver<input value={row.approver} onChange={(event) => updateAction(row.id, { approver: event.target.value })} placeholder="manager or named approver" /></label>
                          <label>Detail<input required value={row.detail} onChange={(event) => updateAction(row.id, { detail: event.target.value })} /></label>
                          <label>Priority<select value={row.priority} onChange={(event) => updateAction(row.id, { priority: event.target.value })}><option>Normal</option><option>High</option></select></label>
                        </div>
                      )}

                      {row.type === "send_email" && (
                        <div className="setting-form">
                          <label>Recipient<select value={row.recipient} onChange={(event) => updateAction(row.id, { recipient: event.target.value })}><option value="employee">Employee</option><option value="manager">Manager</option><option value="custom">Custom email</option></select></label>
                          {row.recipient === "custom" && <label>Email<input required type="email" value={row.email} onChange={(event) => updateAction(row.id, { email: event.target.value })} /></label>}
                          <label>Subject<input required value={row.subject} onChange={(event) => updateAction(row.id, { subject: event.target.value })} /></label>
                          <label>Message<textarea required value={row.body} onChange={(event) => updateAction(row.id, { body: event.target.value })} rows={4} /></label>
                        </div>
                      )}

                      {row.type === "assign_permission_set" && (
                        <label>Access policy
                          <select required value={row.permissionSetId} onChange={(event) => updateAction(row.id, { permissionSetId: event.target.value })} style={{ width: "100%", marginTop: 6 }}>
                            <option value="">Choose permission set</option>
                            {data.permissionSets.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                          </select>
                        </label>
                      )}

                      {row.type === "assign_benefit" && (
                        <div className="setting-form">
                          <label>Benefit plan<select required value={row.planId} onChange={(event) => updateAction(row.id, { planId: event.target.value })}><option value="">Choose plan</option>{data.benefitPlans.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.category}</option>)}</select></label>
                          <label>Employee monthly contribution<input type="number" min="0" step="0.01" value={row.monthlyContribution} onChange={(event) => updateAction(row.id, { monthlyContribution: event.target.value })} placeholder="Use plan default" /></label>
                        </div>
                      )}

                      {row.type === "request_payroll_adjustment" && (
                        <div className="setting-form">
                          <label>Requested amount<input required type="number" step="0.01" value={row.amount} onChange={(event) => updateAction(row.id, { amount: event.target.value })} /></label>
                          <label>Approver<input value={row.approver || "Payroll"} onChange={(event) => updateAction(row.id, { approver: event.target.value })} /></label>
                          <label>Reason<input required value={row.reason} onChange={(event) => updateAction(row.id, { reason: event.target.value })} /></label>
                          <div className="modal-note">This creates a high-priority approval request. Automation never posts money directly to payroll.</div>
                        </div>
                      )}

                      {row.type === "webhook" && (
                        <div className="modal-note">Calls only registered signed webhook endpoints subscribed to <code>automation.triggered</code>. Arbitrary URLs are not accepted.</div>
                      )}
                      {row.type === "revoke_sessions" && <div className="modal-note">Separation-only: revokes active login sessions for linked employee users.</div>}
                      {row.type === "deactivate_access" && <div className="modal-note">Separation-only: deactivates this workspace membership and SCIM identity, then revokes sessions. It does not disable a shared user globally.</div>}
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="run-actions" style={{ marginTop: 16 }}>
              <button type="button" className="secondary-button" onClick={() => { resetBuilder(); setShowBuilder(false); }}>Cancel</button>
              <button className="primary-button" disabled={saving || !name.trim() || !selectedTrigger?.live}>
                <Play size={14} /> {saving ? "Saving…" : "Save workflow"}
              </button>
            </div>
          </div>
        </form>
      )}

      <section className="module-grid two" style={{ marginTop: 16 }}>
        <article className="card">
          <div className="card-header">
            <div>
              <div className="card-kicker">WORKFLOWS</div>
              <h2>Configured automations</h2>
              <p>Rules are scoped to this workspace and execute only on their exact event.</p>
            </div>
          </div>
          {data.rules.length === 0 && <div className="empty-state">No Automation Studio workflows yet.</div>}
          {data.rules.map((rule) => {
            const triggerInfo = data.catalogs.triggers.find((item) => item.value === rule.trigger);
            return (
              <div className="leave-request" key={rule.id}>
                <div className="inline-icon purple"><Workflow size={16} /></div>
                <div style={{ flex: 1 }}>
                  <strong>{rule.name}</strong>
                  <span>
                    {triggerInfo?.label ?? rule.trigger} · {conditionCount(rule.conditions)} IF · {actionCount(rule.actions)} THEN · {rule.active ? "active" : "disabled"}
                    {triggerInfo && !triggerInfo.live ? " · adapter planned" : ""}
                  </span>
                </div>
                <button className="secondary-button" onClick={() => void setRuleActive(rule, !rule.active)}>
                  {rule.active ? "Disable" : "Enable"}
                </button>
              </div>
            );
          })}
        </article>

        <article className="card">
          <div className="card-header">
            <div>
              <div className="card-kicker">EVENT COVERAGE</div>
              <h2>Live vs planned adapters</h2>
              <p>The catalog can grow without pretending a scheduled/compliance source is wired before it really is.</p>
            </div>
            <GitBranch size={17} className="i-purple" />
          </div>
          <div className="card-body">
            {data.catalogs.triggers.map((item) => (
              <div className="payslip-line" key={item.value} style={{ gridTemplateColumns: "1fr auto" }}>
                <span>{item.label}<em>{item.category} · {item.value}</em></span>
                <b>{item.live ? "Live" : "Planned"}</b>
              </div>
            ))}
          </div>
        </article>
      </section>

      <article className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">EXECUTION EVIDENCE</div>
            <h2>Recent Automation Studio runs</h2>
            <p>Every rule/event pair is idempotent. Paused runs preserve their cursor, workflow snapshot and event context so they can resume without starting over.</p>
          </div>
          <Bot size={17} className="i-purple" />
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>WORKFLOW</th><th>EVENT</th><th>EMPLOYEE</th><th>STATUS</th><th>TIME</th></tr></thead>
            <tbody>
              {data.executions.length === 0 && <tr><td colSpan={5}><div className="empty-state">No Automation Studio executions yet.</div></td></tr>}
              {data.executions.map((row) => (
                <tr key={row.id}>
                  <td>{ruleById.get(row.ruleId)?.name ?? `Rule #${row.ruleId}`}</td>
                  <td><strong>{row.trigger}</strong><small style={{ display: "block", color: "var(--muted)" }}>{row.eventKey}</small></td>
                  <td>{row.employeeId ? `#${row.employeeId}` : "Organization"}</td>
                  <td>
                    <span className={row.status === "completed" ? "status status-verified" : row.status === "failed" ? "status status-failed" : "status"}>
                      {row.status}
                    </span>
                    {row.error && <small style={{ display: "block", color: "var(--danger)", maxWidth: 340 }}>{row.error}</small>}
                  </td>
                  <td>
                    {formatDateTime(row.createdAt)}
                    {row.resumeAt && <small style={{ display: "block", color: "var(--muted)" }}>Resumes {formatDateTime(row.resumeAt)}</small>}
                    {row.waitingApprovalTaskId && <small style={{ display: "block", color: "var(--muted)" }}>Approval #{row.waitingApprovalTaskId}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}
