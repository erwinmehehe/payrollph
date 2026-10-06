import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const auth = readFileSync("src/lib/auth.ts", "utf8");
const access = readFileSync("src/lib/access.ts", "utf8");
const permission = readFileSync("src/lib/permissions.ts", "utf8");
const security = readFileSync("src/lib/security-request.ts", "utf8");
const oidc = readFileSync("src/lib/oidc.ts", "utf8");
const oidcStart = readFileSync("src/app/api/auth/sso/start/route.ts", "utf8");
const oidcCallback = readFileSync("src/app/api/auth/sso/callback/route.ts", "utf8");
const enterprise = readFileSync("src/app/api/enterprise/route.ts", "utf8");
const scimUsers = readFileSync("src/app/api/scim/v2/Users/route.ts", "utf8");
const scimUser = readFileSync("src/app/api/scim/v2/Users/[id]/route.ts", "utf8");
const automation = readFileSync("src/lib/automation.ts", "utf8");
const employee = readFileSync("src/app/api/employees/route.ts", "utf8");
const separation = readFileSync("src/app/api/separation/route.ts", "utf8");
const transfer = readFileSync("src/app/api/workforce-planning/transfer/route.ts", "utf8");
const panel = readFileSync("src/components/enterprise-controls-panel.tsx", "utf8");
const nav = readFileSync("src/components/workspace/nav.ts", "utf8");
const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");

test("enterprise identity schema separates providers domains external identities and SCIM provisioning", () => {
  for (const table of [
    "organization_security_policies",
    "identity_providers",
    "identity_domains",
    "external_identities",
    "oidc_login_states",
    "scim_tokens",
    "scim_identities",
    "permission_sets",
    "user_permission_assignments",
    "automation_rules",
    "automation_executions",
  ]) {
    assert.ok(schema.includes(`"${table}"`), `missing table ${table}`);
  }
  assert.ok(schema.includes('active: boolean("active").notNull().default(true)'));
  assert.ok(schema.includes('localPasswordEnabled: boolean("local_password_enabled")'));
  assert.ok(schema.includes('authMethod: varchar("auth_method"'));
});

test("OIDC uses discovery PKCE replay protection signed ID tokens and verified email domains", () => {
  assert.ok(oidc.includes('"/.well-known/openid-configuration"'));
  assert.ok(oidc.includes('createHash("sha256")'));
  assert.ok(oidc.includes('header.alg !== "RS256"'));
  assert.ok(oidc.includes('verify("RSA-SHA256"'));
  assert.ok(oidc.includes("payload.nonce !== input.nonce"));
  assert.ok(oidc.includes("payload.iss !== normalizeIssuer(input.issuer)"));
  assert.ok(oidcStart.includes("code_challenge_method"));
  assert.ok(oidcStart.includes("stateHash: sha256(state)"));
  assert.ok(oidcCallback.includes("isNull(oidcLoginStates.usedAt)"));
  assert.ok(oidcCallback.includes("eq(identityDomains.verified, true)"));
  assert.ok(oidcCallback.includes("user has not been provisioned in Linaw"));
});

test("SSO required mode fails closed and includes administrator lockout protection", () => {
  assert.ok(enterprise.includes('ssoMode === "required"'));
  assert.ok(enterprise.includes("Enable a verified OIDC provider before requiring SSO."));
  assert.ok(enterprise.includes("Verify an SSO email domain before requiring SSO."));
  assert.ok(enterprise.includes("Sign in through this workspace's OIDC provider before switching SSO to required."));
  assert.ok(access.includes("assertOrganizationSessionPolicy"));
});

test("enterprise MFA accepts recent verified OIDC factor evidence", () => {
  assert.ok(security.includes('user.totpEnabled || user.authMethod === "oidc"'));
  assert.ok(oidc.includes("mfaSatisfied"));
  assert.ok(oidcCallback.includes("identity.mfaSatisfied"));
  assert.ok(oidcCallback.includes("provider did not assert an MFA authentication method"));
});

test("session policy applies idle absolute lifetime MFA and concurrency to existing sessions", () => {
  assert.ok(auth.includes("policy.maxHours * 60 * 60 * 1000"));
  assert.ok(auth.includes("policy.requireMfa && !row.session.mfaVerifiedAt"));
  assert.ok(auth.includes("policy.idleMinutes * 60 * 1000"));
  assert.ok(auth.includes("enforceActiveSessionLimit(row.user.id, row.session.id, policy.maxActiveSessions)"));
});

test("SCIM cannot provision privileged organization roles", () => {
  assert.ok(scimUsers.includes('["employee", "manager", "hr", "payroll", "checker"]'));
  assert.equal(scimUsers.includes('"owner", "admin", "bookkeeper"'), false);
});

test("SCIM deprovisioning is workspace-membership scoped and revokes sessions without globally disabling a shared user", () => {
  assert.ok(schema.includes('active: boolean("active").notNull().default(true)'));
  assert.ok(scimUser.includes("tx.update(userOrganizations).set({ active: false })"));
  assert.ok(scimUser.includes("tx.update(scimIdentities).set({ active: false"));
  assert.ok(scimUser.includes("tx.update(sessions).set({ revokedAt: new Date() })"));
  assert.equal(scimUser.includes("tx.update(users).set({ active: false })"), false);
  assert.ok(access.includes("eq(userOrganizations.active, true)"));
});

test("SCIM bearer tokens are stored as hashes and returned only when minted", () => {
  const scim = readFileSync("src/lib/scim.ts", "utf8");
  assert.ok(scim.includes('"scim_live_"'));
  assert.ok(scim.includes("tokenHash: sha256(token)"));
  assert.ok(scim.includes("eq(scimTokens.tokenHash, sha256(token))"));
  assert.ok(enterprise.includes("shown once and stored only as a SHA-256 hash"));
});

test("custom permissions are deny-only overlays rather than privilege grants", () => {
  assert.ok(permission.includes("Permission sets are deny-only overlays"));
  assert.ok(permission.includes("permissions.includes(permission)"));
  assert.ok(access.includes("Your custom permission set does not allow this action."));
  assert.ok(enterprise.includes("ROLE_GATE_PERMISSIONS"));
});

test("lifecycle automation is idempotent failure isolated and constrained to supported actions", () => {
  assert.ok(automation.includes('"employee.hired"'));
  assert.ok(automation.includes('"employee.moved"'));
  assert.ok(automation.includes('"employee.separated"'));
  assert.ok(automation.includes(".onConflictDoNothing().returning()"));
  assert.ok(automation.includes('status: "failed"'));
  assert.ok(automation.includes("Session revocation automation is allowed only for employee separation."));
});

test("joiner mover and leaver automations are connected only after authoritative lifecycle transactions", () => {
  assert.ok(employee.includes('eventKey: "employee-create:" + created.id'));
  assert.ok(separation.includes('trigger: "employee.separated"'));
  assert.ok(separation.lastIndexOf("runLifecycleAutomations({") > separation.indexOf('"Final pay released"'));
  assert.ok(transfer.includes('trigger: "employee.moved"'));
  assert.ok(transfer.includes("tx.update(positionAssignments)"));
  assert.ok(transfer.includes("tx.insert(positionAssignments)"));
  assert.ok(transfer.includes('status: "filled"'));
});

test("mover flow requires an authoritative current position and approved vacant target", () => {
  assert.ok(transfer.includes('["approved", "open"].includes(targetPosition.status)'));
  assert.ok(transfer.includes("The target position already has an active incumbent."));
  assert.ok(transfer.includes("Employee does not have an active authoritative position assignment."));
  assert.ok(transfer.includes("Cross-unit transfers require company-wide People administration."));
  assert.ok(transfer.includes("current Philippine business date only"));
});

test("Enterprise workspace exposes identity provisioning permission and automation controls", () => {
  assert.ok(nav.includes('{ name: "Enterprise"'));
  assert.ok(workspace.includes('import { EnterpriseControlsPanel }'));
  assert.ok(workspace.includes('page === "Enterprise"'));
  assert.ok(panel.includes("Verified company identity providers"));
  assert.ok(panel.includes("Provisioning and deactivation"));
  assert.ok(panel.includes("Deny-only role restrictions"));
  assert.ok(panel.includes("Governed lifecycle automation"));
});
