import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { sanitizeMarketingAttribution } from "../src/lib/marketing-attribution";

const read = (path: string) => readFileSync(path, "utf8");

test("marketing attribution strips referrer query strings and arbitrary landing queries", () => {
  const result = sanitizeMarketingAttribution({
    landingPath: "https://payroll.ph/resources/payroll-guide?utm_source=google&secret=1",
    conversionPath: "/trial?from=pricing",
    referrer: "https://www.google.com/search?q=employee+payroll&client=safari",
    utmSource: "google",
    utmMedium: "organic",
    utmCampaign: "payroll-software",
    utmContent: "guide-cta",
    utmTerm: "payroll software philippines",
  });

  assert.equal(result.landingPath, "/resources/payroll-guide");
  assert.equal(result.conversionPath, "/trial");
  assert.equal(result.referrer, "https://www.google.com/search");
  assert.equal(result.utmSource, "google");
  assert.equal(result.utmMedium, "organic");
});

test("marketing attribution bounds untrusted values", () => {
  const result = sanitizeMarketingAttribution({
    landingPath: "/" + "a".repeat(1000),
    conversionPath: "/" + "b".repeat(1000),
    referrer: "not-a-url",
    utmSource: "s".repeat(500),
    utmCampaign: "c".repeat(500),
  });

  assert.ok(result.landingPath.length <= 300);
  assert.ok(result.conversionPath.length <= 300);
  assert.equal(result.referrer, "");
  assert.equal(result.utmSource.length, 120);
  assert.equal(result.utmCampaign.length, 160);
});

test("first-touch attribution is session scoped and cookie-free", () => {
  const client = read("src/lib/marketing-attribution-client.ts");
  assert.ok(client.includes("sessionStorage"));
  assert.ok(client.includes("linaw:first-touch:v1"));
  assert.ok(client.includes("document.referrer"));
  assert.ok(!client.includes("localStorage"));
  assert.ok(!client.includes("document.cookie"));
  assert.ok(!client.includes("Cookie"));
});

test("root layout captures attribution once per browser session", () => {
  const layout = read("src/app/layout.tsx");
  const capture = read("src/components/marketing/marketing-attribution-capture.tsx");
  assert.ok(layout.includes("<MarketingAttributionCapture />"));
  assert.ok(capture.includes("captureFirstTouchAttribution"));
  assert.ok(capture.includes("useEffect"));
});

test("trial and demo forms submit request type plus attribution", () => {
  const trial = read("src/components/marketing/access-request-form.tsx");
  const demo = read("src/components/marketing/book-demo-form.tsx");

  assert.ok(trial.includes('requestType: "trial-access"'));
  assert.ok(demo.includes('requestType: "demo"'));
  assert.ok(trial.includes("attribution: readMarketingAttribution()"));
  assert.ok(demo.includes("attribution: readMarketingAttribution()"));
});

test("demo request endpoint sanitizes attribution and durably records the lead before notification", () => {
  const route = read("src/app/api/demo-requests/route.ts");
  const storage = read("src/lib/marketing-leads.ts");
  assert.ok(route.includes("sanitizeMarketingAttribution(body.attribution)"));
  assert.ok(route.includes("recordMarketingLead({"));
  assert.ok(route.includes("attribution,"));
  assert.ok(route.includes('sourcePath: requestType === "trial-access" ? "/signup" : "/book-demo"'));
  assert.ok(route.indexOf("notifyMarketingLead(lead.id)") > route.indexOf("recordMarketingLead({"));
  assert.ok(storage.includes("attribution jsonb"));
  assert.ok(storage.includes("metadata: {"));
});

test("request type changes durable lead kind and notification labeling without creating a public mail target", () => {
  const route = read("src/app/api/demo-requests/route.ts");
  const storage = read("src/lib/marketing-leads.ts");
  assert.ok(route.includes('body.requestType === "trial-access" || body.requestType === "trial"'));
  assert.ok(route.includes('? "trial-access"'));
  assert.ok(storage.includes('lead.kind === "trial-access"'));
  assert.ok(storage.includes("Trial access request:"));
  assert.ok(storage.includes("DEMO_REQUEST_INBOX"));
  assert.ok(!route.includes("body.recipient"));
});
