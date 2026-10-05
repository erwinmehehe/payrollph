import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuthorizationUrl,
  createOidcLoginMaterial,
  hashOidcState,
  normalizeEmailDomain,
  validateIssuer,
} from "../src/lib/oidc";

test("OIDC issuer validation rejects insecure and private endpoints", () => {
  assert.throws(() => validateIssuer("http://login.example.com"), /HTTPS/);
  assert.throws(() => validateIssuer("https://localhost:8443"), /public HTTPS/);
  assert.throws(() => validateIssuer("https://10.1.2.3"), /public HTTPS/);
  assert.equal(validateIssuer("https://login.example.com/tenant/"), "https://login.example.com/tenant");
});

test("company SSO domains are normalized and constrained", () => {
  assert.equal(normalizeEmailDomain("@Example.COM"), "example.com");
  assert.throws(() => normalizeEmailDomain("localhost"), /valid company email domain/);
});

test("OIDC login material uses opaque state and PKCE S256", () => {
  const material = createOidcLoginMaterial();
  assert.ok(material.state.length >= 40);
  assert.ok(material.verifier.length >= 43);
  assert.ok(material.challenge.length >= 40);
  assert.equal(hashOidcState(material.state).length, 64);

  const url = new URL(buildAuthorizationUrl({
    discovery: {
      issuer: "https://login.example.com",
      authorization_endpoint: "https://login.example.com/oauth2/authorize",
      token_endpoint: "https://login.example.com/oauth2/token",
      userinfo_endpoint: "https://login.example.com/oauth2/userinfo",
      code_challenge_methods_supported: ["S256"],
    },
    clientId: "client-1",
    redirectUri: "https://payroll.example.com/api/auth/sso/callback",
    state: material.state,
    challenge: material.challenge,
  }));
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), material.state);
});
