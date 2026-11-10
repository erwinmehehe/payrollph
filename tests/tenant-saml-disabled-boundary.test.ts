import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GET as start } from "../src/app/api/auth/saml/start/[providerId]/route";
import { GET as metadata } from "../src/app/api/auth/saml/metadata/[providerId]/route";
import { POST as acs } from "../src/app/api/auth/saml/acs/[providerId]/route";

const cases = [
  { name: "start", method: "GET", path: "src/app/api/auth/saml/start/[providerId]/route.ts", handler: start },
  { name: "metadata", method: "GET", path: "src/app/api/auth/saml/metadata/[providerId]/route.ts", handler: metadata },
  { name: "acs", method: "POST", path: "src/app/api/auth/saml/acs/[providerId]/route.ts", handler: acs },
] as const;

function gitBlobSha(source: string) {
  return createHash("sha1").update("blob " + Buffer.byteLength(source) + "\0" + source).digest("hex");
}

test("disabled SAML returns a provider-independent response for each entrypoint", async () => {
  const ids = ["1", "17", "999999", "0", "01", "1e2", "-1", "not-an-id"];
  const seen = new Set<string>();
  for (const entry of cases) {
    for (const providerId of ids) {
      const url = "https://linaw.example.invalid/api/auth/saml/" + entry.name + "/" + encodeURIComponent(providerId);
      const response = await entry.handler(
        new Request(url, { method: entry.method }),
        { params: Promise.resolve({ providerId }) },
      );
      assert.equal(response.status, 503, entry.name + " " + providerId);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.match(response.headers.get("content-type") ?? "", /application\/json/);
      const body = await response.text();
      const payload = JSON.parse(body);
      assert.equal(payload.code, "SAML_RUNTIME_NOT_READY");
      assert.equal(typeof payload.error, "string");
      assert.ok(!/providerId|"configured"\s*:|"enabled"\s*:|entityID|AssertionConsumerService/.test(body));
      seen.add(response.status + ":" + body);
    }
  }
  assert.equal(seen.size, 1, "unknown and configured provider IDs must be indistinguishable");
});

test("all disabled SAML routes have no database or metadata lookup before refusal", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  for (const entry of cases) {
    const source = readFileSync(entry.path, "utf8");
    const record = manifest.allApiRouteFiles[entry.path];
    const method = record?.methods.find((item: { name: string }) => item.name === entry.method);
    const sha = gitBlobSha(source);
    assert.match(source, /samlDisabledBoundaryResponse\(\)/);
    assert.doesNotMatch(source, /identityProviders|buildSamlServiceProviderMetadata|from ["']@\/db|db\.select/);
    assert.equal(record?.gitBlobSha, sha, entry.path + ": manifest source must be exact");
    assert.equal(method?.status, "GAP", "runtime refusal is not a tenant-private coverage credit");
    assert.equal(method?.testedBy, null, "no successful own-tenant proof has run");
    assert.equal(method?.reviewedUncertified?.routeBlobSha, sha);
    assert.equal(method?.reviewedUncertified?.methodCredits, 0);
    assert.equal(method?.reviewedUncertified?.independentSecurityReview, "PENDING");
  }
});
