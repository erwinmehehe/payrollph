/**
 * Proof compatibility for the one reviewed, non-overlapping invitation response
 * header rule. This does not reprove invitation GET/POST or earn any credit.
 * All other Next config bytes must match the historical executed PG16 receipt.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const REVIEWED_SOURCE_SHA = "72fe25fba8c44a20c29eabfd85568114f5c70c6f";
const HISTORICAL_SOURCE_SHA = "a61ed6eeefbf0795e94982ae3df55223c9e11dfa";
const INVITATION_HEADER_RULE = `      // Invitation previews expose a bearer token in the URL. Next's
      // catch-all security header would otherwise overwrite the route's
      // stricter Referrer-Policy on the actual HTTP response.
      {
        source: "/api/invitations/accept",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
`;

const gitBlobSha = value => {
  const bytes = Buffer.from(value);
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
};

export function assertHistoricalNextConfigPreservedWithInvitationHeaders(bytes, expectedHistoricalSha) {
  assert.equal(expectedHistoricalSha, HISTORICAL_SOURCE_SHA,
    "Only the precise historical Next config receipt is eligible for compatibility review");
  const source = bytes.toString().replaceAll("\r\n", "\n");
  assert.equal(gitBlobSha(source), REVIEWED_SOURCE_SHA,
    "Next config drift beyond the reviewed invitation header exception requires fresh proof");
  assert.equal(source.split(INVITATION_HEADER_RULE).length, 2,
    "Exactly one scoped invitation no-referrer/no-store rule must be present");
  assert.equal(gitBlobSha(source.replace(INVITATION_HEADER_RULE, "")), expectedHistoricalSha,
    "All non-invitation Next config behavior must remain byte-identical to the executed receipt");
  return true;
}
