/**
 * Source-current, zero-credit HR Work Queue page refactor exception.
 *
 * The historical PG16 caller receipt remains pinned and historical.
 * This guard recognizes only the exact reviewed server/client split while
 * requiring new exact-head browser and HTTP execution before acceptance.
 * It never makes an old proof a proof of the new page.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const HCM_QUEUE_PAGE = "src/app/hcm/work-items/page.tsx";
export const HCM_QUEUE_HISTORICAL_PAGE_SHA = "5b777c882742b95829504fdb96c383b8f80ad30a";
export const HCM_QUEUE_CURRENT_PAGE_SHA = "1452c03d1a89fe599dda1c8b72edcfcaf67d75ef";

export const CURRENT_QUEUE_INPUTS = Object.freeze({
  [HCM_QUEUE_PAGE]: HCM_QUEUE_CURRENT_PAGE_SHA,
  "src/components/hcm-work-queue.tsx": "dfeb1c3ba76cdd027dab18494acc99e5343a7408",
  "src/lib/hcm-work-items-page-tenancy.ts": "a7ea8e1177a18d3227e167d2e7a060aa637f8413",
  "tests/hcm-work-items-page-isolation.test.ts": "46799851610501ec356aecd2c7aa3b65b2457257",
  "tests/fixtures/hcm-request-lifecycle.jsx": "097724cfb0eb47b763c9ec4f880bcd509afa6262",
  "scripts/hcm-request-lifecycle-browser.mjs": "4e76f4cb405a3c2e9b6d250b5f96518f443558ea",
});

function blob(raw) {
  const bytes = Buffer.from(String(raw).replaceAll("\r\n", "\n"));
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}

export function verifyHcmQueuePageSourceCompatibility(historicalPin, currentSha, read = readFileSync) {
  assert.equal(historicalPin, HCM_QUEUE_HISTORICAL_PAGE_SHA,
    "Historical executed page input pin must never be rewritten");
  assert.equal(currentSha, HCM_QUEUE_CURRENT_PAGE_SHA,
    "Unreviewed HCM queue page changes require renewed proof");
  for (const [path, pinned] of Object.entries(CURRENT_QUEUE_INPUTS)) {
    assert.equal(blob(read(path, "utf8")), pinned,
      "Current HR Work Queue candidate source drifted: " + path);
  }

  const serverPage = read(HCM_QUEUE_PAGE, "utf8");
  assert.match(serverPage, /await assertOrganizationRole\(user\.id, organizationId, PEOPLE_ADMIN_ROLES\)/);
  assert.match(serverPage, /if \(!access\?\.companyWide\) notFound\(\)/);
  assert.match(serverPage, /authorizedOrganizationId=\{organizationId\}/);
  const client = read("src/components/hcm-work-queue.tsx", "utf8");
  assert.match(client, /const organizationId = String\(authorizedOrganizationId\)/);
  assert.doesNotMatch(client, /setOrganizationId|window\.location/);
  return { credits: 0, independentlyAccepted: false, productionCertified: false };
}
