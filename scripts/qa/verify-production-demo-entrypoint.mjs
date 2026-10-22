/**
 * Production demo entrypoint guard. Verify the exact approved hosted redirect
 * without following external URLs, printing response bodies, or provisioning
 * users. A local HTML demo page is only valid for an attested demo-only DB.
 *
 * This check is NOT production six-persona RBAC certification.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

export const PINNED_HOSTED_DEMO_URL = "https://payrollph-fictional-demo-qa-three.vercel.app/demo";
const LOCAL_DEMO_HEADING = "See Linaw from the seat you actually use";

// Independently pin the reviewed application destination. A source-only host
// change must deliberately update this verifier rather than silently pass.
const destinationSource = readFileSync(
  new URL("../../src/lib/hosted-demo-navigation.ts", import.meta.url), "utf8",
);
assert.match(destinationSource,
  /^export const HOSTED_DEMO_ORIGIN = "https:\/\/payrollph-fictional-demo-qa-three\.vercel\.app";$/m,
  "The application hosted-demo origin differs from the reviewed CI destination");

export function verifyProductionDemoEntrypoint({ status, responseHeaders, responseBody, boundaryMode }) {
  assert.ok(["demo_only", "blocked_non_demo_employer"].includes(boundaryMode),
    "Protected demo-provisioning boundary must be attested before the public check");
  const code = String(status);
  const locations = responseHeaders.split(/\r?\n/).filter(line => /^location:/i.test(line));

  if (code === "307" || code === "308") {
    assert.equal(locations.length, 1, "Hosted redirect must have exactly one Location");
    const location = locations[0].slice(locations[0].indexOf(":") + 1).trim();
    assert.equal(location, PINNED_HOSTED_DEMO_URL,
      "Redirect must use only the reviewed HTTPS fictional-demo origin and exact /demo path");
    return "pinned-hosted-redirect";
  }

  if (code === "200") {
    assert.equal(boundaryMode, "demo_only",
      "A production customer-scope database must redirect to the hosted fictional demo");
    assert.equal(locations.length, 0, "Local demo 200 must not also advertise a redirect");
    assert.ok(responseBody.includes(LOCAL_DEMO_HEADING),
      "Local demo success requires the genuine role-picker HTML, not an unrelated 200");
    return "attested-local-demo";
  }

  throw new Error("Production demo entrypoint did not return approved local HTML or pinned redirect");
}

if (process.argv[1] && basename(process.argv[1]) === "verify-production-demo-entrypoint.mjs") {
  try {
    assert.equal(process.argv.length, 6, "Expected status, header file, body file and protected boundary mode");
    const [status, headersPath, bodyPath, boundaryMode] = process.argv.slice(2);
    const kind = verifyProductionDemoEntrypoint({
      status,
      responseHeaders: readFileSync(headersPath, "utf8"),
      responseBody: readFileSync(bodyPath, "utf8"),
      boundaryMode,
    });
    console.log("Production demo entrypoint verified: " + kind + "; response data withheld.");
  } catch {
    // Never expose destination headers, application HTML, tokens or user data.
    console.error("::error::Production demo entrypoint is not the approved hosted redirect or attested local demo; response data withheld.");
    process.exitCode = 1;
  }
}
