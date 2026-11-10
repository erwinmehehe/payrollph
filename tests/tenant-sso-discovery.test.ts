import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { ssoDiscoveryEmail } from "../src/lib/tenant-sso-discovery";

const routeFile = "src/app/api/auth/sso/resolve/route.ts";
const manifestFile = "scripts/qa/tenant-isolation-coverage-manifest.json";

function gitBlobSha(content: string) {
  return createHash("sha1").update("blob " + Buffer.byteLength(content) + "\0" + content).digest("hex");
}

test("anonymous discovery normalizes the email but derives only its verified domain", () => {
  assert.deepEqual(ssoDiscoveryEmail("  Hiring.Team+PH@Company.Example  "), {
    email: "hiring.team+ph@company.example",
    domain: "company.example",
  });
  assert.deepEqual(ssoDiscoveryEmail("person@xn--bcher-kva.example"), {
    email: "person@xn--bcher-kva.example", domain: "xn--bcher-kva.example",
  });
});

test("reject coercible email values, repeated @, whitespace, wildcard and URL-like domains", () => {
  for (const bad of [
    undefined, null, {}, [], 0, true, ["employee@company.example"],
    "", "employee", "@company.example", "employee@", "employee@domain",
    "employee@company.example@other.example", "user name@company.example",
    "employee@company.example/", "employee@*.example", "employee@-bad.example",
    "employee@bad-.example", "employee@bad..example", "employee@company%2eexample",
    "employee@company.example?tenant=2", "employee@company_example.example",
    "local@" + "a".repeat(181) + ".example",
  ]) {
    assert.equal(ssoDiscoveryEmail(bad), null, "unexpected accepted value: " + String(bad));
  }
});

test("SSO resolve always binds the verified domain to its own enabled OIDC provider", () => {
  const src = readFileSync(routeFile, "utf8");
  assert.match(src, /innerJoin\(identityProviders, and\(/);
  assert.match(src, /eq\(identityDomains\.providerId, identityProviders\.id\)/);
  assert.match(src, /eq\(identityDomains\.organizationId, identityProviders\.organizationId\)/);
  assert.match(src, /eq\(identityDomains\.verified, true\)/);
  assert.match(src, /eq\(identityProviders\.protocol, "oidc"\)/);
  assert.match(src, /eq\(identityProviders\.enabled, true\)/);
  assert.match(src, /ssoDiscoveryEmail\(input\)/);
  assert.match(src, /limited\.mode !== "distributed-postgres"/);
  assert.match(src, /"Cache-Control": "no-store"/);
  assert.match(src, /enforceSameOriginMutation\(request\)/);
  assert.doesNotMatch(src, /body\.organizationId|body\.providerId|body\.tenantId/);
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const rec = manifest.allApiRouteFiles[routeFile];
  assert.equal(rec.gitBlobSha, gitBlobSha(src), "source drift requires re-inventory");
  assert.equal(rec.methods.find((method: { name: string }) => method.name === "POST")?.status, "GAP",
    "source hardening does not claim full tenant method certification");
});
