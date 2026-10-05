import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  SEO_INTENT_OWNERS,
  duplicateSeoIntentOwners,
} from "../src/lib/seo-intent-ownership";

const read = (path: string) => readFileSync(path, "utf8");

const expectedOwners: Record<string, string> = {
  "/calculators": "payroll calculators philippines",
  "/compare": "payroll software comparisons philippines",
  "/industries": "payroll software industries philippines",
  "/methodology": "linaw payroll evidence methodology",
  "/payroll-health-check": "payroll health check philippines",
  "/resources": "payroll guides philippines",
  "/resources/updates": "philippine payroll regulatory updates",
  "/scorecard": "linaw payroll capability scorecard",
  "/small-business-payroll": "small business payroll software philippines",
  "/templates/payroll-rfp-checklist": "payroll software rfp checklist template philippines",
  "/templates/payroll-security-checklist": "payroll software security checklist template philippines",
};

test("strategic public hubs have explicit intent ownership", () => {
  for (const [path, primaryIntent] of Object.entries(expectedOwners)) {
    const owner = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === path);
    assert.equal(owner?.primaryIntent, primaryIntent, `${path} should own ${primaryIntent}`);
  }
});

test("hub intent additions do not create duplicate primary/supporting ownership", () => {
  assert.deepEqual(duplicateSeoIntentOwners(), []);
});

test("regulatory update archive and compliance methodology own distinct intent", () => {
  const archive = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/updates");
  const process = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/compliance/regulatory-updates");

  assert.equal(archive?.primaryIntent, "philippine payroll regulatory updates");
  assert.equal(process?.primaryIntent, "payroll regulatory update process philippines");
  assert.notEqual(archive?.primaryIntent, process?.primaryIntent);
});

test("RFP guide and interactive template own distinct intent and titles", () => {
  const guideOwner = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/payroll-rfp-checklist");
  const templateOwner = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/templates/payroll-rfp-checklist");
  const guide = read("src/lib/seo-content-wave2.ts");
  const template = read("src/app/templates/payroll-rfp-checklist/page.tsx");

  assert.equal(guideOwner?.primaryIntent, "payroll rfp checklist guide philippines");
  assert.equal(templateOwner?.primaryIntent, "payroll software rfp checklist template philippines");
  assert.ok(guide.includes('metaTitle: "Payroll RFP Checklist Guide Philippines | Linaw"'));
  assert.ok(template.includes('title: "Payroll Software RFP Checklist Template Philippines | Linaw"'));
});

test("security checklist guide and interactive template own distinct intent and titles", () => {
  const guideOwner = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/payroll-security-checklist");
  const templateOwner = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/templates/payroll-security-checklist");
  const guide = read("src/lib/seo-content.ts");
  const template = read("src/app/templates/payroll-security-checklist/page.tsx");

  assert.equal(guideOwner?.primaryIntent, "payroll security checklist guide philippines");
  assert.equal(templateOwner?.primaryIntent, "payroll software security checklist template philippines");
  assert.ok(guide.includes('metaTitle: "Payroll Security Checklist Guide Philippines | Linaw"'));
  assert.ok(template.includes('title: "Payroll Software Security Checklist Template Philippines | Linaw"'));
});

test("regulatory archive title visibly distinguishes archive from process page", () => {
  const archive = read("src/app/resources/updates/page.tsx");
  const process = read("src/lib/seo-content-wave3.ts");

  assert.ok(archive.includes('title: "Philippine Payroll Regulatory Updates Archive | Linaw"'));
  assert.ok(process.includes('metaTitle: "Payroll Regulatory Update Process Philippines | Linaw"'));
});

test("customer hub remains outside intent ownership until approved proof makes it indexable", () => {
  const customerOwner = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/customers");
  const page = read("src/app/customers/page.tsx");

  assert.equal(customerOwner, undefined);
  assert.ok(page.includes("approvedStories.length > 0"));
  assert.ok(page.includes("{ index: false, follow: true }"));
});


test("all currently indexable sitemap children have explicit intent ownership", () => {
  const requiredPaths = [
    "/calculators/daily-rate",
    "/calculators/hourly-rate",
    "/calculators/payroll-outsourcing-roi",
    "/developers/authentication",
    "/developers/employees",
    "/developers/payroll-runs",
    "/developers/webhooks",
    "/glossary/basic-salary",
    "/glossary/gross-pay",
    "/glossary/net-pay",
    "/glossary/taxable-compensation",
    "/glossary/payroll-cutoff",
    "/glossary/night-differential",
    "/glossary/premium-pay",
    "/glossary/rest-day",
    "/glossary/withholding-tax",
    "/glossary/monthly-salary-credit",
    "/glossary/13th-month-pay",
    "/glossary/annualization",
    "/resources/updates/dole-final-pay-reminder-2026",
    "/resources/updates/dole-13th-month-guidelines-2025",
    "/resources/updates/bir-alphalist-reminder-2026",
  ];

  for (const path of requiredPaths) {
    assert.ok(
      SEO_INTENT_OWNERS.some((entry) => entry.ownerPath === path),
      `${path} must have explicit SEO intent ownership`,
    );
  }
});
