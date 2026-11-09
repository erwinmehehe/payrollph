import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  OLD_HCM_SHA as HCM_OLD_SHA, CURRENT_HCM_SHA as HCM_NEW_SHA, HCM_ROUTE,
  verifyCurrentHcmCallerReproof,
} from "./tenant-hcm-lifecycle-caller-source-refresh-verify.mjs";

const RECEIPT = "scripts/qa/tenant-document-caller-reproof-receipt.json";
const DIGEST = "aee9a88d62b4fa68efd1ab61eb66343218a77532467a9cc28654f19bb833d91e";

function blob(raw) {
  const data = Buffer.from(String(raw).replaceAll("\r\n", "\n"));
  return createHash("sha1").update("blob " + data.length + "\0").update(data).digest("hex");
}

/**
 * Preserve historical 208-input receipt byte for byte. Exactly one changed
 * route may be admitted ONLY by a separately executed, source-pinned PG16
 * two-attacker + audit-veto + original-caller proof. All other 207 transitive
 * inputs remain pinned to the original successful historical execution.
 */
export function verifyDocumentCallerReproof(reference, read = readFileSync) {
  const raw = read(RECEIPT, "utf8");
  assert.equal(createHash("sha256").update(raw).digest("hex"), DIGEST,
    "Historical executed caller receipt changed");
  const receipt = JSON.parse(raw);
  assert.deepEqual(reference,
    { receiptFile: RECEIPT, head: receipt.head, run: receipt.run, job: receipt.job, credits: 0 });
  assert.equal(receipt.label, "SOLO_VERIFIED_DEV_RECOVERY");
  assert.equal(receipt.head, "2d239ffa212a92205476083a1e9d960fd8be46a3");
  assert.equal(receipt.run, 42434366023);
  assert.equal(receipt.job, 128589939228);
  assert.equal(receipt.credits, 0);

  let changedRouteCount = 0;
  for (const [file, pinned] of Object.entries(receipt.pins)) {
    const current = blob(read(file, "utf8"));
    if (file === HCM_ROUTE && current !== pinned) {
      assert.equal(pinned, HCM_OLD_SHA, "Historical HCM route original blob changed");
      assert.equal(current, HCM_NEW_SHA, "Unreviewed new HCM route has no source-current proof");
      verifyCurrentHcmCallerReproof(read);
      changedRouteCount++;
    } else {
      assert.equal(current, pinned, "Executed caller input changed: " + file);
    }
  }
  assert.ok(changedRouteCount <= 1, "Only one HCM route source is eligible for replacement");
  return receipt;
}
