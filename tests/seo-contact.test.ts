import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { SEO_INTENT_OWNERS } from "../src/lib/seo-intent-ownership";
import { pagesSitemapEntries } from "../src/lib/sitemap-data";

const read = (path: string) => readFileSync(path, "utf8");

test("contact page owns branded contact intent", () => {
  const owner = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/contact");
  assert.equal(owner?.primaryIntent, "contact linaw payrollph");
  assert.equal(owner?.intentClass, "conversion");
});

test("contact page is discoverable and self-canonical", () => {
  const page = read("src/app/contact/page.tsx");
  const paths = new Set(pagesSitemapEntries.map((entry) => entry.path));

  assert.ok(paths.has("/contact"));
  assert.ok(page.includes('alternates: { canonical: "/contact" }'));
  assert.ok(page.includes("Contact Linaw | Payroll Software Philippines"));
  assert.ok(page.includes('name: "Contact Linaw", path: "/contact"'));
});

test("contact page routes to implemented public workflows", () => {
  const page = read("src/app/contact/page.tsx");
  for (const route of ["/book-demo", "/trial", "/trust", "/developers", "/login"]) {
    assert.ok(page.includes(`href: "${route}"`) || page.includes(`href="${route}"`), `missing contact path ${route}`);
  }
});

test("contact page does not invent phone, office, or support email details", () => {
  const page = read("src/app/contact/page.tsx");
  assert.doesNotMatch(page, /\+63[\s()-]*\d{3}|\d{2}\s+[^<]+Street/);
  assert.ok(!page.includes("tel:"));
  assert.ok(!page.includes("mailto:"));
});

test("contact form keeps sensitive payroll data in the signed-in workspace", () => {
  const page = read("src/app/contact/page.tsx");
  const form = read("src/components/marketing/book-demo-form.tsx");
  assert.ok(page.includes('<BookDemoForm variant="contact"'));
  assert.ok(form.includes("company-level brief"));
  assert.ok(form.includes("Employee records, bank details, and payroll files"));
  assert.ok(form.includes("signed-in workspace"));
});

test("public footer links to Contact Linaw", () => {
  const nav = read("src/components/marketing/public-navigation.ts");
  assert.ok(nav.includes('{ label: "Contact Linaw", href: "/contact" }'));
});
