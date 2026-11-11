import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SAML_METADATA_ROUTE, SAML_METADATA_BLOB, SAML_PRIVACY_HOLD,
  verifySamlMetadataPrivacyHold,
} from "../scripts/qa/tenant-saml-metadata-privacy-verify.mjs";

function candidate() {
  return { allApiRouteFiles: { [SAML_METADATA_ROUTE]: {
    gitBlobSha: SAML_METADATA_BLOB,
    methods: [{ name: "GET", status: "GAP", testedBy: null, reviewedUncertified: structuredClone(SAML_PRIVACY_HOLD) }],
  } } };
}
function method(m) { return m.allApiRouteFiles[SAML_METADATA_ROUTE].methods[0]; }

test("the exact privacy source hold grants zero method credits", () => {
  assert.equal(verifySamlMetadataPrivacyHold(candidate()), 0);
});

test("actual manifest is source-current but remains GAP and uncredited", () => {
  const m = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  assert.equal(verifySamlMetadataPrivacyHold(m), 0);
});

test("the hold refuses missing entries, other methods, promotion and invented receipts", () => {
  const changes = [
    m => { delete m.allApiRouteFiles[SAML_METADATA_ROUTE]; },
    m => { method(m).name = "POST"; },
    m => { m.allApiRouteFiles[SAML_METADATA_ROUTE].methods.push({ name: "POST", status: "GAP", testedBy: null }); },
    m => { method(m).status = "COVERED"; },
    m => { method(m).status = "PUBLIC-BY-DESIGN"; },
    m => { method(m).testedBy = { workflowRunId: 42181922549 }; },
    m => { delete method(m).reviewedUncertified; },
    m => { method(m).reviewedUncertified.coverageCredits = 1; },
    m => { method(m).reviewedUncertified.exactHeadPg16Http = "PASS"; },
    m => { m.allApiRouteFiles[SAML_METADATA_ROUTE].gitBlobSha = "0".repeat(40); },
  ];
  for (const change of changes) {
    const m = candidate(); change(m);
    assert.throws(() => verifySamlMetadataPrivacyHold(m));
  }
});

test("route drift and every altered evidence source invalidate the hold", () => {
  for (const path of [SAML_METADATA_ROUTE, ...Object.keys(SAML_PRIVACY_HOLD.pins)]) {
    assert.throws(() => verifySamlMetadataPrivacyHold(candidate(), file => {
      const bytes = readFileSync(file);
      return file === path ? Buffer.concat([bytes, Buffer.from("\n// drift\n")]) : bytes;
    }), /source drift/);
  }
});

test("removing or replacing one proof pin cannot weaken the source hold", () => {
  for (const path of Object.keys(SAML_PRIVACY_HOLD.pins)) {
    const removed = candidate(); delete method(removed).reviewedUncertified.pins[path];
    assert.throws(() => verifySamlMetadataPrivacyHold(removed));
    const replaced = candidate(); method(replaced).reviewedUncertified.pins[path] = "0".repeat(40);
    assert.throws(() => verifySamlMetadataPrivacyHold(replaced));
  }
});
