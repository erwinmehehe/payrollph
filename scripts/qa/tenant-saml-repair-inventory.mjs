/** One-use exact-source inventory repair for draft #1934. No DB or runtime imports. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  SAML_METADATA_ROUTE, SAML_METADATA_BLOB, SAML_PRIVACY_HOLD,
  verifySamlMetadataPrivacyHold,
} from "./tenant-saml-metadata-privacy-verify.mjs";

const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const INVENTORY = "tests/tenant-isolation-coverage-inventory.test.mjs";
const OLD_MANIFEST = "abc136d2b509b58bfae3f0be94dd9a0931cc1c55";
const OLD_INVENTORY = "3846cdedd7d90092e0659ec9658d5fac64e2777e";
const OLD_ROUTE = "589fb64376d807f03245a12c6aca1de7c3bfa08f";
const IMPORT = 'import { verifySamlMetadataPrivacyHold, SAML_METADATA_ROUTE } from "../scripts/qa/tenant-saml-metadata-privacy-verify.mjs";\n';
const ANCHOR = 'function reviewedStatus(method, key, isNewOrChanged, currentBlob) {\n';
const BLOCK = '\n  // Exact-source uncredited privacy repair; this permits no coverage promotion.\n' +
  '  if (key === SAML_METADATA_ROUTE + " GET") {\n' +
  '    assert.equal(currentBlob, "4f8d12b9867de0c18aea8e447208e8470773350b");\n' +
  '    assert.equal(verifySamlMetadataPrivacyHold(manifest), 0);\n' +
  '    return true;\n' +
  '  }\n';
const hash = text => createHash("sha1").update("blob " + Buffer.byteLength(text) + "\0" + text).digest("hex");
const raw = readFileSync(MANIFEST, "utf8");
const original = JSON.parse(raw);
const manifest = structuredClone(original);
let inventory = readFileSync(INVENTORY, "utf8");
const spacing = [2, 4, "\t", 0].find(value => JSON.stringify(original, null, value) === raw.trimEnd());
assert.notEqual(spacing, undefined, "Refuse to reformat an unrecognized manifest");
const trailing = raw.slice(raw.trimEnd().length);
const serialize = value => JSON.stringify(value, null, spacing) + trailing;
const record = manifest.allApiRouteFiles[SAML_METADATA_ROUTE];
assert.ok(record);
assert.equal(record.methods.length, 1);
const method = record.methods[0];
assert.equal(method.name, "GET");
assert.equal(method.status, "GAP");
assert.equal(method.testedBy, null);

if (record.gitBlobSha === SAML_METADATA_BLOB) {
  // Idempotence still verifies the entire pre-change files, not merely two tokens.
  verifySamlMetadataPrivacyHold(manifest);
  record.gitBlobSha = OLD_ROUTE;
  delete method.reviewedUncertified;
  assert.equal(hash(serialize(manifest)), OLD_MANIFEST, "Unexpected additional manifest edits");
  assert.equal(inventory.split(IMPORT).length, 2);
  assert.equal(inventory.split(ANCHOR + BLOCK).length, 2);
  inventory = inventory.replace(IMPORT, "").replace(ANCHOR + BLOCK, ANCHOR);
  assert.equal(hash(inventory), OLD_INVENTORY, "Unexpected additional inventory edits");
  console.log("Exact-source SAML inventory repair already applied; zero credits.");
  process.exit(0);
}
assert.equal(hash(raw), OLD_MANIFEST, "Manifest moved; inspect current source instead of overwriting");
assert.equal(hash(inventory), OLD_INVENTORY, "Inventory guard moved; inspect instead of overwriting");
assert.equal(record.gitBlobSha, OLD_ROUTE);
assert.equal(method.reviewedUncertified, undefined, "Do not overwrite an existing source decision");
record.gitBlobSha = SAML_METADATA_BLOB;
method.reviewedUncertified = structuredClone(SAML_PRIVACY_HOLD);
verifySamlMetadataPrivacyHold(manifest);
const counts = value => Object.values(value.allApiRouteFiles).flatMap(r => r.methods)
  .reduce((out, m) => ({ ...out, [m.status]: (out[m.status] || 0) + 1 }), {});
assert.deepEqual(counts(manifest), counts(original));
const restored = structuredClone(manifest);
restored.allApiRouteFiles[SAML_METADATA_ROUTE].gitBlobSha = OLD_ROUTE;
delete restored.allApiRouteFiles[SAML_METADATA_ROUTE].methods[0].reviewedUncertified;
assert.deepEqual(restored, original, "Only this route pin and its uncredited hold may change");
assert.equal(inventory.split(ANCHOR).length, 2, "Expected exactly one inventory function anchor");
assert.ok(!inventory.includes(IMPORT));
const updatedInventory = IMPORT + inventory.replace(ANCHOR, ANCHOR + BLOCK);
writeFileSync(MANIFEST, serialize(manifest));
writeFileSync(INVENTORY, updatedInventory);
console.log(JSON.stringify({ changedFiles: [MANIFEST, INVENTORY], counts: counts(manifest), coverageCredits: 0,
  routeBlobSha: SAML_METADATA_BLOB, manifestBlobSha: hash(serialize(manifest)), inventoryBlobSha: hash(updatedInventory) }));
