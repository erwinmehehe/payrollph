import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("search engine ownership verification is environment-driven", () => {
  const layout = read("src/app/layout.tsx");
  const env = read(".env.local.example");

  assert.ok(layout.includes("GOOGLE_SITE_VERIFICATION"));
  assert.ok(layout.includes("BING_SITE_VERIFICATION"));
  assert.ok(layout.includes('"msvalidate.01"'));
  assert.ok(env.includes("GOOGLE_SITE_VERIFICATION="));
  assert.ok(env.includes("BING_SITE_VERIFICATION="));
  assert.ok(env.includes("Never commit real verification tokens."));
});

test("public evidence methodology documents claim boundaries", () => {
  const page = read("src/app/methodology/page.tsx");
  assert.ok(page.includes("How Linaw decides what it can responsibly claim."));
  assert.ok(page.includes("Payroll calculation is not government filing acceptance"));
  assert.ok(page.includes("Customer proof requires evidence and approval"));
  assert.ok(page.includes("Research results need a disclosed methodology"));
  assert.ok(!page.includes("guaranteed compliance"));
});

test("regulatory update RSS feed is generated from the canonical update registry", () => {
  const feed = read("src/app/resources/updates/feed.xml/route.ts");
  assert.ok(feed.includes("regulatoryUpdates"));
  assert.ok(feed.includes("application/rss+xml"));
  assert.ok(feed.includes("/resources/updates/"));
  assert.ok(feed.includes("absolutePublicUrl"));
});

test("llms.txt points to canonical authority and limitation surfaces", () => {
  const llms = read("src/app/llms.txt/route.ts");
  for (const route of [
    "/compliance",
    "/resources",
    "/resources/updates",
    "/glossary",
    "/calculators",
    "/trust",
    "/security",
    "/scorecard",
    "/developers",
    "/methodology",
    "/sitemap.xml",
  ]) {
    assert.ok(llms.includes(route), `llms.txt must reference ${route}`);
  }
  assert.ok(llms.includes("Payroll calculation capability is not the same as government filing acceptance."));
  assert.ok(llms.includes("do not imply certifications that have not been independently obtained."));
});

test("SEO operating SOPs exist and prevent fabricated proof", () => {
  for (const path of [
    "docs/seo-publishing-sop.md",
    "docs/customer-proof-intake.md",
    "docs/search-console-launch-checklist.md",
  ]) {
    assert.ok(existsSync(path), `${path} must exist`);
  }

  const publishing = read("docs/seo-publishing-sop.md");
  const proof = read("docs/customer-proof-intake.md");
  const launch = read("docs/search-console-launch-checklist.md");

  assert.ok(publishing.includes("Do not claim government filing acceptance"));
  assert.ok(publishing.includes("Never add fabricated AggregateRating"));
  assert.ok(proof.includes("Every number needs:"));
  assert.ok(proof.includes("Never convert an estimate into an achieved result."));
  assert.ok(launch.includes("Submit `/sitemap.xml`"));
  assert.ok(launch.includes("CI green"));
});

test("methodology is indexable and discoverable without crowding primary navigation", () => {
  const sitemap = read("src/app/sitemap.ts");
  const nav = read("src/components/marketing/public-navigation.ts");

  assert.ok(sitemap.includes('{ path: "/methodology"'));
  assert.ok(nav.includes('{ label: "Evidence methodology", href: "/methodology" }'));

  const primary = nav.slice(nav.indexOf("PUBLIC_PRIMARY_LINKS"), nav.indexOf("PUBLIC_FOOTER_GROUPS"));
  assert.ok(!primary.includes("/methodology"));
});

test("Wave 5 machine-readable endpoints do not expose secrets", () => {
  const llms = read("src/app/llms.txt/route.ts");
  const feed = read("src/app/resources/updates/feed.xml/route.ts");
  assert.ok(!llms.includes("GOOGLE_SITE_VERIFICATION"));
  assert.ok(!llms.includes("BING_SITE_VERIFICATION"));
  assert.ok(!feed.includes("GOOGLE_SITE_VERIFICATION"));
  assert.ok(!feed.includes("BING_SITE_VERIFICATION"));
});
