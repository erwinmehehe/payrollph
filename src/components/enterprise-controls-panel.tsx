"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, KeyRound, LockKeyhole, RefreshCw, ShieldCheck, UserCog, Workflow, X } from "lucide-react";

type SecurityPolicy = {
  sessionIdleMinutes: number;
  sessionMaxHours: number;
  maxActiveSessions: number;
  requireMfa: boolean;
  ssoMode: string;
};
type MfaReadiness = { total: number; ready: number; notReadyUserIds: number[] };
type Provider = {
  id: number;
  name: string;
  protocol: string;
  issuer: string;
  clientId: string;
  scopes: string;
  emailClaim: string;
  enabled: boolean;
  discoveryVerifiedAt: string | null;
  clientSecretConfigured: boolean;
};
type Domain = { id: number; providerId: number; domain: string; verified: boolean; verifiedAt: string | null };
type ScimToken = { id: number; name: string; prefix: string; lastUsedAt: string | null; revokedAt: string | null; createdAt: string };
type PermissionSet = { id: number; name: string; description: string | null; permissions: unknown; active: boolean };
type PermissionAssignment = { id: number; userOrganizationId: number; permissionSetId: number };
type Member = {
  membershipId: number;
  userId: number;
  email: string;
  name: string;
  role: string;
  orgUnitId: number | null;
  active: boolean;
  membershipActive: boolean;
  localPasswordEnabled: boolean;
  totpEnabled: boolean;
};
type AutomationRule = { id: number; name: string; trigger: string; conditions: unknown; actions: unknown; active: boolean };
type Execution = { id: number; ruleId: number; trigger: string; status: string; eventKey: string; error: string | null; createdAt: string };
type OrgUnit = { id: number; name: string };

type EnterpriseData = {
  securityPolicy: SecurityPolicy;
  mfaReadiness: MfaReadiness;
  identityEncryptionConfigured: boolean;
  oidcCallbackUrl: string;
  scimBaseUrl: string;
  identityProviders: Provider[];
  identityDomains: Domain[];
  scimTokens: ScimToken[];
  permissionSets: PermissionSet[];
  permissionAssignments: PermissionAssignment[];
  members: Member[];
  automationRules: AutomationRule[];
  automationExecutions: Execution[];
  orgUnits: OrgUnit[];
  availablePermissions: string[];
  availableTriggers: string[];
};

const fmt = (value: string | null) => value ? new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "—";

export function EnterpriseControlsPanel({ organizationId, setNotice }: { organizationId: number; setNotice: (message: string) => void }) {
  const [data, setData] = useState<EnterpriseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProvider, setShowProvider] = useState(false);
  const [showPermission, setShowPermission] = useState(false);
  const [showRule, setShowRule] = useState(false);
  const [oneTimeSecret, setOneTimeSecret] = useState<{ title: string; value: string; copy: string } | null>(null);

  const [policy, setPolicy] = useState<SecurityPolicy>({
    sessionIdleMinutes: 1440,
    sessionMaxHours: 336,
    maxActiveSessions: 10,
    requireMfa: false,
    ssoMode: "optional",
  });
  const [providerForm, setProviderForm] = useState({ name: "", issuer: "", clientId: "", clientSecret: "", domain: "" });
  const [scimName, setScimName] = useState("");
  const [permissionForm, setPermissionForm] = useState({ name: "", description: "", permissions: [] as string[] });
  const [ruleForm, setRuleForm] = useState({
    name: "",
    trigger: "employee.hired",
    orgUnitId: "",
    fromOrgUnitId: "",
    toOrgUnitId: "",
    employmentType: "",
    titleContains: "",
    actionType: "create_task",
    taskTitle: "",
    taskOwner: "People Ops",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/enterprise?organizationId=${organizationId}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return setNotice(payload.error ?? "Could not load enterprise controls.");
      setData(payload);
      setPolicy(payload.securityPolicy);
    } finally {
      setLoading(false);
    }
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  const providerById = useMemo(() => new Map((data?.identityProviders ?? []).map((row) => [row.id, row])), [data]);
  const permissionById = useMemo(() => new Map((data?.permissionSets ?? []).map((row) => [row.id, row])), [data]);
  const assignmentByMembership = useMemo(() => new Map((data?.permissionAssignments ?? []).map((row) => [row.userOrganizationId, row])), [data]);
  const ruleById = useMemo(() => new Map((data?.automationRules ?? []).map((row) => [row.id, row])), [data]);

  async function mutate(body: Record<string, unknown>) {
    const response = await fetch("/api/enterprise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, ...body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Enterprise change failed.");
    return payload;
  }

  async function savePolicy(event: React.FormEvent) {
    event.preventDefault();
    try {
      await mutate({ action: "save-security-policy", ...policy });
      await load();
      setNotice("Enterprise security policy updated.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save security policy."); }
  }

  async function createProvider(event: React.FormEvent) {
    event.preventDefault();
    try {
      const payload = await mutate({ action: "create-oidc-provider", ...providerForm });
      setProviderForm({ name: "", issuer: "", clientId: "", clientSecret: "", domain: "" });
      setShowProvider(false);
      setOneTimeSecret({
        title: "Publish this DNS TXT value",
        value: payload.dnsTxtRecord,
        copy: "Add the exact value as a TXT record on the company email domain. Linaw stores only its SHA-256 hash, so this proof is shown once.",
      });
      await load();
      setNotice("OIDC provider discovered and saved. Verify the company domain before enabling it.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not configure OIDC."); }
  }

  async function verifyDomain(domain: Domain) {
    try {
      await mutate({ action: "verify-domain", domainId: domain.id });
      await load();
      setNotice(domain.domain + " verified for company SSO.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not verify domain."); }
  }

  async function setProviderEnabled(provider: Provider, enabled: boolean) {
    try {
      await mutate({ action: "set-provider-enabled", providerId: provider.id, enabled });
      await load();
      setNotice(provider.name + (enabled ? " enabled." : " disabled."));
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not update provider."); }
  }

  async function createScimToken() {
    if (!scimName.trim()) return setNotice("Enter a SCIM token name.");
    try {
      const payload = await mutate({ action: "create-scim-token", name: scimName });
      setScimName("");
      setOneTimeSecret({
        title: "SCIM bearer token",
        value: payload.token,
        copy: "Copy this token into your identity provider now. Linaw stores only its SHA-256 hash and will not show the secret again.",
      });
      await load();
      setNotice("SCIM token created.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create SCIM token."); }
  }

  async function revokeScimToken(token: ScimToken) {
    try {
      await mutate({ action: "revoke-scim-token", tokenId: token.id });
      await load();
      setNotice("SCIM token revoked.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not revoke token."); }
  }

  async function savePermission(event: React.FormEvent) {
    event.preventDefault();
    try {
      await mutate({ action: "save-permission-set", ...permissionForm });
      setPermissionForm({ name: "", description: "", permissions: [] });
      setShowPermission(false);
      await load();
      setNotice("Custom permission set saved. It can only restrict the member's base role.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save permission set."); }
  }

  async function assignPermission(membershipId: number, permissionSetId: string) {
    try {
      await mutate({ action: "assign-permission-set", membershipId, permissionSetId: permissionSetId ? Number(permissionSetId) : null });
      await load();
      setNotice(permissionSetId ? "Permission restriction assigned." : "Custom permission restriction cleared.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not assign permission set."); }
  }

  async function saveRule(event: React.FormEvent) {
    event.preventDefault();
    const conditions: Record<string, unknown> = {};
    if (ruleForm.orgUnitId) conditions.orgUnitId = Number(ruleForm.orgUnitId);
    if (ruleForm.fromOrgUnitId) conditions.fromOrgUnitId = Number(ruleForm.fromOrgUnitId);
    if (ruleForm.toOrgUnitId) conditions.toOrgUnitId = Number(ruleForm.toOrgUnitId);
    if (ruleForm.employmentType.trim()) conditions.employmentType = ruleForm.employmentType.trim();
    if (ruleForm.titleContains.trim()) conditions.titleContains = ruleForm.titleContains.trim();

    let action: Record<string, unknown>;
    if (ruleForm.actionType === "create_task") {
      action = { type: "create_task", title: ruleForm.taskTitle, owner: ruleForm.taskOwner };

    } else {
      action = { type: ruleForm.actionType };
    }

    try {
      await mutate({ action: "save-automation-rule", name: ruleForm.name, trigger: ruleForm.trigger, conditions, actions: [action] });
      setRuleForm({
        name: "", trigger: "employee.hired", orgUnitId: "", fromOrgUnitId: "", toOrgUnitId: "",
        employmentType: "", titleContains: "", actionType: "create_task", taskTitle: "", taskOwner: "People Ops",
      });
      setShowRule(false);
      await load();
      setNotice("Lifecycle automation saved.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save automation rule."); }
  }

  async function setRuleActive(rule: AutomationRule, active: boolean) {
    try {
      await mutate({ action: "set-automation-active", ruleId: rule.id, active });
      await load();
      setNotice(rule.name + (active ? " enabled." : " disabled."));
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not update automation."); }
  }

  if (!data) {
    return <div className="card" style={{ padding: 24 }}>{loading ? "Loading enterprise controls…" : "Enterprise controls unavailable."}</div>;
  }

  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ENTERPRISE</div>
          <h1>Identity, access, session policy, and lifecycle automation.</h1>
          <p>Configure verified company SSO and SCIM, narrow role access with deny-only permission sets, and automate joiner/mover/leaver follow-through without allowing rules to bypass authoritative HR transactions.</p>
        </div>
        <div className="page-actions"><button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button></div>
      </div>

      {oneTimeSecret && (
        <article className="card" style={{ padding: 20, marginBottom: 16, borderColor: "var(--amber, #D99C28)" }}>
          <div className="card-header">
            <div><div className="card-kicker">SHOW ONCE</div><h2>{oneTimeSecret.title}</h2><p>{oneTimeSecret.copy}</p></div>
            <button className="icon-button" onClick={() => setOneTimeSecret(null)}><X size={16} /></button>
          </div>
          <code style={{ display: "block", wordBreak: "break-all", padding: 12, background: "var(--canvas-subtle)", borderRadius: 8 }}>{oneTimeSecret.value}</code>
        </article>
      )}

      <section className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="stat-card"><div className="stat-icon purple"><ShieldCheck size={19} /></div><p>SSO MODE</p><h3>{data.securityPolicy.ssoMode}</h3><span>{data.identityProviders.filter((row) => row.enabled).length} enabled provider(s)</span></article>
        <article className="stat-card"><div className="stat-icon blue"><LockKeyhole size={19} /></div><p>MFA READY</p><h3>{data.mfaReadiness.ready}/{data.mfaReadiness.total}</h3><span>Active local-password members</span></article>
        <article className="stat-card"><div className="stat-icon mint"><UserCog size={19} /></div><p>SCIM</p><h3>{data.scimTokens.filter((row) => !row.revokedAt).length}</h3><span>Active bearer token(s)</span></article>
        <article className="stat-card"><div className="stat-icon orange"><Workflow size={19} /></div><p>AUTOMATION</p><h3>{data.automationRules.filter((row) => row.active).length}</h3><span>{data.automationExecutions.filter((row) => row.status === "failed").length} recent failures</span></article>
      </section>

      <article className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div className="card-header"><div><div className="card-kicker">SESSION POLICY</div><h2>Set organization authentication guardrails</h2><p>The strictest policy across all of a user's workspaces governs the session.</p></div></div>
        <form onSubmit={savePolicy}>
          <div className="setting-form">
            <label>Idle timeout (minutes)<input required type="number" min="15" max="10080" value={policy.sessionIdleMinutes} onChange={(e) => setPolicy({ ...policy, sessionIdleMinutes: Number(e.target.value) })} /></label>
            <label>Maximum lifetime (hours)<input required type="number" min="1" max="720" value={policy.sessionMaxHours} onChange={(e) => setPolicy({ ...policy, sessionMaxHours: Number(e.target.value) })} /></label>
            <label>Maximum active sessions<input required type="number" min="1" max="20" value={policy.maxActiveSessions} onChange={(e) => setPolicy({ ...policy, maxActiveSessions: Number(e.target.value) })} /></label>
            <label>SSO mode<select value={policy.ssoMode} onChange={(e) => setPolicy({ ...policy, ssoMode: e.target.value })}><option value="optional">Optional</option><option value="required">Required</option></select></label>
            <label><input type="checkbox" checked={policy.requireMfa} onChange={(e) => setPolicy({ ...policy, requireMfa: e.target.checked })} /> Require MFA for workspace sign-in</label>
          </div>
          <div className="notice" style={{ marginTop: 10 }}>
            Required SSO can only be enabled after a provider and email domain are verified and the current administrator signs in through that provider.
          </div>
          <div className="run-actions"><button className="primary-button">Save security policy</button></div>
        </form>
      </article>

      <section className="module-grid two">
        <article className="card">
          <div className="card-header">
            <div><div className="card-kicker">OIDC / SSO</div><h2>Verified company identity providers</h2><p>Callback: <code>{data.oidcCallbackUrl}</code></p></div>
            <button className="primary-button" onClick={() => setShowProvider(!showProvider)} disabled={!data.identityEncryptionConfigured}><KeyRound size={14} /> Provider</button>
          </div>
          {!data.identityEncryptionConfigured && <div className="notice" style={{ margin: "0 16px 12px" }}>Set <code>ENTERPRISE_IDENTITY_ENCRYPTION_KEY</code> before storing client secrets.</div>}
          {showProvider && (
            <form onSubmit={createProvider} style={{ padding: "0 16px 14px" }}>
              <div className="setting-form">
                <label>Name<input required value={providerForm.name} onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })} placeholder="Microsoft Entra ID" /></label>
                <label>Issuer<input required value={providerForm.issuer} onChange={(e) => setProviderForm({ ...providerForm, issuer: e.target.value })} placeholder="https://login.example.com/tenant/v2.0" /></label>
                <label>Client ID<input required value={providerForm.clientId} onChange={(e) => setProviderForm({ ...providerForm, clientId: e.target.value })} /></label>
                <label>Client secret<input required type="password" value={providerForm.clientSecret} onChange={(e) => setProviderForm({ ...providerForm, clientSecret: e.target.value })} /></label>
                <label>Company email domain<input required value={providerForm.domain} onChange={(e) => setProviderForm({ ...providerForm, domain: e.target.value })} placeholder="company.ph" /></label>
              </div>
              <div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowProvider(false)}>Cancel</button><button className="primary-button">Discover & save</button></div>
            </form>
          )}
          {data.identityProviders.length === 0 && <div className="empty-state">No OIDC provider configured.</div>}
          {data.identityProviders.map((provider) => {
            const domains = data.identityDomains.filter((domain) => domain.providerId === provider.id);
            const verified = domains.some((domain) => domain.verified);
            return <div className="leave-request" key={provider.id}>
              <div className="inline-icon purple"><ShieldCheck size={16} /></div>
              <div style={{ flex: 1 }}><strong>{provider.name}</strong><span>{provider.issuer} · {verified ? "domain verified" : "domain verification pending"}</span></div>
              {!verified && domains[0] && <button className="secondary-button" onClick={() => void verifyDomain(domains[0])}>Verify DNS</button>}
              <button className={provider.enabled ? "secondary-button" : "primary-button"} onClick={() => void setProviderEnabled(provider, !provider.enabled)}>{provider.enabled ? "Disable" : "Enable"}</button>
            </div>;
          })}
        </article>

        <article className="card">
          <div className="card-header"><div><div className="card-kicker">SCIM 2.0</div><h2>Provisioning and deactivation</h2><p>Base URL: <code>{data.scimBaseUrl}</code></p></div></div>
          <div style={{ display: "flex", gap: 8, padding: "0 16px 12px" }}>
            <input style={{ flex: 1 }} value={scimName} onChange={(e) => setScimName(e.target.value)} placeholder="Entra production provisioning" />
            <button className="primary-button" onClick={() => void createScimToken()}>Create token</button>
          </div>
          {data.scimTokens.length === 0 && <div className="empty-state">No SCIM tokens created.</div>}
          {data.scimTokens.map((token) => <div className="leave-request" key={token.id}>
            <div className="inline-icon blue"><KeyRound size={16} /></div>
            <div style={{ flex: 1 }}><strong>{token.name}</strong><span>{token.prefix}… · last used {fmt(token.lastUsedAt)}{token.revokedAt ? " · revoked" : ""}</span></div>
            {!token.revokedAt && <button className="secondary-button" onClick={() => void revokeScimToken(token)}>Revoke</button>}
          </div>)}
        </article>
      </section>

      <section className="module-grid two" style={{ marginTop: 16 }}>
        <article className="card">
          <div className="card-header"><div><div className="card-kicker">CUSTOM PERMISSIONS</div><h2>Deny-only role restrictions</h2><p>A permission set can remove powers from the member's base role; it can never grant a power the role did not already have.</p></div><button className="secondary-button" onClick={() => setShowPermission(!showPermission)}>New set</button></div>
          {showPermission && <form onSubmit={savePermission} style={{ padding: "0 16px 14px" }}>
            <div className="setting-form">
              <label>Name<input required value={permissionForm.name} onChange={(e) => setPermissionForm({ ...permissionForm, name: e.target.value })} placeholder="HR without payroll" /></label>
              <label>Description<input value={permissionForm.description} onChange={(e) => setPermissionForm({ ...permissionForm, description: e.target.value })} /></label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 7, marginTop: 10 }}>
              {data.availablePermissions.map((permission) => <label key={permission} style={{ fontSize: 11 }}><input type="checkbox" checked={permissionForm.permissions.includes(permission)} onChange={(e) => setPermissionForm({
                ...permissionForm,
                permissions: e.target.checked ? [...permissionForm.permissions, permission] : permissionForm.permissions.filter((value) => value !== permission),
              })} /> {permission}</label>)}
            </div>
            <div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowPermission(false)}>Cancel</button><button className="primary-button">Save set</button></div>
          </form>}
          {data.permissionSets.map((set) => <div className="leave-request" key={set.id}><div className="inline-icon purple"><UserCog size={16} /></div><div><strong>{set.name}</strong><span>{Array.isArray(set.permissions) ? set.permissions.length : 0} allowed role gates · {set.active ? "active" : "inactive"}</span></div></div>)}
          <div className="data-table-wrap"><table className="data-table">
            <thead><tr><th>MEMBER</th><th>BASE ROLE</th><th>RESTRICTION</th></tr></thead>
            <tbody>{data.members.map((member) => {
              const assignment = assignmentByMembership.get(member.membershipId);
              return <tr key={member.membershipId}><td><strong>{member.name}</strong><small style={{ display: "block", color: "var(--muted)" }}>{member.email}</small></td><td>{member.role}{!member.membershipActive && <small style={{ display: "block", color: "var(--muted)" }}>deprovisioned</small>}</td><td><select disabled={!member.membershipActive} value={assignment?.permissionSetId ?? ""} onChange={(e) => void assignPermission(member.membershipId, e.target.value)}><option value="">Base role only</option>{data.permissionSets.filter((set) => set.active).map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}</select></td></tr>;
            })}</tbody>
          </table></div>
        </article>

        <article className="card">
          <div className="card-header"><div><div className="card-kicker">JOINER / MOVER / LEAVER</div><h2>Governed lifecycle automation</h2><p>Rules run only after the authoritative HR event commits. Each rule/event pair is idempotent and failures are isolated.</p></div><button className="primary-button" onClick={() => setShowRule(!showRule)}><Bot size={14} /> Rule</button></div>
          {showRule && <form onSubmit={saveRule} style={{ padding: "0 16px 14px" }}>
            <div className="setting-form">
              <label>Name<input required value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder="New hire IT access" /></label>
              <label>Trigger<select value={ruleForm.trigger} onChange={(e) => setRuleForm({ ...ruleForm, trigger: e.target.value, fromOrgUnitId: "", toOrgUnitId: "" })}>{data.availableTriggers.map((trigger) => <option key={trigger}>{trigger}</option>)}</select></label>
              {ruleForm.trigger === "employee.moved" ? <>
                <label>From unit<select value={ruleForm.fromOrgUnitId} onChange={(e) => setRuleForm({ ...ruleForm, fromOrgUnitId: e.target.value })}><option value="">Any</option>{data.orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
                <label>To unit<select value={ruleForm.toOrgUnitId} onChange={(e) => setRuleForm({ ...ruleForm, toOrgUnitId: e.target.value })}><option value="">Any</option>{data.orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
              </> : <label>Org unit<select value={ruleForm.orgUnitId} onChange={(e) => setRuleForm({ ...ruleForm, orgUnitId: e.target.value })}><option value="">Any</option>{data.orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>}
              <label>Employment type<input value={ruleForm.employmentType} onChange={(e) => setRuleForm({ ...ruleForm, employmentType: e.target.value })} placeholder="Optional exact match" /></label>
              <label>Title contains<input value={ruleForm.titleContains} onChange={(e) => setRuleForm({ ...ruleForm, titleContains: e.target.value })} placeholder="Optional" /></label>
              <label>Action<select value={ruleForm.actionType} onChange={(e) => setRuleForm({ ...ruleForm, actionType: e.target.value })}><option value="create_task">Create task</option><option value="webhook">Send webhook event</option>{ruleForm.trigger === "employee.separated" && <option value="revoke_sessions">Revoke sessions</option>}</select></label>
              {ruleForm.actionType === "create_task" && <><label>Task<input required value={ruleForm.taskTitle} onChange={(e) => setRuleForm({ ...ruleForm, taskTitle: e.target.value })} /></label><label>Owner<input value={ruleForm.taskOwner} onChange={(e) => setRuleForm({ ...ruleForm, taskOwner: e.target.value })} /></label></>}
              
            </div>
            <div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowRule(false)}>Cancel</button><button className="primary-button">Save rule</button></div>
          </form>}
          {data.automationRules.length === 0 && <div className="empty-state">No lifecycle automation rules yet.</div>}
          {data.automationRules.map((rule) => <div className="leave-request" key={rule.id}>
            <div className="inline-icon orange"><Workflow size={16} /></div>
            <div style={{ flex: 1 }}><strong>{rule.name}</strong><span>{rule.trigger} · {rule.active ? "active" : "disabled"}</span></div>
            <button className="secondary-button" onClick={() => void setRuleActive(rule, !rule.active)}>{rule.active ? "Disable" : "Enable"}</button>
          </div>)}
        </article>
      </section>

      <article className="card" style={{ marginTop: 16 }}>
        <div className="card-header"><div><div className="card-kicker">AUTOMATION HISTORY</div><h2>Recent lifecycle execution evidence</h2></div></div>
        <div className="data-table-wrap"><table className="data-table">
          <thead><tr><th>RULE</th><th>TRIGGER</th><th>EVENT</th><th>STATUS</th><th>TIME</th></tr></thead>
          <tbody>{data.automationExecutions.length === 0 && <tr><td colSpan={5}><div className="empty-state">No automation executions yet.</div></td></tr>}
          {data.automationExecutions.map((row) => <tr key={row.id}><td>{ruleById.get(row.ruleId)?.name ?? `Rule #${row.ruleId}`}</td><td>{row.trigger}</td><td><code>{row.eventKey}</code></td><td><span className={row.status === "completed" ? "status status-verified" : row.status === "failed" ? "status status-failed" : "status"}>{row.status}</span>{row.error && <small style={{ display: "block", color: "var(--danger)" }}>{row.error}</small>}</td><td>{fmt(row.createdAt)}</td></tr>)}</tbody>
        </table></div>
      </article>
    </div>
  );
}
