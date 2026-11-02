import assert from "node:assert/strict";
import test from "node:test";
import { isIndependentPayoutPatchChange, PAYOUT_ROUTE, COVERAGE_MANIFEST } from "../scripts/ci/payout-optional-workflow-scope.mjs";

const beforeRoute = [
  "export async function GET() { return Response.json({ safe: true }); }",
  "export async function PATCH(request: Request) { return Response.json({ ok: true }); }",
].join("\n");
const afterRoute = beforeRoute.replace(
  "return Response.json({ ok: true });",
  "const scoped = true; return Response.json({ ok: scoped });",
);
const changed = [
  PAYOUT_ROUTE,
  COVERAGE_MANIFEST,
  "scripts/qa/tenant-payout-profiles-patch-http.mjs",
  "tests/tenant-payout-profiles-patch-audit.test.mjs",
  "tests/tenant-isolation-coverage-inventory.test.mjs",
];

function fixture() {
  const beforeManifest = {
    totals: { COVERED: 386, GAP: 102 },
    allApiRouteFiles: {
      [PAYOUT_ROUTE]: {
        gitBlobSha: "old",
        methods: [
          { name: "GET", status: "COVERED", testedBy: "independent-get-proof" },
          { name: "PATCH", status: "GAP", testedBy: null, reviewedUncertified: { credits: 0, note: "review pending" } },
        ],
      },
      "src/app/api/hcm/work-items/escalate/route.ts": {
        gitBlobSha: "unchanged",
        methods: [{ name: "POST", status: "GAP", testedBy: null }],
      },
    },
  };
  const afterManifest = structuredClone(beforeManifest);
  afterManifest.allApiRouteFiles[PAYOUT_ROUTE].gitBlobSha = "new";
  afterManifest.allApiRouteFiles[PAYOUT_ROUTE].methods[1].reviewedUncertified.note = "new isolated PG16 candidate";
  return { files: [...changed], beforeRoute, afterRoute, beforeManifest, afterManifest };
}

test("only the independently proved payout PATCH family may skip unrelated optional PostgreSQL workflows", () => {
  assert.equal(isIndependentPayoutPatchChange(fixture()), true);
});

test("shared auth/schema edits and unrelated route edits keep ALL optional proofs", () => {
  for (const path of [
    "src/lib/access.ts",
    "src/db/schema.ts",
    "src/app/api/hcm/work-items/escalate/route.ts",
    ".github/workflows/tenant-dl01-closure.yml",
    "package-lock.json",
    "scripts/ci/payout-optional-workflow-scope.mjs",
  ]) {
    const f = fixture();
    f.files.push(path);
    assert.equal(isIndependentPayoutPatchChange(f), false, path);
  }
});

test("independent payout GET changes or no PATCH code changes never skip optional proofs", () => {
  const modifiedGet = fixture();
  modifiedGet.afterRoute = modifiedGet.afterRoute.replace("safe: true", "safe: false");
  assert.equal(isIndependentPayoutPatchChange(modifiedGet), false);
  const unchangedRoute = fixture();
  unchangedRoute.afterRoute = beforeRoute;
  assert.equal(isIndependentPayoutPatchChange(unchangedRoute), false);
});

test("manifest changes elsewhere, including aggregate totals, always require full proofs", () => {
  const unrelatedRoute = fixture();
  unrelatedRoute.afterManifest.allApiRouteFiles["src/app/api/hcm/work-items/escalate/route.ts"].gitBlobSha = "changed";
  assert.equal(isIndependentPayoutPatchChange(unrelatedRoute), false);
  const totals = fixture();
  totals.afterManifest.totals.GAP -= 1;
  assert.equal(isIndependentPayoutPatchChange(totals), false);
});

test("neither fabricated PATCH coverage nor missing independent proof may skip", () => {
  const credit = fixture();
  credit.afterManifest.allApiRouteFiles[PAYOUT_ROUTE].methods[1].reviewedUncertified.credits = 1;
  assert.equal(isIndependentPayoutPatchChange(credit), false);
  const covered = fixture();
  covered.afterManifest.allApiRouteFiles[PAYOUT_ROUTE].methods[1].status = "COVERED";
  assert.equal(isIndependentPayoutPatchChange(covered), false);
  const proof = fixture();
  proof.files = proof.files.filter((path) => !path.includes("patch-http.mjs"));
  assert.equal(isIndependentPayoutPatchChange(proof), false);
  const contract = fixture();
  contract.files = contract.files.filter((path) => !path.includes("patch-audit.test.mjs"));
  assert.equal(isIndependentPayoutPatchChange(contract), false);
});

test("unknown or malformed comparison results fail closed", () => {
  for (const files of [null, [], ["src/app/api/payout-profiles/route.ts"], ["../evil"]]) {
    assert.equal(isIndependentPayoutPatchChange({ ...fixture(), files }), false);
  }
  assert.equal(isIndependentPayoutPatchChange({ ...fixture(), beforeManifest: null }), false);
  assert.equal(isIndependentPayoutPatchChange({ ...fixture(), afterRoute: null }), false);
});
