#!/usr/bin/env node
/** GET-only, protected main-branch attestation for two immutable QA previews. */
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { stageConfiguration, attestPreview } from "./csp-hosted-stage-contract.mjs";

const dir = "qa-artifacts/csp-hosted-stage";
await mkdir(dir,{recursive:true});
let attested = false;
try {
  const config = stageConfiguration(process.env);
  const token = process.env.CSP_STAGE_READ_TOKEN || "";
  assert.ok(token.length >= 20, "Protected read-only Vercel metadata token missing");
  const attest = [];
  for (const stage of [config.off, config.on]) {
    const endpoint = "https://api.vercel.com/v13/deployments/" +
      encodeURIComponent(stage.deploymentId) + "?teamId=" +
      encodeURIComponent(config.teamId);
    const reply = await fetch(endpoint, {
      method: "GET", redirect: "error",
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(20000),
    });
    assert.equal(reply.status, 200,
      stage.mode + ": Vercel metadata read failed HTTP " + reply.status);
    const raw = await reply.json();
    attest.push(attestPreview(raw, stage, config));
  }
  const output = {
    result:"ATTESTED_PREVIEW_ONLY", sourceSha:config.sourceSha,
    projectId:config.projectId, deploymentTargets:attest,
    verifiedAt:new Date().toISOString(), productionTouched:false,
    productionApproved:false, deploymentCreated:false,
  };
  await writeFile(dir+"/attestation.json",JSON.stringify(output,null,2)+"\n");
  attested = true;
  console.log("PASS: two distinct READY, Git-SHA-identical, immutable preview deployments in the fictional QA project.");
  console.log("PASS: neither target is production and no deployment or env setting was modified.");
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  // No URLs, tokens, response payloads, credentials or external error bodies.
  await writeFile(dir+"/attestation-blocked.json",JSON.stringify({
    result:"BLOCKED_NO_HOSTED_PROOF",reason,
    productionTouched:false,productionApproved:false,
  },null,2)+"\n");
  console.error("BLOCKED: " + reason);
  process.exitCode = 1;
}
if (!attested) process.exitCode = 1;
