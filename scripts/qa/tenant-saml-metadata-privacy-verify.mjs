/** Exact-source uncredited hold for ONE metadata GET; never a coverage receipt. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const SAML_METADATA_ROUTE = "src/app/api/auth/saml/metadata/[providerId]/route.ts";
export const SAML_METADATA_BLOB = "4f8d12b9867de0c18aea8e447208e8470773350b";
export const SAML_PRIVACY_HOLD = Object.freeze({
  "kind": "saml-metadata-disabled-provider-privacy-uncredited",
  "originalRouteBlobSha": "589fb64376d807f03245a12c6aca1de7c3bfa08f",
  "routeBlobSha": "4f8d12b9867de0c18aea8e447208e8470773350b",
  "ownerDecision": "CONCEAL_DISABLED_PROVIDERS",
  "pins": {
    "scripts/qa/tenant-saml-metadata-public-contract.mjs": "2441096ba04ae781f53eba7970c0f378501e5342",
    "scripts/qa/tenant-saml-metadata-public-http.mjs": "564f1a50a078f3ec7a4fe2461ce27a8f9d5f54ff",
    "tests/tenant-saml-metadata-public.test.mjs": "92319255a731985455c273836abafd812326edaf",
    "tests/tenant-saml-metadata-disabled-route.test.mjs": "07b2f7400b5cc8072806258ea1b8470e702cca6e",
    "tests/tenant-saml-metadata-privacy-verify.test.mjs": "540d1e4745de83868e731819f1151bcb40692d98",
    ".github/workflows/tenant-saml-metadata-public-http.yml": "4ac2edcb432eb406557edf3db260f4da876f5e18"
  },
  "coverageCredits": 0,
  "exactHeadPg16Http": "PENDING",
  "independentlyAccepted": false,
  "productionCertified": false
});
Object.freeze(SAML_PRIVACY_HOLD.pins);

function hash(bytes) {
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash("sha1").update("blob " + data.length + "\0").update(data).digest("hex");
}
function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length, 2, "The reviewed source edit must occur exactly once");
  return text.replace(from, to);
}
export function verifySamlMetadataPrivacyHold(manifest, read = path => readFileSync(path)) {
  const entry = manifest.allApiRouteFiles?.[SAML_METADATA_ROUTE];
  assert.ok(entry, "Only the specified SAML metadata route may use this hold");
  assert.equal(entry.gitBlobSha, SAML_METADATA_BLOB);
  assert.equal(entry.methods.length, 1, "No additional method may inherit this hold");
  const method = entry.methods[0];
  assert.equal(method.name, "GET");
  assert.equal(method.status, "GAP", "A source hold cannot promote a method");
  assert.equal(method.testedBy, null, "Historical disabled-provider disclosure is not repair evidence");
  assert.deepEqual(method.reviewedUncertified, SAML_PRIVACY_HOLD);
  const source = read(SAML_METADATA_ROUTE).toString();
  assert.equal(hash(source), SAML_METADATA_BLOB, "SAML metadata route source drift");
  for (const [path, sha] of Object.entries(SAML_PRIVACY_HOLD.pins)) {
    assert.equal(hash(read(path)), sha, "SAML metadata proof source drift: " + path);
  }
  assert.deepEqual([...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map(m => m[1]), ["GET"]);
  let historical = replaceOnce(source, '    eq(identityProviders.enabled, true),\n', '');
  historical = replaceOnce(historical,
    '  if (!provider) return Response.json(\n' +
    '    { error: "SAML provider not found." },\n' +
    '    { status: 404, headers: { "Cache-Control": "no-store" } },\n' +
    '  );',
    '  if (!provider) return Response.json({ error: "SAML provider not found." }, { status: 404 });');
  historical = replaceOnce(historical, '      "Cache-Control": "no-store",',
    '      "Cache-Control": "private, max-age=300",');
  assert.equal(hash(historical), SAML_PRIVACY_HOLD.originalRouteBlobSha,
    "No unrelated runtime edit may inherit this uncredited review");
  return 0;
}
