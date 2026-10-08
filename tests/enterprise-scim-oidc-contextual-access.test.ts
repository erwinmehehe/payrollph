import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  EnterpriseProvisioningError,
  assertScimGlobalIdentityChange,
  assertScimWorkerScope,
  parseScimActive,
  parseScimMemberRole,
  scimProvisioningOrgUnit,
  shouldRevokeScimSessions,
} from "../src/lib/enterprise-identity-policy";
import { validateOidcIdentityClaims } from "../src/lib/oidc-identity-claims";

const nowSeconds = 1_780_000_000;
const baseClaims: Record<string, unknown> = {
  iss: "https://idp.example.test",
  sub: "person-123",
  aud: "linaw-enterprise",
  exp: nowSeconds + 3600,
  iat: nowSeconds - 10,
  nonce: "fresh-once",
  email: "Employee@corp.example",
  email_verified: true,
  name: "Employee One",
  amr: ["pwd", "mfa"],
};
const verify = (payload: Record<string, unknown>, overrides: Partial<{
  issuer: string; clientId: string; nonce: string; emailClaim: string;
}> = {}) => validateOidcIdentityClaims({
  payload,
  issuer: overrides.issuer ?? "https://idp.example.test",
  clientId: overrides.clientId ?? "linaw-enterprise",
  nonce: overrides.nonce ?? "fresh-once",
  emailClaim: overrides.emailClaim ?? "email",
  nowSeconds,
});

test("signed OIDC account linking requires positively verified email and matching RP claims", () => {
  const result = verify(baseClaims);
  assert.equal(result.subject, "person-123");
  assert.equal(result.email, "employee@corp.example");
  assert.equal(result.mfaSatisfied, true);

  for (const email_verified of [undefined, false, "true", 1, null]) {
    assert.throws(() => verify({ ...baseClaims, email_verified }), /explicitly verify/);
  }
  assert.throws(() => verify({ ...baseClaims, aud: "unrelated-client" }), /audience/);
  assert.throws(() => verify({ ...baseClaims, aud: ["linaw-enterprise", "other-client"] }), /authorized-party/);
  assert.throws(() => verify({ ...baseClaims, azp: "other-client" }), /authorized-party/);
  assert.equal(verify({ ...baseClaims, aud: ["linaw-enterprise", "other"], azp: "linaw-enterprise" }).subject, "person-123");
  assert.throws(() => verify({ ...baseClaims, nonce: "replayed" }), /nonce/);
  assert.throws(() => verify({ ...baseClaims, iss: "https://untrusted.example" }), /issuer/);
  assert.throws(() => verify({ ...baseClaims, sub: "" }), /subject/);
});

test("OIDC token time claims fail closed on invalid, missing, future or expired values", () => {
  for (const exp of [undefined, null, "1780003600", nowSeconds - 100, Number.POSITIVE_INFINITY]) {
    assert.throws(() => verify({ ...baseClaims, exp }), /expired|expiry/);
  }
  assert.throws(() => verify({ ...baseClaims, iat: "old" }), /issue-time/);
  assert.throws(() => verify({ ...baseClaims, iat: nowSeconds + 121 }), /issue-time/);
  assert.throws(() => verify({ ...baseClaims, nbf: nowSeconds + 121 }), /not yet valid/);
  assert.throws(() => verify({ ...baseClaims, nbf: "invalid" }), /not yet valid/);
  assert.equal(verify({ ...baseClaims, nbf: nowSeconds - 10 }).email, "employee@corp.example");
});

test("OIDC supports signed custom mail claims but never accepts unverified custom email", () => {
  const custom = { ...baseClaims, mail: "other@corp.example" };
  assert.equal(verify(custom, { emailClaim: "mail" }).email, "other@corp.example");
  assert.throws(() => verify({ ...custom, email_verified: false }, { emailClaim: "mail" }), /explicitly verify/);
});

test("SCIM active is a JSON boolean, not the truthiness of the string 'false'", () => {
  assert.equal(parseScimActive(false), false);
  assert.equal(parseScimActive(true), true);
  for (const value of ["false", "true", 0, 1, null, "", {}]) {
    assert.throws(() => parseScimActive(value), EnterpriseProvisioningError);
  }
});

test("SCIM role parser rejects organization administrator and invalid role claims", () => {
  assert.equal(parseScimMemberRole("HR"), "hr");
  assert.equal(parseScimMemberRole([{ value: "manager" }]), "manager");
  for (const value of ["owner", "admin", "bookkeeper", "unknown", [], null, {}, ""]) {
    assert.throws(() => parseScimMemberRole(value), EnterpriseProvisioningError);
  }
});

test("SCIM cannot manufacture company-wide scope or unrelated worker identity", () => {
  assert.equal(scimProvisioningOrgUnit({
    requestedUnitId: 7, requestedRole: "hr", existingMembership: null,
  }), 7);
  assert.equal(scimProvisioningOrgUnit({
    requestedUnitId: null, requestedRole: "hr",
    existingMembership: { role: "hr", orgUnitId: 7 },
  }), 7);
  assert.equal(scimProvisioningOrgUnit({
    requestedUnitId: null, requestedRole: "hr",
    existingMembership: { role: "hr", orgUnitId: null },
  }), null);
  assert.throws(() => scimProvisioningOrgUnit({
    requestedUnitId: null, requestedRole: "employee", existingMembership: null,
  }), /company-wide/);
  assert.throws(() => scimProvisioningOrgUnit({
    requestedUnitId: null, requestedRole: "hr",
    existingMembership: { role: "employee", orgUnitId: null },
  }), /company-wide/);
  assert.throws(() => scimProvisioningOrgUnit({
    requestedUnitId: 0, requestedRole: "employee", existingMembership: null,
  }), /valid organization unit/);
  assert.doesNotThrow(() => assertScimWorkerScope({ workerOrgUnitId: 7, membershipOrgUnitId: 7 }));
  assert.throws(() => assertScimWorkerScope({ workerOrgUnitId: 9, membershipOrgUnitId: 7 }), /different department/);
});

test("shared global identity is immutable to another employer's SCIM connector", () => {
  assert.doesNotThrow(() => assertScimGlobalIdentityChange({
    sharedAcrossOrganizations: true, emailChanged: false, nameChanged: false, employeeLinkChanged: false,
  }));
  for (const changed of ["emailChanged", "nameChanged", "employeeLinkChanged"] as const) {
    assert.throws(() => assertScimGlobalIdentityChange({
      sharedAcrossOrganizations: true,
      emailChanged: false, nameChanged: false, employeeLinkChanged: false,
      [changed]: true,
    }), /another workspace/);
  }
});

test("SCIM enforces session revocation on identity/scope/worker changes, not name-only", () => {
  const base = {
    activeChanged: false, roleChanged: false, orgUnitChanged: false,
    workerLinkChanged: false, emailChanged: false, nameChanged: false,
  };
  assert.equal(shouldRevokeScimSessions(base), false);
  assert.equal(shouldRevokeScimSessions({ ...base, nameChanged: true }), false);
  for (const key of ["activeChanged", "roleChanged", "orgUnitChanged", "workerLinkChanged", "emailChanged"] as const) {
    assert.equal(shouldRevokeScimSessions({ ...base, [key]: true }), true);
  }
});

test("SCIM routes enforce tenant-bound worker lookup, atomic revocation and no email-based worker linking", () => {
  const list = readFileSync("src/app/api/scim/v2/Users/route.ts", "utf8");
  const byId = readFileSync("src/app/api/scim/v2/Users/[id]/route.ts", "utf8");
  const oidc = readFileSync("src/lib/oidc.ts", "utf8");
  assert.match(list, /parseScimActive\(body.active\)/);
  assert.match(byId, /parseScimActive\(value\)/);
  assert.match(byId, /parseScimActive\(object.active\)/);
  assert.doesNotMatch(list, /body.active !== false/);
  assert.doesNotMatch(byId, /Boolean\(value\)|Boolean\(object.active\)/);
  assert.match(list, /scimProvisioningOrgUnit/);
  assert.match(byId, /scimProvisioningOrgUnit/);
  assert.match(list, /workerEmployeeId: employee\?\.id \?\? null/);
  assert.match(byId, /workerEmployeeId: nextWorkerId/);
  assert.match(list, /eq\(employees.organizationId, auth.organizationId\)/);
  assert.match(byId, /eq\(employees.organizationId, organizationId\)/);
  assert.doesNotMatch(list, /ilike\(employees.email, email\)/);
  assert.match(list, /tx.update\(sessions\).set\(\{ revokedAt: new Date\(\) \}\)/);
  assert.match(byId, /tx.update\(sessions\).set\(\{ revokedAt: new Date\(\) \}\)/);
  assert.match(byId, /active === false \|\| shouldRevokeScimSessions/);
  assert.match(oidc, /verify\("RSA-SHA256"/);
  assert.ok(oidc.indexOf('verify("RSA-SHA256"') < oidc.indexOf("return validateOidcIdentityClaims("));
});
