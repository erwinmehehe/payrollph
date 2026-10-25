import { assertLiveTenantCounts } from "./helpers/tenant-counts.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const script = readFileSync("scripts/qa/payout-destination-entity-http.mjs", "utf8");
const lines = script.split("\n");
const workflow = readFileSync(".github/workflows/multi-entity-browser-qa.yml", "utf8");
const overview = readFileSync("docs/engineering/tenant-isolation-coverage-inventory.md", "utf8");

const routes = [
  { method: "GET", path: "src/app/api/payout-destination-changes/route.ts",
    own: /const getB = ownRequests\(await request\(b, ON, ownB\)/,
    denial: /await deniedAndUnchanged\(actor, ON, victimList, "GET", undefined, 403/,
    forged: /await deniedAndUnchanged\(actor, ON, own \+ "&employeeId="/,
  },
  { method: "PATCH", path: "src/app/api/payout-destination-changes/[id]/route.ts",
    own: /const positivePatchB = expectStatus\(await request\(b, ON, patch\(bRows\[0\]\.evidence\.id\)/,
    denial: /await deniedAndUnchanged\(actor, ON, patch\(aAlpha\.evidence\.id\)/,
    forged: /await deniedAndUnchanged\(actor, ON, patch\(item\.evidence\.id\)/,
  },
];

test("payout GET and PATCH have exact immutable real-HTTP proof links, not only a renamed GAP", () => {
  for (const spec of routes) {
    const record = manifest.allApiRouteFiles[spec.path];
    assert.ok(record, spec.path);
    const method = record.methods.find(m => m.name === spec.method);
    assert.equal(method?.status, "COVERED");
    assert.match(method.reason, /PROVISIONAL.*exact-head CI/);
    const proof = method.testedBy;
    assert.equal(proof?.file, "scripts/qa/payout-destination-entity-http.mjs");
    for (const field of ["line", "ownPositiveLine", "foreignDenialLine",
      "forgedSelectorLine", "unchangedDbLine", "victimIdOrderingLine"]) {
      assert.ok(Number.isSafeInteger(proof[field]) && proof[field] > 0 &&
        proof[field] <= lines.length, spec.method + ": invalid " + field);
    }
    assert.match(lines[proof.ownPositiveLine - 1], spec.own);
    assert.match(lines[proof.foreignDenialLine - 1], spec.denial);
    assert.match(lines[proof.forgedSelectorLine - 1], spec.forged);
    assert.match(lines[proof.unchangedDbLine - 1],
      /assert\.deepEqual\(await snapshot\(victimA\), victimBefore/);
    assert.match(lines[proof.victimIdOrderingLine - 1], /aAlpha\.evidence\.id > 6/);
    assert.match(lines[proof.line - 1], /PAYOUT_ENTITY_METHODS/);
    const following = lines.slice(proof.ownPositiveLine - 1, proof.ownPositiveLine + 2).join("\n");
    if (spec.method === "PATCH") assert.match(following, /"PATCH".*\), 200,/s);
    else assert.match(following, /"B owned GET 200"/);
  }
});

test("proof cannot silently drop genuine signed-in, disposable and unchanged-victim evidence", () => {
  assert.match(script, /requireDisposable\(\);/);
  assert.match(script, /GITHUB_ACTIONS.*"true"/);
  assert.match(script, /MULTI_ENTITY_ENABLED.*"true"/);
  assert.match(script, /DATABASE_URL[\s\S]*app_db/);
  assert.match(script, /chromium\.launch/);
  assert.match(script, /"\/api\/auth\/login"/);
  assert.match(script, /context\.cookies\(base\)/);
  assert.match(script, /await sql\.query\("DELETE FROM organizations/);
  assert.match(script, /two employers|two legal|sameTenantLegalEmployers: 2/i);
  assert.match(script, /await deniedAndUnchanged\(pa, ON, patch\(legacy\.evidence\.id\)/);
  assert.match(script, /await deniedAndUnchanged\(pb, ON, patch\(transferred\.evidence\.id\)/);
  assert.match(script, /Revoked employer grant denies same signed-in session GET/);
  assert.match(script, /Flag-OFF legacy read compatibility/);
  assert.match(script, /result: "PASS"/);
  assert.match(script, /realPayout: false, productionApproved: false/);
});

test("flag-ON/OFF workflow must actually execute source-pinned real HTTPS/PG16 proof", () => {
  assert.match(workflow, /MULTI_ENTITY_QA_MODE: synthetic-postgres-only/);
  assert.match(workflow, /MULTI_ENTITY_ENABLED: "true"/);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /PAYMONGO_DISBURSEMENTS_ENABLED: "false"/);
  assert.match(workflow, /XENDIT_PAYOUTS_ENABLED: "false"/);
  assert.match(workflow, /node --check scripts\/qa\/payout-destination-entity-http\.mjs/);
  assert.match(workflow, /node scripts\/qa\/payout-destination-entity-http\.mjs/);
});

test("synced method inventory retains live counts and base coverage", () => { assertLiveTenantCounts(assert, manifest); });

test("synced method inventory retains live counts and base coverage", () => { assertLiveTenantCounts(assert, manifest); });
