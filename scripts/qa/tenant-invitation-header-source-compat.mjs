/**
 * Proof compatibility for two exact, non-overlapping response-header rules:
 * the already reviewed invitation rule and the employer-scoped private
 * Readiness cache directive, proved by the synthetic browser sweep on
 * https://github.com/erwinmehehe/payrollph/actions/runs/43188061473.
 * This does not reprove any API method, alter the sealed historical receipt,
 * or earn any tenant-isolation coverage credit. Every byte outside those
 * exact header blocks must match the executed PG16 receipt.
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


const REVIEWED_READINESS_SOURCE_SHA = "3e79ee0460883938173d31349a6b62146e97fdcf";
// Exact reviewed addition, never a wildcard or dynamic cache-header allowlist.
const READINESS_HEADER_RULE = `      // Next headers() overrides the route's private response policy on the
      // actual wire. Employer-specific readiness includes employee/payroll
      // counts and must remain private even for blocked-launch evidence.
      {
        source: "/api/readiness/workspace",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
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
  assert.equal(gitBlobSha(source), REVIEWED_READINESS_SOURCE_SHA,
    "Next config drift beyond two exact reviewed private-header exceptions requires fresh proof");
  assert.equal(source.split(READINESS_HEADER_RULE).length, 2,
    "Exactly one scoped employer Readiness private/no-store header rule must be present");
  const reviewedInvitationSource = source.replace(READINESS_HEADER_RULE, "");
  assert.equal(gitBlobSha(reviewedInvitationSource), REVIEWED_SOURCE_SHA,
    "All non-Readiness Next config behavior must match the previously reviewed source");
  assert.equal(reviewedInvitationSource.split(INVITATION_HEADER_RULE).length, 2,
    "Exactly one scoped invitation no-referrer/no-store rule must be present");
  assert.equal(gitBlobSha(reviewedInvitationSource.replace(INVITATION_HEADER_RULE, "")), expectedHistoricalSha,
    "All non-invitation, non-Readiness Next config behavior must remain byte-identical to the executed receipt");
  return true;
}
