"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, RefreshCw, ShieldCheck, UserCog } from "lucide-react";

type State = {
  policy: {
    sessionIdleMinutes: number;
    sessionMaxHours: number;
    maxActiveSessions: number;
    requireLocalMfa: boolean;
  };
  localMfaReadiness: { total: number; ready: number; notReadyUserIds: number[] };
  scimTokens: Array<{ id: number; name: string; prefix: string; lastUsedAt: string | null; revokedAt: string | null }>;
  permissionSets: Array<{ id: number; name: string; description: string | null; permissions: unknown; active: boolean }>;
  memberships: Array<{ id: number; userId: number; role: string; active: boolean; email: string; name: string }>;
  assignments: Array<{ userOrganizationId: number; permissionSetId: number }>;
  availablePermissions: string[];
};

const EMPTY: State = {
  policy: { sessionIdleMinutes: 1440, sessionMaxHours: 336, maxActiveSessions: 10, requireLocalMfa: false },
  localMfaReadiness: { total: 0, ready: 0, notReadyUserIds: [] },
  scimTokens: [],
  permissionSets: [],
  memberships: [],
  assignments: [],
  availablePermissions: [],
};

export function EnterpriseAccessSettings({
  organizationId,
  setNotice,
}: {
  organizationId: number;
  setNotice: (message: string) => void;
}) {
  const [state, setState] = useState<State>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tokenName, setTokenName] = useState("Identity provider");
  const [newToken, setNewToken] = useState("");
  const [setName, setSetName] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [idleMinutes, setIdleMinutes] = useState(1440);
  const [maxHours, setMaxHours] = useState(336);
  const [maxSessions, setMaxSessions] = useState(10);
  const [requireLocalMfa, setRequireLocalMfa] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/security/enterprise-access?organizationId=${organizationId}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Enterprise access controls could not be loaded.");
    const next = body as State;
    setState(next);
    setIdleMinutes(next.policy.sessionIdleMinutes);
    setMaxHours(next.policy.sessionMaxHours);
    setMaxSessions(next.policy.maxActiveSessions);
    setRequireLocalMfa(next.policy.requireLocalMfa);
    setLoaded(true);
  }, [organizationId]);

  useEffect(() => {
    void load().catch((error) => setNotice(error instanceof Error ? error.message : "Enterprise access controls could not be loaded."));
  }, [load, setNotice]);

  async function mutate(action: string, payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch("/api/security/enterprise-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, action, ...payload }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Enterprise access action failed.");
      return body;
    } finally {
      setBusy(false);
    }
  }

  const activeTokens = state.scimTokens.filter((token) => !token.revokedAt);
  const assignmentByMembership = useMemo(
    () => new Map(state.assignments.map((assignment) => [assignment.userOrganizationId, assignment.permissionSetId])),
    [state.assignments],
  );

  if (!loaded) return <div className="empty-state">Loading enterprise access controls…</div>;

  return (
    <div style={{ borderTop: "1px solid var(--line)", marginTop: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">ACCESS GOVERNANCE</div>
          <h2>Session policy, SCIM and deny-only permissions</h2>
          <p>These controls restrict existing roles. They cannot create Owner/Admin privileges or expand a role beyond its built-in authority.</p>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={busy}><RefreshCw size={14} /> Refresh</button>
      </div>

      <div className="setting-form">
        <label>Idle timeout (minutes)<input type="number" min={15} max={10080} value={idleMinutes} onChange={(e) => setIdleMinutes(Number(e.target.value))} /></label>
        <label>Absolute session life (hours)<input type="number" min={1} max={720} value={maxHours} onChange={(e) => setMaxHours(Number(e.target.value))} /></label>
        <label>Concurrent sessions<input type="number" min={1} max={20} value={maxSessions} onChange={(e) => setMaxSessions(Number(e.target.value))} /></label>
        <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={requireLocalMfa} onChange={(e) => setRequireLocalMfa(e.target.checked)} style={{ width: 16 }} />
          Require TOTP for local-password sign-in
        </label>
      </div>
      <div className="run-actions">
        <button className="primary-button" disabled={busy} onClick={async () => {
          try {
            await mutate("save_policy", { sessionIdleMinutes: idleMinutes, sessionMaxHours: maxHours, maxActiveSessions: maxSessions, requireLocalMfa });
            setNotice("Enterprise session policy saved.");
            await load();
          } catch (error) {
            setNotice(error instanceof Error ? error.message : "Could not save session policy.");
          }
        }}><ShieldCheck size={14} /> Save session policy</button>
      </div>
      <p className="disclaimer" style={{ margin: "0 18px 18px" }}>
        Local MFA readiness: {state.localMfaReadiness.ready}/{state.localMfaReadiness.total} active local-password users enrolled. OIDC sign-in is not treated as Linaw recent MFA for sensitive payroll actions.
      </p>

      <div className="card-header" style={{ borderTop: "1px solid var(--line)" }}>
        <div><div className="card-kicker">SCIM 2.0</div><h2>Provision and deactivate workspace users</h2><p>SCIM can create employee, manager, HR, payroll and checker memberships. Owner, admin and bookkeeper roles are never provisionable through SCIM.</p></div>
      </div>
      <div className="setting-form">
        <label>Token name<input value={tokenName} onChange={(e) => setTokenName(e.target.value)} placeholder="Microsoft Entra provisioning" /></label>
        <div style={{ alignSelf: "end" }}>
          <button className="secondary-button" disabled={busy || tokenName.trim().length < 2} onClick={async () => {
            try {
              const result = await mutate("mint_scim_token", { name: tokenName });
              setNewToken(String(result.token ?? ""));
              setNotice("SCIM token created. Copy it now because it will not be shown again.");
              await load();
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "Could not create SCIM token.");
            }
          }}><KeyRound size={14} /> Create SCIM token</button>
        </div>
      </div>
      {newToken && (
        <div className="notice notice-amber" style={{ margin: "0 18px 14px", alignItems: "center" }}>
          <KeyRound size={15} />
          <span style={{ wordBreak: "break-all" }}><strong>Shown once:</strong> {newToken}</span>
          <button className="secondary-button" onClick={() => void navigator.clipboard.writeText(newToken)}><Copy size={13} /> Copy</button>
        </div>
      )}
      <div className="worksheet-list">
        {activeTokens.length ? activeTokens.map((token) => (
          <div key={token.id}>
            <KeyRound size={15} />
            <span>{token.name}<small>{token.prefix}… {token.lastUsedAt ? `· last used ${new Date(token.lastUsedAt).toLocaleDateString("en-PH")}` : "· never used"}</small></span>
            <button className="link-button" disabled={busy} onClick={async () => {
              try {
                await mutate("revoke_scim_token", { tokenId: token.id });
                setNotice("SCIM token revoked.");
                await load();
              } catch (error) {
                setNotice(error instanceof Error ? error.message : "Could not revoke SCIM token.");
              }
            }}>Revoke</button>
          </div>
        )) : <div><span>No active SCIM tokens<small>Create one only when your identity provider is ready to provision users.</small></span></div>}
      </div>

      <div className="card-header" style={{ borderTop: "1px solid var(--line)" }}>
        <div><div className="card-kicker">PERMISSION SETS</div><h2>Restrict a role without elevating it</h2><p>A permission set is an allow-list overlay on top of the member&apos;s base role. Missing permissions are denied.</p></div>
      </div>
      <div className="setting-form">
        <label>Set name<input value={setName} onChange={(e) => setSetName(e.target.value)} placeholder="Payroll reviewer, no release" /></label>
        <div style={{ gridColumn: "1 / -1", display: "flex", flexWrap: "wrap", gap: 7 }}>
          {state.availablePermissions.map((permission) => (
            <label key={permission} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 5, width: "auto" }}>
              <input type="checkbox" checked={selectedPermissions.includes(permission)} onChange={(e) => {
                setSelectedPermissions((current) => e.target.checked ? [...current, permission] : current.filter((item) => item !== permission));
              }} style={{ width: 15 }} />
              {permission}
            </label>
          ))}
        </div>
        <div style={{ alignSelf: "end" }}>
          <button className="secondary-button" disabled={busy || setName.trim().length < 2 || selectedPermissions.length === 0} onClick={async () => {
            try {
              await mutate("save_permission_set", { name: setName, permissions: selectedPermissions });
              setSetName("");
              setSelectedPermissions([]);
              setNotice("Permission set created.");
              await load();
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "Could not create permission set.");
            }
          }}><UserCog size={14} /> Create permission set</button>
        </div>
      </div>

      <div className="worksheet-list">
        {state.memberships.filter((member) => member.active).map((member) => (
          <div key={member.id}>
            <UserCog size={15} />
            <span>{member.name}<small>{member.email} · base role {member.role}</small></span>
            <select value={assignmentByMembership.get(member.id) ?? ""} onChange={async (event) => {
              try {
                const permissionSetId = event.target.value ? Number(event.target.value) : null;
                await mutate("assign_permission_set", { membershipId: member.id, permissionSetId });
                setNotice(permissionSetId ? "Permission restriction assigned." : "Permission restriction cleared.");
                await load();
              } catch (error) {
                setNotice(error instanceof Error ? error.message : "Could not update permission assignment.");
              }
            }}>
              <option value="">Base role only</option>
              {state.permissionSets.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
