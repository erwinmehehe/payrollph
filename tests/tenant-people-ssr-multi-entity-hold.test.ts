import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { multiEntityHcmRequestDeferred } from "../src/lib/multi-entity-hcm-hold";

const reviewedPages = {
  "src/app/app/engagement/page.tsx": "48132ee7356603136d7ac660086b3812ef28ed94",
  "src/app/app/goals-reviews/page.tsx": "4989da5727ea5a55d0565fec6eb0af71cbb6046c",
} as const;

function gitBlobSha(bytes: Buffer): string {
  return createHash("sha1")
    .update(Buffer.from("blob " + bytes.length + "\0"))
    .update(bytes).digest("hex");
}

test("both private People routes honor the existing exact-true multi-entity hold", () => {
  for (const path of ["/app/engagement", "/app/goals-reviews"] as const) {
    assert.equal(multiEntityHcmRequestDeferred(path, "GET", {
      MULTI_ENTITY_ENABLED: "true",
    }), true, path + " must fail closed while multi-entity HCM is deferred");

    for (const value of [undefined, "", "false", "TRUE", "True", "1", " true "]) {
      assert.equal(multiEntityHcmRequestDeferred(path, "GET", {
        MULTI_ENTITY_ENABLED: value,
      }), false, path + ": preserve the feature-OFF behavior");
    }
  }
});

test("request guard covers People HTML and prefetch before any private page loads", () => {
  const source = readFileSync("src/proxy.ts", "utf8");
  for (const route of ["/app/engagement", "/app/goals-reviews"]) {
    assert.ok(source.includes('path === "' + route + '"'),
      route + " requires an exact request guard");
    assert.ok(source.includes('path.startsWith("' + route + '/")'),
      route + " trailing or nested requests cannot evade the guard");
    assert.ok(source.includes('"' + route + '/:path*"'),
      route + " requires an explicit matcher for prefetch requests");
  }
  assert.match(source, /\|\| peoplePage;/,
    "Both People pages must be part of the protected HCM route set");
  const authorization = source.indexOf("if (guarded && multiEntityHcmRequestDeferred(path, request.method))");
  const csp = source.indexOf('process.env.NEXT_CSP_ENABLED !== "true"');
  assert.ok(authorization > 0 && csp > authorization,
    "The HCM hold must run before unrelated CSP or rendering logic");
  assert.ok(source.includes('"/hcm/:path*"') &&
    source.includes('"/api/hcm/:path*"'),
  "Keep the original HCM embargo matchers in place");
});

test("historical People SSR page blobs remain unchanged and source-pinned", () => {
  for (const [path, expected] of Object.entries(reviewedPages)) {
    const data = readFileSync(path);
    assert.equal(gitBlobSha(data), expected, path + " should not be repinned by this proxy-only fix");
  }
});
