import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { safeSessionSelect } from "../src/lib/session-select";

const read = (p: string) => readFileSync(p, "utf8");

/**
 * The workspace UI is split across the shell/router and the panel module, so
 * these guards read both. What they assert is behaviour: "the audit export
 * links at a real endpoint kind": not which file it happens to live in.
 */
const readWorkspace = () =>
  read("src/components/linaw-workspace.tsx") + read("src/components/workspace/panels.tsx");

test("account routes exist so settings are not decorative", () => {
  for (const path of [
    "src/app/api/account/route.ts",
    "src/app/api/account/password/route.ts",
    "src/app/api/account/email/route.ts",
    "src/app/api/account/profile/route.ts",
    "src/app/api/account/sessions/route.ts",
  ]) {
    assert.ok(existsSync(path), `${path} must exist`);
  }
});

test("session responses can never carry a token hash", () => {
  const keys = Object.keys(safeSessionSelect);
  assert.ok(!keys.includes("tokenHash"), "projection must exclude tokenHash");
  assert.ok(!keys.includes("passwordHash"), "projection must exclude passwordHash");

  for (const path of ["src/app/api/account/route.ts", "src/app/api/account/sessions/route.ts"]) {
    const source = read(path);
    assert.ok(source.includes("db.select(safeSessionSelect)"), `${path} must project sessions explicitly`);
  }
});

test("password change requires the current password and revokes other sessions", () => {
  const source = read("src/app/api/account/password/route.ts");
  assert.ok(source.includes("verifyPassword"), "must verify the current password");
  assert.ok(source.includes("revokeAllSessions"), "must revoke other sessions");
  assert.ok(source.includes("rateLimitDistributed"), "must be rate limited (it accepts a password)");
  assert.ok(source.includes("hashPassword(newPassword)"), "must store a fresh hash");
});

test("email change confirms the password and enforces uniqueness", () => {
  const source = read("src/app/api/account/email/route.ts");
  assert.ok(source.includes("verifyPassword"), "must confirm the current password");
  assert.ok(source.includes("ne(users.id"), "must reject an email already used by another account");
  assert.ok(source.includes("revokeOtherSessions"), "must revoke other sessions");
});

test("session revocation is ownership-checked and blocks self-lockout", () => {
  const source = read("src/app/api/account/sessions/route.ts");
  assert.ok(source.includes("canRevoke"), "must apply the revocation rules");
  assert.ok(source.includes("eq(sessions.userId, user.id)"), "must only ever touch the caller's own sessions");
});

test("audit export points at a real endpoint kind", () => {
  const exports_ = read("src/app/api/exports/route.ts");
  assert.ok(exports_.includes('kind === "audit"'), "/api/exports must support kind=audit");
  const workspace = readWorkspace();
  assert.ok(workspace.includes("kind=audit"), "audit page export must link to it");
  assert.ok(!workspace.includes('actions={<button className="secondary-button"><Download size={16} /> Export log</button>}'),
    "export log button must not remain decorative");
});

test("organization save actually writes", () => {
  const workspace = readWorkspace();
  assert.ok(workspace.includes('method: "PUT"'), "settings save must issue a PUT");
  const org = read("src/app/api/organizations/route.ts");
  assert.ok(org.includes("assertMembership"), "org update must verify membership");
  assert.ok(org.includes("ADMINS.has(role)"), "org update must verify an admin role");
  assert.ok(org.includes("recordAuditEvent"), "org update must be audited");
});

test("audit writer refuses to guess a workspace instead of attributing wrongly", () => {
  const audit = read("src/lib/audit.ts");
  assert.ok(audit.includes("organizationId == null"), "must guard against a null organization");
  assert.ok(!audit.includes("?? 1"), "must not fall back to a default workspace id");
});

test("every mutating account route writes an audit record", () => {
  for (const p of [
    "src/app/api/account/password/route.ts",
    "src/app/api/account/email/route.ts",
    "src/app/api/account/profile/route.ts",
    "src/app/api/organizations/route.ts",
  ]) {
    assert.ok(read(p).includes("recordAuditEvent"), `${p} must audit`);
  }
});

test("audit attribution uses the real user, not a hardcoded name", () => {
  const exports_ = read("src/app/api/exports/route.ts");
  assert.ok(exports_.includes("actor: user.name"), "exports must attribute to the signed-in user");
  assert.ok(!exports_.includes('actor: "Celine Yao"'), "no hardcoded audit actor");
});

test("account settings UI is wired to the real endpoints", () => {
  const panel = read("src/components/account-panel.tsx");
  for (const target of ["/api/account", "/api/account/password", "/api/account/email", "/api/account/profile", "/api/account/sessions"]) {
    assert.ok(panel.includes(target), `account panel must call ${target}`);
  }
});
