import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { hasMarketingEnquiryConsent, marketingConsentEvidence, marketingHoneypotTripped } from "../src/lib/marketing-consent";

const read = (path: string) => readFileSync(path, "utf8");

test("public enquiries require affirmative boolean consent", () => {
  for (const input of [null, {}, { privacyConsent: false }, { privacyConsent: "true" }, { privacyConsent: 1 }]) {
    assert.equal(hasMarketingEnquiryConsent(input), false);
  }
  assert.equal(hasMarketingEnquiryConsent({ privacyConsent: true }), true);
});

test("honeypot traps filled values but accepts a missing or empty field", () => {
  assert.equal(marketingHoneypotTripped({}), false);
  assert.equal(marketingHoneypotTripped({ website: "" }), false);
  assert.equal(marketingHoneypotTripped({ website: " https://spam.example " }), true);
});

test("consent timestamp and notice version are stamped on the server", () => {
  const time = new Date("2026-10-10T13:00:00.000Z");
  assert.deepEqual(marketingConsentEvidence(time), {
    privacyConsentVersion: "2026-10-10",
    privacyConsentAt: time.toISOString(),
    privacyConsentPurpose: "requested-enquiry-follow-up",
  });
});

test("all public enquiry forms require the same consent fields", () => {
  for (const path of ["src/components/marketing/access-request-form.tsx", "src/components/marketing/book-demo-form.tsx", "src/components/marketing/payroll-quote-form.tsx"]) {
    const s = read(path);
    for (const part of ["PrivacyConsentFields", "privacyConsent", "website"]) assert.ok(s.includes(part), path + ": " + part);
  }
});

test("both intake routes reject missing consent, silently block bots and rate limit per identity", () => {
  for (const path of ["src/app/api/demo-requests/route.ts", "src/app/api/payroll-outsourcing/quote/route.ts"]) {
    const s = read(path);
    assert.ok(s.indexOf("marketingHoneypotTripped(body)") < s.indexOf("recordMarketingLead({"), path);
    for (const part of ["hasMarketingEnquiryConsent(body)", "marketingConsentEvidence()", "public-enquiry-email:", "public-enquiry-domain:"])
      assert.ok(s.includes(part), path + ": " + part);
  }
});

test("public notice and footer are discoverable with existing 365-day lead retention", () => {
  assert.ok(read("src/app/privacy/page.tsx").includes("Privacy notice"));
  assert.ok(read("src/components/marketing/site-chrome.tsx").includes('href="/privacy"'));
  assert.ok(read("src/components/marketing/public-navigation.ts").includes('href: "/privacy"'));
  assert.ok(read("src/lib/data-retention.ts").includes("retentionDaysAfterLastUpdate: 365"));
});
