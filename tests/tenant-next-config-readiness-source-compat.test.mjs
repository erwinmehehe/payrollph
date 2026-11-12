import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertHistoricalNextConfigPreservedWithInvitationHeaders } from
  "../scripts/qa/tenant-invitation-header-source-compat.mjs";

const historicalSha = "a61ed6eeefbf0795e94982ae3df55223c9e11dfa";
const source = readFileSync("next.config.ts", "utf8");
const compat = value => assertHistoricalNextConfigPreservedWithInvitationHeaders(
  Buffer.from(value), historicalSha,
);

test("the exact private Readiness header preserves the sealed enterprise source", () => {
  assert.equal(compat(source), true);
  assert.equal(source.match(/source: "\/api\/readiness\/workspace"/g)?.length, 1);
  assert.match(source, /source: "\/api\/readiness\/workspace",[\s\S]*?"private, no-store, max-age=0"/);
});

test("missing, public, broadened, duplicated or reordered rules fail the historical source guard", () => {
  const changes = [
    source.replace('source: "/api/readiness/workspace"', 'source: "/api/:path*"'),
    source.replace('source: "/api/readiness/workspace"', 'source: "/api/readiness"'),
    source.replace('value: "private, no-store, max-age=0"', 'value: "public, max-age=3600"'),
    source.replace('source: "/api/readiness/workspace"', 'source: "/api/readiness/workspace"\n      // duplicate'),
    source.replace('source: "/api/invitations/accept"', 'source: "/api/invitations"'),
    source.replace('source: "/api/:path*"', 'source: "/api/**"'),
    source.replace('value: "DENY"', 'value: "SAMEORIGIN"'),
    source + "\n// unreviewed source drift\n",
  ];
  for (const changed of changes) {
    assert.notEqual(changed, source, "A negative control must change actual source bytes");
    assert.throws(() => compat(changed), /Next config drift beyond two exact reviewed private-header exceptions/);
  }
  assert.throws(() =>
    assertHistoricalNextConfigPreservedWithInvitationHeaders(Buffer.from(source), "forged"),
    /Only the precise historical Next config receipt/,
  );
});
