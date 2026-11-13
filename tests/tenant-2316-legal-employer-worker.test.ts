import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";

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
  assert.equal(entry?.status, "GAP", "source hardening earns no page credit");
  assert.equal(entry?.reviewedUncertified?.pageActionCredits, 0);
});
