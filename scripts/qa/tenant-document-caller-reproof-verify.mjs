import {verifyNarrowStudioAutomationSource,HISTORIC_AUTOMATION_SHA} from './tenant-studio-automation-source-compat.mjs';
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  OLD_HCM_SHA as HCM_OLD_SHA, CURRENT_HCM_SHA as HCM_NEW_SHA, HCM_ROUTE,
  verifyCurrentHcmCallerReproof,
} from "./tenant-hcm-lifecycle-caller-source-refresh-verify.mjs";
import { assertHistoricalNextConfigPreservedWithInvitationHeaders } from "./tenant-invitation-header-source-compat.mjs";
import { HCM_QUEUE_PAGE, verifyHcmQueuePageSourceCompatibility } from "./tenant-work-queue-page-source-compat.mjs";

const RECEIPT = "scripts/qa/tenant-document-caller-reproof-receipt.json";
const DIGEST = "aee9a88d62b4fa68efd1ab61eb66343218a77532467a9cc28654f19bb833d91e";

function blob(raw) {
  const data = Buffer.from(String(raw).replaceAll("\r\n", "\n"));
  return createHash("sha1").update("blob " + data.length + "\0").update(data).digest("hex");
}

/**
 * Keep the historical 208-input receipt byte-for-byte intact. Its permitted
 * HCM route refresh is tied to a separately executed source-pinned PG16 job.
 * The newer HR Work Queue SSR/client split is an ADDITIONAL, explicitly pinned
 * zero-credit candidate: it does not retroactively re-execute the historical
 * caller proof or grant independent security acceptance. Every other original
 * transitive input remains pinned, and a later source change fails closed.
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
  let reviewedUncreditedPageCount = 0;
  let reviewedStudioScopeCount = 0;
  for (const [file, pinned] of Object.entries(receipt.pins)) {
    if (file === "next.config.ts") {
      assertHistoricalNextConfigPreservedWithInvitationHeaders(read(file, "utf8"), pinned);
      continue;
    }
    const current = blob(read(file, "utf8"));
    if (file === HCM_ROUTE && current !== pinned) {
      assert.equal(pinned, HCM_OLD_SHA, "Historical HCM route original blob changed");
      assert.equal(current, HCM_NEW_SHA, "Unreviewed new HCM route has no source-current proof");
      verifyCurrentHcmCallerReproof(read);
      changedRouteCount++;
    } else if (file === 'src/lib/automation.ts' && current !== pinned) {
      assert.equal(pinned,HISTORIC_AUTOMATION_SHA,'Original caller source seal changed');
      const compatibility=verifyNarrowStudioAutomationSource(read);
      assert.deepEqual(compatibility,{kind:'exact-narrowing-with-disposable-evidence',newCredits:0,independentAcceptance:false});
      reviewedStudioScopeCount++;
    } else if (file === HCM_QUEUE_PAGE && current !== pinned) {
      // The old receipt stays historical. A source-exact, uncredited exception
      // must not be interpreted as prior execution of the new server wrapper.
      const reviewed = verifyHcmQueuePageSourceCompatibility(pinned, current, read);
      assert.deepEqual(reviewed, {
        credits: 0, independentlyAccepted: false, productionCertified: false,
      });
      reviewedUncreditedPageCount++;
    } else {
      assert.equal(current, pinned, "Executed caller input changed: " + file);
    }
  }
  assert.ok(changedRouteCount <= 1, "Only one HCM route source is eligible for replacement");
  assert.ok(reviewedStudioScopeCount <= 1, "Only exact narrowed Studio recovery scope may differ");
  assert.ok(reviewedUncreditedPageCount <= 1, "Only the explicitly pinned uncredited HR queue page may differ");
  return receipt;
}
