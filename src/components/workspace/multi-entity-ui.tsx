"use client";

import { useEffect, useState } from "react";
import type { DashboardData, Employee } from "./types";

export type EntityWorkspace = NonNullable<DashboardData["multiEntity"]>;

/** Only installed when the feature is enabled. No changes to global fetch while OFF. */
export function useMultiEntityRequestHeaders(context: EntityWorkspace | undefined) {
  const enabled = Boolean(context?.enabled);
  const entityId = context?.legalEntityId ?? null;
  useEffect(() => {
    if (!enabled) return;
    const original = window.fetch;
    window.fetch = function entityAwareFetch(input: RequestInfo | URL, init?: RequestInit) {
      const urlText = input instanceof Request ? input.url : String(input);
      const url = new URL(urlText, window.location.origin);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
        return original.call(window, input, init);
      }
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
      headers.set("x-legal-entity-id", entityId === null
        ? "all" : String(entityId));
      return original.call(window, input, { ...init, headers });
    };
    return () => { window.fetch = original; };
  }, [enabled, entityId]);
}

export function EntitySwitcher({ context, organizationId }: {
  context?: EntityWorkspace; organizationId: number;
}) {
  const [value, setValue] = useState(context?.legalEntityId?.toString() ?? "all");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (!context?.enabled) return null;
  if (!context.group && !context.canSwitch) return (
    <span className="topbar-link" role="status" aria-label="Assigned legal employer">
      {context.entities.find(entity => entity.id === context.legalEntityId)?.displayName ?? "Assigned entity"}
    </span>
  );
  async function change(next: string) {
    setPending(true); setError("");
    try {
      const response = await fetch("/api/multi-entity/context", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, legalEntityId: next === "all" ? null : Number(next) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not change legal employer.");
      setValue(next);
      window.location.reload(); // Rehydrate ALL views from the server-authorized scope.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Entity selection failed.");
      setPending(false);
    }
  }
  return (
    <label className="topbar-link" style={{ display: "grid", gap: 3, minWidth: 120, maxWidth: "min(42vw, 250px)" }}>
      <span style={{ fontSize: 10 }}>Legal entity</span>
      <select aria-label="Legal entity switcher" value={value} disabled={pending}
        onChange={event => void change(event.target.value)}
        style={{ maxWidth: "100%", fontSize: 12 }}>
        {context.group && <option value="all">All entities</option>}
        {context.entities.map(entity => <option key={entity.id} value={entity.id}>
          {entity.displayName}
        </option>)}
      </select>
      {error && <span role="alert" style={{ fontSize: 11, color: "var(--danger)" }}>{error}</span>}
    </label>
  );
}

/** Not rendered at all when flag is off; entity badge is always visible when ON. */
export function EntityBadge({ context, legalEntityId, label }: {
  context?: EntityWorkspace;
  legalEntityId?: number | null;
  label?: string;
}) {
  if (!context?.enabled) return null;
  const entity = context.entities.find(row => row.id === legalEntityId);
  return <span className="badge" aria-label="Legal employer" style={{
    display: "inline-flex", alignItems: "center", borderRadius: 6,
    padding: "4px 8px", border: "1px solid var(--line)", fontSize: 11,
    background: "var(--canvas-subtle)", maxWidth: "100%", overflowWrap: "anywhere",
  }}>{label ?? entity?.displayName ?? (legalEntityId ? "Entity not available" : "Entity attribution required")}</span>;
}

export function EntityFilter({ context, organizationId, title = "Filter by entity" }: {
  context?: EntityWorkspace; organizationId: number; title?: string;
}) {
  if (!context?.group && !context?.canSwitch) return null;
  return <div style={{ marginBottom: 12 }}>
    <span className="card-kicker">{title}</span>
    <EntitySwitcher context={context} organizationId={organizationId} />
  </div>;
}

type SettingsEntity = {
  id: number; code: string; displayName: string; legalName: string;
  registeredAddress: string; birTin: string; birBranchCode: string;
  sssEmployerNo: string; philHealthEmployerNo: string; pagIbigEmployerNo: string;
  payrollCalendarMode: string; statutoryDeductionTiming: string;
  disbursementBankCode: string; disbursementAccountName: string; disbursementAccount: string | null;
};
const settingsFields = [
  { key: "legalName", label: "Registered legal name" },
  { key: "registeredAddress", label: "Registered address" },
  { key: "birTin", label: "Employer BIR TIN (9 digits)" },
  { key: "birBranchCode", label: "BIR branch code" },
  { key: "sssEmployerNo", label: "SSS employer number" },
  { key: "philHealthEmployerNo", label: "PhilHealth employer number" },
  { key: "pagIbigEmployerNo", label: "Pag-IBIG employer number" },
  { key: "disbursementBankCode", label: "Bank code" },
  { key: "disbursementAccountName", label: "Account name" },
  { key: "disbursementAccount", label: "Replace bank account" },
] as const;

export function EntitySettingsView({ context, organizationId }: {
  context: EntityWorkspace; organizationId: number;
}) {
  const [entities, setEntities] = useState<SettingsEntity[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [selected, setSelected] = useState<number | null>(context.legalEntityId);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [state, setState] = useState<"loading" | "ready" | "error" | "saving">("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch("/api/multi-entity/settings?organizationId=" + organizationId,
          { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? "Could not load entities.");
        if (alive) {
          setEntities(payload.entities ?? []);
          setCanEdit(Boolean(payload.canEdit));
          setSelected(current => current ?? payload.entities?.[0]?.id ?? null);
          setError(""); setState("ready");
        }
      } catch (e) { if (alive) { setError(e instanceof Error ? e.message : "Loading failed."); setState("error"); } }
    })();
    return () => { alive = false; };
  }, [organizationId, retry]);

  const active = entities.find(row => row.id === selected);
  function changeSelected(id: number) { setSelected(id); setDraft({}); setNotice(""); setError(""); }
  async function save() {
    if (!active || !canEdit) return;
    setState("saving"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/multi-entity/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, legalEntityId: active.id, ...draft }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not save.");
      setEntities(prev => prev.map(row => row.id === active.id ? payload.entity : row));
      setDraft({});
      setNotice("Entity details saved and audited.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
    finally { setState("ready"); }
  }

  return <section className="card" style={{ padding: 18, maxWidth: 850 }}>
    <div className="card-kicker">LEGAL EMPLOYERS</div>
    <h2>Entities settings</h2>
    <p>Employer numbers and bank accounts are masked. Registration and payout details are read-only until a reviewed versioned update process is available.</p>
    {state === "loading" && <p role="status">Loading entity settings…</p>}
    {state === "error" && <div role="alert">{error}<button className="secondary-button" onClick={() => setRetry(x => x + 1)}>Retry</button></div>}
    {state !== "loading" && state !== "error" && entities.length === 0 && <p>No legal entities have been configured for your tenant.</p>}
    {state !== "loading" && state !== "error" && active && <>
      <label>Legal employer
        <select value={selected ?? ""} onChange={event => changeSelected(Number(event.target.value))}>
          {entities.map(entity => <option value={entity.id} key={entity.id}>{entity.code} · {entity.displayName}</option>)}
        </select>
      </label>
      <p>Registered legal names, statutory employer numbers, addresses and payout destinations are read-only here until a versioned, independently reviewed update flow is approved. Authorized administrators may change only the pay schedule.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 14, marginTop: 16 }}>
        {settingsFields.map(field => {
          const sensitive = ["birTin", "birBranchCode", "sssEmployerNo", "philHealthEmployerNo", "pagIbigEmployerNo", "disbursementAccount"].includes(field.key);
          const masked = String(active[field.key] ?? "");
          return <label key={field.key} style={{ display: "grid", gap: 5 }}>
            {field.label}
            <input aria-label={field.label} disabled
              placeholder={sensitive ? masked || "Not set" : undefined}
              value={sensitive ? "" : masked} />
          </label>;
        })}
        <label style={{ display: "grid", gap: 5 }}>Pay schedule
          <select disabled={!canEdit} value={draft.payrollCalendarMode ?? active.payrollCalendarMode}
            onChange={event => setDraft(old => ({ ...old, payrollCalendarMode: event.target.value }))}>
            <option value="flexible">Flexible</option><option value="ph_semi_monthly">Philippine semi-monthly</option>
          </select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {canEdit && <button className="primary-button" disabled={state === "saving" || !Object.keys(draft).length}
        onClick={() => void save()} style={{ marginTop: 16 }}>
        {state === "saving" ? "Saving…" : "Save audited changes"}
      </button>}
      {canEdit && <EntityRegistrationReview key={active.id} entity={active}
        organizationId={organizationId} onApplied={() => setRetry(value => value + 1)} />}
    </>}
  </section>;
}

type RegistrationChangeSummary = {
  id: number; status: string; changedFields: string[];
  requestedByUserId: number; canReview: boolean;
};
type RegistrationVersionSummary = { id: number; revision: number; effectiveDate: string };

function EntityRegistrationReview({ entity, organizationId, onApplied }: {
  entity: SettingsEntity; organizationId: number; onApplied: () => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<RegistrationChangeSummary[]>([]);
  const [versions, setVersions] = useState<RegistrationVersionSummary[]>([]);
  const [today, setToday] = useState("");
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    // The editor is keyed by employer ID, so its initial loading state is
    // sufficient. Avoid a synchronous state update within React's effect.
    (async () => {
      try {
        const response = await fetch("/api/multi-entity/registration-changes?organizationId=" +
          organizationId + "&legalEntityId=" + entity.id, { cache: "no-store" });
        if (response.status === 404) {
          if (alive) { setEnabled(false); setLoading(false); }
          return;
        }
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error ?? "Cannot load reviewed registrations.");
        if (alive) {
          setEnabled(true);
          setRequests(result.requests ?? []);
          setVersions(result.versions ?? []);
          setToday(String(result.today ?? ""));
          setLoading(false);
          setError("");
        }
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : "Unable to load change requests.");
          setLoading(false);
        }
      }
    })();
    return () => { alive = false; };
  }, [entity.id, organizationId, retry]);

  async function send(body: Record<string, unknown>, method: "POST" | "PATCH") {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/multi-entity/registration-changes", {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, legalEntityId: entity.id, ...body }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Reviewed registration update failed.");
      setChanges({}); setReason("");
      setNotice(method === "POST" ? "Request filed for a different approver." :
        "Decision recorded with an immutable audit trail.");
      setRetry(value => value + 1);
      if (method === "PATCH" && body.action === "approve") onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save request.");
    } finally { setBusy(false); }
  }

  if (loading) return <p role="status">Checking registration approval access…</p>;
  if (!enabled) return <p>Employer registration and bank changes remain locked until the
    reviewed versioning migration and separate approval feature flag are enabled.</p>;

  return <section className="card" style={{ marginTop: 18, padding: 16 }}>
    <div className="card-kicker">MAKER-CHECKER REGISTRATION REVIEW</div>
    <h3>Propose a new employer registration version</h3>
    <p>Enter only fields that are changing. Existing employer numbers and bank accounts
      remain masked. A different authorized administrator must approve the request.
      Changes take effect only on the Manila date displayed below; previously filed
      employer records are not rewritten.</p>
    <p>Effective date: <strong>{today || "Unavailable"}</strong></p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 12 }}>
      {settingsFields.map(field => {
        const currentMasked = String(entity[field.key] ?? "");
        return <label key={field.key} style={{ display: "grid", gap: 5 }}>
          New {field.label}
          <input aria-label={"New " + field.label} value={changes[field.key] ?? ""}
            autoComplete="off" placeholder={currentMasked ? "Current: " + currentMasked : "Leave blank if unchanged"}
            onChange={event => setChanges(old => {
              const next = { ...old };
              if (!event.target.value) delete next[field.key];
              else next[field.key] = event.target.value;
              return next;
            })} />
        </label>;
      })}
    </div>
    <label style={{ display: "grid", gap: 5, marginTop: 12 }}>Business reason (no government IDs or account numbers)
      <textarea rows={2} value={reason} onChange={event => setReason(event.target.value)}
        aria-label="Reason for employer registration update" />
    </label>
    <button className="primary-button" disabled={busy || !today || reason.trim().length < 8 ||
        Object.keys(changes).length === 0 || requests.some(row => row.status === "pending_approval")}
      onClick={() => void send({ effectiveDate: today, reason, changes }, "POST")}>
      {busy ? "Submitting…" : "Request independent registration approval"}
    </button>
    <h3 style={{ marginTop: 18 }}>Review queue</h3>
    {requests.length === 0 && <p>No employer registration requests.</p>}
    {requests.map(row => <div key={row.id} style={{ padding: 10, borderBottom: "1px solid var(--line)" }}>
      <strong>Request {row.id} — {row.status}</strong>
      <p>Fields: {row.changedFields.join(", ")}</p>
      {row.canReview && <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button className="primary-button" disabled={busy}
          onClick={() => void send({ requestId: row.id, action: "approve" }, "PATCH")}>Approve</button>
        <button className="secondary-button" disabled={busy}
          onClick={() => void send({ requestId: row.id, action: "reject" }, "PATCH")}>Reject</button>
      </div>}
    </div>)}
    <h3 style={{ marginTop: 18 }}>Approved identity history</h3>
    {versions.length === 0 ? <p>No approved historical versions yet.</p> :
      <p>{versions.map(v => "Revision " + v.revision + " (" + v.effectiveDate + ")").join(" · ")}</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}

type TransferRow = {
  id: number; employeeId: number; fromLegalEntityId: number; toLegalEntityId: number;
  effectiveDate: string; status: string; requestedByUserId: number;
  canReview: boolean;
};
type Destination = { id: number; legalName: string; displayName: string };
export function EntityTransferDialog({
  employee, context, organizationId, onClose, onRefresh, initialTargetId,
}: {
  employee: Employee; context: EntityWorkspace; organizationId: number;
  initialTargetId?: number | null;
  onClose: () => void; onRefresh: () => Promise<void>;
}) {
  const [options, setOptions] = useState<Destination[]>([]);
  const [mutationsEnabled, setMutationsEnabled] = useState(false);
  const [target, setTarget] = useState(initialTargetId ? String(initialTargetId) : "");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch("/api/multi-entity/transfers?organizationId=" + organizationId);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load transfer options.");
        if (alive) {
          setOptions(body.destinations ?? []);
          setMutationsEnabled(body.mutationsEnabled === true);
          setStatus("ready");
        }
      } catch (e) { if (alive) { setError(e instanceof Error ? e.message : "Could not load."); setStatus("error"); } }
    })();
    return () => { alive = false; };
  }, [organizationId]);
  async function submit() {
    setStatus("saving"); setError("");
    try {
      const response = await fetch("/api/multi-entity/transfers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId, employeeId: employee.id, toLegalEntityId: Number(target),
          effectiveDate, reason,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Unable to request transfer.");
      await onRefresh(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not request."); setStatus("ready"); }
  }
  return <div className="modal-backdrop linaw-dialog" role="presentation">
    <section className="modal large" role="dialog" aria-modal="true" aria-label="Transfer employee between legal employers"
      style={{ width: "min(95vw, 620px)", maxHeight: "88vh", overflowY: "auto" }}>
      <h2>Transfer {employee.firstName} {employee.lastName}</h2>
      <p>Entity changes require independent approval. The employee keeps one identity and original service date.</p>
      {!mutationsEnabled && <p role="status">Transfers are disabled pending separate Philippine payroll and legal approval.</p>}
      <p>Current: <strong>{context.entities.find(row => row.id === employee.legalEntityId)?.displayName ?? "Entity not available"}</strong></p>
      {status === "loading" && <p role="status">Loading destinations…</p>}
      {status === "error" && <p role="alert">{error}</p>}
      {status !== "loading" && <>
        <div className="setting-form">
          <label>Destination legal entity<select value={target} onChange={event => setTarget(event.target.value)}>
            <option value="">Choose a different employer</option>
            {options.filter(option => option.id !== employee.legalEntityId).map(option =>
              <option key={option.id} value={option.id}>{option.displayName}</option>)}
          </select></label>
          <label>Effective date<input aria-label="Transfer effective date" type="date"
            value={effectiveDate} onChange={event => setEffectiveDate(event.target.value)} /></label>
          <label>Reason for transfer<textarea aria-label="Transfer reason" rows={3}
            value={reason} onChange={event => setReason(event.target.value)} /></label>
        </div>
        <div className="notice notice-amber" style={{ marginTop: 12 }}>
          <strong>Service, leave and 13th-month treatment:</strong> Original hire/service date and leave balance records remain continuous. Historical 13th-month basic-salary evidence is preserved by the old employer. An independent approver must review allocation and statutory reporting; this transfer is not an automatic separation or final-pay release.
        </div>
        {error && <p role="alert">{error}</p>}
      </>}
      <div className="modal-actions" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button className="secondary-button" onClick={onClose}>Cancel</button>
        <button className="primary-button" disabled={!mutationsEnabled || !target || !effectiveDate || reason.trim().length < 8 || status !== "ready"}
          onClick={() => void submit()}>{status === "saving" ? "Submitting…" : "Send for independent approval"}</button>
      </div>
    </section>
  </div>;
}

export function EntityTransferInbox({ context, organizationId, onRefresh }: {
  context: EntityWorkspace; organizationId: number; onRefresh: () => Promise<void>;
}) {
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [mutationsEnabled, setMutationsEnabled] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error" | "deciding">("loading");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch("/api/multi-entity/transfers?organizationId=" + organizationId,
          { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? "Unable to load transfers.");
        if (alive) {
          setRows(payload.transfers ?? []);
          setDestinations(payload.destinations ?? []);
          setMutationsEnabled(payload.mutationsEnabled === true);
          setState("ready");
        }
      } catch (e) { if (alive) { setError(e instanceof Error ? e.message : "Error."); setState("error"); } }
    })();
    return () => { alive = false; };
  }, [organizationId, reload]);
  const approver = !context.group && mutationsEnabled &&
    ["owner", "admin", "bookkeeper"].includes(context.role);
  async function decide(id: number, action: "approve" | "reject" | "apply") {
    setState("deciding"); setError("");
    try {
      const response = await fetch("/api/multi-entity/transfers", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, id, action }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Decision failed.");
      await onRefresh(); setReload(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Decision failed."); }
    finally { setState("ready"); }
  }
  return <article className="card" style={{ padding: 18, marginTop: 16 }}>
    <h2>Entity transfer approvals</h2>
    <p>Each move requires a separate checker; completed moves keep their service and historical payroll trail.</p>
    {!mutationsEnabled && <p role="status">Transfer changes are on hold pending legal and payroll signoff.</p>}
    {state === "loading" && <p role="status">Loading transfer requests…</p>}
    {state === "error" && <div role="alert">{error}<button onClick={() => setReload(n => n+1)}>Retry</button></div>}
    {state === "ready" && rows.length === 0 && <p>No entity transfer requests.</p>}
    {error && state !== "error" && <p role="alert">{error}</p>}
    {(state === "ready" || state === "deciding") && rows.length > 0 &&
      <div className="data-table-wrap" style={{ overflowX: "auto" }}><table className="data-table">
        <thead><tr><th>Employee ID</th><th>From → To</th><th>Effective</th><th>Status</th><th>Review</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <td>{row.employeeId}</td>
          <td>{destinations.find(x => x.id === row.fromLegalEntityId)?.displayName ?? row.fromLegalEntityId}
              {" → "}{destinations.find(x => x.id === row.toLegalEntityId)?.displayName ?? row.toLegalEntityId}</td>
          <td>{row.effectiveDate}</td><td>{row.status}</td>
          <td style={{ minWidth: 160 }}>
            {approver && row.canReview && row.status === "pending_approval" &&
              <><button disabled={state === "deciding"} onClick={() => void decide(row.id,"approve")}>Approve</button>
                <button disabled={state === "deciding"} onClick={() => void decide(row.id,"reject")}>Reject</button></>}
            {approver && row.canReview && row.status === "approved" &&
              <button disabled={state === "deciding"} onClick={() => void decide(row.id,"apply")}>Apply when due</button>}
          </td>
        </tr>)}</tbody>
      </table></div>}
  </article>;
}

export function GroupEntityReports({ context, organizationId }: {
  context?: EntityWorkspace; organizationId: number;
}) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [rows, setRows] = useState<Array<{ id: number; displayName: string; headcount: number; gross: string; net: string }>>([]);
  const [totals, setTotals] = useState<{ headcount: number; gross: string; net: string } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!context?.group) return;
    let alive = true;
    (async () => {
      try {
        const response = await fetch("/api/multi-entity/reports?organizationId=" + organizationId);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? "Report unavailable.");
        if (alive) { setRows(payload.entities ?? []); setTotals(payload.totals); setState("ready"); }
      } catch (e) { if (alive) { setError(e instanceof Error ? e.message : "Group report failed."); setState("error"); } }
    })();
    return () => { alive = false; };
  }, [context?.group, organizationId, retry]);
  if (!context?.group) return null;
  return <article className="card" style={{ padding: 18, marginBottom: 18 }}>
    <div className="card-kicker">GROUP REPORT · AUTHORIZED GROUP ROLES ONLY</div>
    <h2>Group headcount & released payroll cost</h2>
    <p>Entity rows remain separate. Totals cover released runs only, not draft or unpaid payroll.</p>
    {state === "loading" && <p role="status">Loading group totals…</p>}
    {state === "error" && <div role="alert">{error}<button className="secondary-button" onClick={() => { setState("loading"); setRetry(x => x+1); }}>Retry</button></div>}
    {state === "ready" && rows.length === 0 && <p>No legal entities have reportable records.</p>}
    {state === "ready" && rows.length > 0 &&
      <div style={{ overflowX: "auto" }}><table className="data-table">
        <thead><tr><th>Legal entity</th><th>Headcount</th><th>Gross payroll</th><th>Net payroll</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}><td>{row.displayName}</td>
          <td>{row.headcount}</td><td>₱{Number(row.gross).toLocaleString("en-PH",{minimumFractionDigits:2})}</td>
          <td>₱{Number(row.net).toLocaleString("en-PH",{minimumFractionDigits:2})}</td></tr>)}
        {totals && <tr><th>Group total</th><th>{totals.headcount}</th>
          <th>₱{Number(totals.gross).toLocaleString("en-PH",{minimumFractionDigits:2})}</th>
          <th>₱{Number(totals.net).toLocaleString("en-PH",{minimumFractionDigits:2})}</th></tr>}
        </tbody>
      </table></div>}
  </article>;
}
