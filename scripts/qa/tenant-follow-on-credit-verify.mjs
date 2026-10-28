import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Fixed, individually reviewed PR-final-head receipt and Git blob pins. This
// is a fail-closed catalogue for one six-method reconciliation, not an API
// for blanket status promotion or runtime proof of tenant safety.
export const FOLLOW_ON_MAIN = "dd890dd65f14a3a508ef5df7227fd84655c21fcd";
const CASES = [
  [
    "GET self/probation-reviews",
    1507,
    40623884094,
    "be00791a82412f08e79a1b4f6f9a497eef80729f",
    "0ecd8f2070c286151ad74259986102ff539f6435",
    "scripts/qa/tenant-self-probation-http.mjs",
    ".github/workflows/tenant-self-probation-http.yml",
    161,
    242,
    171,
    169
  ],
  [
    "POST self/probation-reviews",
    1507,
    40623884094,
    "be00791a82412f08e79a1b4f6f9a497eef80729f",
    "0ecd8f2070c286151ad74259986102ff539f6435",
    "scripts/qa/tenant-self-probation-http.mjs",
    ".github/workflows/tenant-self-probation-http.yml",
    182,
    213,
    208,
    215
  ],
  [
    "GET hcm/employment-term-decisions/[id]/manager-attestation",
    1512,
    40624278478,
    "5783f860414d0076ce837c46a37fc8e1b10f5907",
    "5de82dc98b5fa336b7ec4f8051bc7e66bf3c167c",
    "scripts/qa/tenant-hcm-manager-attestation-recovery-http.mjs",
    ".github/workflows/tenant-hcm-manager-attestation-recovery.yml",
    179,
    199,
    239,
    212
  ],
  [
    "GET self/performance",
    1513,
    40620797757,
    "328d1a3fd1371bfba9694a3933cdc38aab3f4dee",
    "b85a8c7cbc40512c3d77da503c744ac7eb5748dd",
    "scripts/qa/tenant-self-performance-http.mjs",
    ".github/workflows/tenant-self-performance-http.yml",
    205,
    362,
    225,
    215
  ],
  [
    "POST self/performance",
    1513,
    40620797757,
    "328d1a3fd1371bfba9694a3933cdc38aab3f4dee",
    "b85a8c7cbc40512c3d77da503c744ac7eb5748dd",
    "scripts/qa/tenant-self-performance-http.mjs",
    ".github/workflows/tenant-self-performance-http.yml",
    236,
    330,
    320,
    238
  ],
  [
    "PATCH self/performance",
    1513,
    40620797757,
    "328d1a3fd1371bfba9694a3933cdc38aab3f4dee",
    "b85a8c7cbc40512c3d77da503c744ac7eb5748dd",
    "scripts/qa/tenant-self-performance-http.mjs",
    ".github/workflows/tenant-self-performance-http.yml",
    269,
    335,
    320,
    274
  ]
];

/**
 * Review the literal network destinations in each proof workflow by parsing
 * full URLs. A substring check cannot distinguish a provider's hostname from
 * an attacker-controlled lookalike or a URL embedded inside another URL.
 * The tested workflows only need disposable loopback HTTP, never providers.
 */
export function assertWorkflowUsesOnlyLoopbackUrls(workflowText) {
  assert.equal(typeof workflowText, "string", "workflow source is required");
  const literalUrls = workflowText.match(/https?:\\/\\/[^\\s"'<>\\\\]+/gi) ?? [];
  for (const literal of literalUrls) {
    let url;
    try { url = new URL(literal); }
    catch { assert.fail("invalid literal HTTP endpoint in proof workflow"); }
    assert.equal(url.protocol, "http:", "proof workflow cannot call an external HTTPS endpoint");
    assert.equal(url.hostname, "127.0.0.1",
      "proof workflow literal endpoint must use only the disposable loopback host");
    assert.equal(url.username, "", "proof workflow endpoint must never carry credentials");
    assert.equal(url.password, "", "proof workflow endpoint must never carry credentials");
  }
}

function blobSha(text) {
  const bytes = Buffer.from(text, "utf8");
  return createHash("sha1").update("blob " + bytes.length + "\0")
    .update(bytes).digest("hex");
}

export function verifyFollowOnCredits(manifest, read = path => readFileSync(path, "utf8")) {
  const keys = CASES.map(row => row[0]).sort();
  const all = Object.values(manifest.allApiRouteFiles).flatMap(route =>
    route.methods.map(method => ({ key: method.name + " " + route.route, method })));
  const credited = all.filter(row =>
    row.method.testedBy?.verifiedMainCommit === FOLLOW_ON_MAIN);
  assert.deepEqual(credited.map(row => row.key).sort(), keys,
    "six-review credit base must never be reused by an extra method");

  const checkedFiles = new Map();
  const checkSource = (file, expected) => {
    if (!checkedFiles.has(file)) {
      const text = read(file);
      assert.equal(blobSha(text), expected, "source blob drift: " + file);
      checkedFiles.set(file, text);
    }
    return checkedFiles.get(file);
  };

  for (const [key, pr, run, proofBlob, routeBlob, file, workflow,
    positive, denial, unchanged, forged] of CASES) {
    const split = key.indexOf(" "), verb = key.slice(0, split), route = key.slice(split + 1);
    const routeFile = "src/app/api/" + route + "/route.ts";
    const entry = manifest.allApiRouteFiles[routeFile];
    assert.ok(entry && entry.route === route, key + ": unexpected API route");
    assert.equal(entry.gitBlobSha, routeBlob, key + ": reviewed handler changed");
    checkSource(routeFile, routeBlob);
    const matching = entry.methods.filter(method => method.name === verb);
    assert.equal(matching.length, 1, key + ": duplicate or missing handler");
    const method = matching[0];
    assert.equal(method.status, "COVERED", key + ": method is not credited");
    const receipt = method.testedBy;
    assert.ok(receipt, key + ": missing evidence");
    for (const [field, expected] of Object.entries({
      file, line: positive, ownPositiveLine: positive, foreignDenialLine: denial,
      unchangedDbLine: unchanged, forgedSelectorLine: forged, prNumber: pr,
      workflowRunId: run, routeBlobSha: routeBlob, proofBlobSha: proofBlob,
      verifiedMainCommit: FOLLOW_ON_MAIN, postgresMajor: 16,
    })) assert.equal(receipt[field], expected, key + ": unsupported " + field);
    assert.match(receipt.evidence,
      new RegExp("^https://github\\.com/erwinmehehe/payrollph/actions/runs/" + run + "(?:\\D|$)"),
      key + ": incorrect exact-head workflow receipt");

    const source = checkSource(file, proofBlob);
    const lines = source.split("\n");
    for (const [label, at] of Object.entries({
      ownPositiveLine: positive, foreignDenialLine: denial,
      unchangedDbLine: unchanged, forgedSelectorLine: forged,
    })) {
      assert.ok(Number.isInteger(at) && at > 0 && at <= lines.length &&
        lines[at - 1].trim(), key + ": invalid " + label);
    }
    const scriptName = file.split("/").at(-1);
    const suite = read(workflow);
    assert.match(suite, /image: postgres:16/, key + ": real disposable PG16 required");
    assert.ok(suite.includes("node --import tsx " + file),
      key + ": workflow must run the exact proof, not only source tests");
    assert.match(suite, /127\.0\.0\.1/,
      key + ": proof must use localhost, never production");
    assertWorkflowUsesOnlyLoopbackUrls(suite);
    assert.ok(source.includes("VICTIM") && source.includes("ATTA") &&
      source.includes("ATTB"), key + ": real independent employer fixtures required");
    assert.ok(scriptName.endsWith("-http.mjs"), key + ": source must be HTTP proof");
  }
  const post = manifest.allApiRouteFiles[
    "src/app/api/hcm/employment-term-decisions/[id]/manager-attestation/route.ts"
  ].methods.find(method => method.name === "POST");
  assert.equal(post?.status, "GAP", "unproved manager-attestation POST remains a gap");
  assert.equal(post?.testedBy, null, "read proof must never certify manager-attestation POST");
  return CASES.length;
}
