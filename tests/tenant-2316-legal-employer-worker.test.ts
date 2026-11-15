import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { verifySixPageCredits, historicSixPageView, selectedTargets } from "../scripts/qa/tenant-six-scoped-page-credit.mjs";

const path = "src/app/workspace/2316/page.tsx";
const source = readFileSync(path, "utf8");
function gitBlobSha(content: string) {
  return createHash("sha1").update("blob " + Buffer.byteLength(content) + "\0" + content)
    .digest("hex");
}

test("2316 denies ungranted same-parent worker IDs before any guidance or private form", () => {
  const role = source.indexOf("await assertOrganizationRole(");
  const scope = source.indexOf("await resolveMultiEntityContext(");
  const workerQuery = source.indexOf("const [worker] = await db.select(");
  const guard = source.indexOf(
    "if (selectedSeparationId === null && entityScope.context.enabled &&");
  const separation = source.indexOf("const [separation] = await db.select(");
  const guidance = source.indexOf("Select a released final-pay separation");
  const mount = source.indexOf("<Certificate2316Review");
  assert.ok(role >= 0 && scope > role && workerQuery > scope && guard > workerQuery &&
    separation > guard && guidance > separation && mount > guidance);
  assert.match(source, /legalEntityId: employees\.legalEntityId/);
  assert.match(source, /assertEntityResource\(entityScope\.context, worker\.legalEntityId\)\) notFound\(\)/);
  assert.match(source, /frozenFinalPayLegalEntityId\(separation\.snapshot\)/);
  assert.match(source, /separation\.status !== "released"/);
  const m = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const entry = m.scopedPages.find((item: {path: string}) => item.path === path);
  assert.equal(entry?.blob, gitBlobSha(source), "2316 source changed without re-inventory");
  // Source hardening alone still earns no credit. A current provisional
  // receipt is permitted only after all six exact-source runner, selector,
  // revocation and unchanged-victim SQL anchors pass source verification.
  assert.equal(verifySixPageCredits(m), selectedTargets().length,
    "2316 cannot borrow its original unselected-shell proof");
  const original = historicSixPageView(m).scopedPages.find(
    (item: {path: string}) => item.path === path);
  assert.equal(original?.status, "GAP", "source hardening alone earns no page credit");
  assert.equal(original?.testedBy, undefined);
  assert.equal(entry?.status, "COVERED", "only six-page proven SSR can be proposed");
  assert.equal(entry?.testedBy?.sourcePageBlobSha, gitBlobSha(source));
  assert.equal(entry?.testedBy?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
  assert.equal(entry?.testedBy?.actualFinalHeadRunRequired, true);
  assert.equal(entry?.testedBy?.independentlyAccepted, false);
  assert.equal(entry?.testedBy?.productionCertified, false);
  assert.equal(entry?.reviewedUncertified?.pageActionCredits, 0);
});
