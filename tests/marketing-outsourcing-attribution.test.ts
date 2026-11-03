import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sanitizeMarketingAttribution } from "../src/lib/marketing-attribution";

test("payroll outsourcing quote form includes first-touch marketing attribution", () => {
  const form = readFileSync("src/components/marketing/payroll-quote-form.tsx", "utf8");
  assert.ok(form.includes('import { readMarketingAttribution } from "@/lib/marketing-attribution-client"'));
  assert.ok(form.includes("attribution: readMarketingAttribution()"),
    "the quote request must send first-touch and conversion attribution");
});

test("payroll outsourcing API sanitizes and saves attribution with consent evidence", () => {
  const route = readFileSync("src/app/api/payroll-outsourcing/quote/route.ts", "utf8");
  assert.ok(route.includes('import { sanitizeMarketingAttribution } from "@/lib/marketing-attribution"'));
  assert.ok(route.includes("...sanitizeMarketingAttribution(body.attribution)"),
    "the server must sanitize caller-supplied attribution");
  assert.ok(route.includes("...marketingConsentEvidence()"),
    "server-stamped consent evidence must remain intact");
  assert.ok(route.includes("      attribution,"),
    "the combined attribution must be included in the persisted lead");
  assert.ok(!route.includes("attribution: marketingConsentEvidence(),"),
    "consent evidence alone drops the lead-source information");

  const cleaned = sanitizeMarketingAttribution({
    landingPath: "/payroll-outsourcing?utm_source=search",
    conversionPath: "/payroll-outsourcing#quote",
    referrer: "https://example.test/search?q=payroll",
    utmSource: "Search Ads",
    utmMedium: "cpc",
    utmCampaign: "outsourcing",
  });
  assert.equal(cleaned.landingPath, "/payroll-outsourcing");
  assert.equal(cleaned.conversionPath, "/payroll-outsourcing");
  assert.equal(cleaned.referrer, "https://example.test/search");
  assert.equal(cleaned.utmSource, "Search Ads");
  assert.equal(cleaned.utmMedium, "cpc");
  assert.equal(cleaned.utmCampaign, "outsourcing");
});
