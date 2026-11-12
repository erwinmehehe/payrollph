import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { multiEntityHcmDeferred } from "../src/lib/multi-entity-hcm-hold";

const reviewedPeoplePages = {
  "src/app/app/engagement/page.tsx": {
    prior: "48132ee7356603136d7ac660086b3812ef28ed94",
    current: "6e84c87f63816042a847e4fbccfd970b84ceffa3",
    flag: "engagementSurvey",
  },
  "src/app/app/goals-reviews/page.tsx": {
    prior: "4989da5727ea5a55d0565fec6eb0af71cbb6046c",
    current: "13cc6239921d740cf984066e3cf716f752ec1371",
    flag: "goalsReviewCycle",
  },
} as const;

function gitBlobSha(bytes: Buffer): string {
  return createHash("sha1")
    .update(Buffer.from("blob " + bytes.length + "\0"))
    .update(bytes).digest("hex");
}

test("People SSR hold uses the exact multi-entity release flag", () => {
  assert.equal(multiEntityHcmDeferred({ MULTI_ENTITY_ENABLED: "true" }), true);
  for (const value of [undefined, "", "false", "TRUE", "True", "1", " true "]) {
    assert.equal(multiEntityHcmDeferred({ MULTI_ENTITY_ENABLED: value }), false,
      "Only the exact enabled flag triggers the existing HCM rollout hold");
  }
});

for (const [path, pin] of Object.entries(reviewedPeoplePages)) {
  test(path + " guards the page before session and private data reads", () => {
    const bytes = readFileSync(path);
    const source = bytes.toString("utf8");
    assert.notEqual(pin.prior, pin.current, "Maintain the prior reviewed source separately");
    assert.equal(gitBlobSha(bytes), pin.current, "Renew current source only with fresh review");
    assert.match(source,
      /import \{ multiEntityHcmDeferred \} from "@\/lib\/multi-entity-hcm-hold";/,
      "Use the existing global HCM hold; do not invent a second release flag");
    const entry = source.indexOf("export default async function Page(");
    const hold = source.indexOf("if (multiEntityHcmDeferred()) notFound();", entry);
    const existingFlag = source.indexOf('criticalReleaseFlagEnabled("' + pin.flag + '")', entry);
    const firstSession = source.indexOf("await getSessionUser()", entry);
    const employerRead = source.indexOf("await singleLegalEntityForTenant(", entry);
    assert.ok(entry >= 0 && hold > entry, "Hold belongs to the SSR entrypoint");
    assert.ok(existingFlag > hold, "Global embargo must precede the feature flag");
    assert.ok(firstSession > hold, "Global embargo must refuse before session lookup");
    assert.ok(employerRead > hold, "Global embargo must refuse before legal-employer metadata reads");
    assert.ok(source.includes("canonicalPeoplePageOrganizationId(raw)"),
      "Preserve the existing canonical employer selector");
  });
}

test("global proxy source seal is unchanged; do not repin unrelated API evidence", () => {
  const source = readFileSync("src/proxy.ts");
  assert.equal(gitBlobSha(source), "8ed6591c4846cad3251bc1ee2444ceb3461b170a");
});
