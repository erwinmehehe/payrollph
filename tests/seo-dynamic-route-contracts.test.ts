import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { DYNAMIC_SEO_ROUTE_CONTRACTS } from "../src/lib/dynamic-seo-routes";

test("dynamic SEO route contracts are unique", () => {
  const patterns = DYNAMIC_SEO_ROUTE_CONTRACTS.map((route) => route.routePattern);
  const files = DYNAMIC_SEO_ROUTE_CONTRACTS.map((route) => route.pageFile);

  assert.equal(new Set(patterns).size, patterns.length);
  assert.equal(new Set(files).size, files.length);
});

test("every dynamic SEO family has static params metadata canonical 404 handling and schema", () => {
  for (const route of DYNAMIC_SEO_ROUTE_CONTRACTS) {
    assert.ok(existsSync(route.pageFile), `${route.pageFile} must exist`);
    const source = readFileSync(route.pageFile, "utf8");

    for (const signal of [
      "generateStaticParams",
      "generateMetadata",
      "notFound()",
      "StructuredData",
      route.canonicalSignal,
      route.schemaSignal,
      ...(route.additionalSignals ?? []),
    ]) {
      assert.ok(source.includes(signal), `${route.routePattern} must include ${signal}`);
    }

    assert.match(source, /\btitle\s*:/, `${route.routePattern} must generate a title`);
    assert.match(source, /\bdescription\s*:/, `${route.routePattern} must generate a description`);

    if (!route.allowConditionalNoindex) {
      assert.doesNotMatch(
        source,
        /robots\s*:\s*\{[\s\S]{0,120}?index\s*:\s*false/,
        `${route.routePattern} must not declare noindex`,
      );
    }
  }
});

test("authority content families use the expected schema type", () => {
  const byPattern = new Map(DYNAMIC_SEO_ROUTE_CONTRACTS.map((route) => [route.routePattern, route]));

  assert.equal(byPattern.get("/resources/[slug]")?.schemaSignal, "article={{");
  assert.equal(byPattern.get("/compliance/[slug]")?.schemaSignal, "article={{");
  assert.equal(byPattern.get("/industries/[slug]")?.schemaSignal, "service={{");
  assert.equal(byPattern.get("/integrations/[slug]")?.schemaSignal, "service={{");
  assert.equal(byPattern.get("/calculators/[slug]")?.schemaSignal, "webApplication={{");
  assert.equal(byPattern.get("/glossary/[slug]")?.schemaSignal, "definedTerm={{");
  assert.equal(byPattern.get("/resources/updates/[slug]")?.schemaSignal, "article={{");
  assert.equal(byPattern.get("/developers/[slug]")?.schemaSignal, "article={{");
  assert.equal(byPattern.get("/customers/[slug]")?.schemaSignal, "article={{");
});

test("regulatory updates retain publish and review dates in Article schema", () => {
  const route = DYNAMIC_SEO_ROUTE_CONTRACTS.find((entry) => entry.routePattern === "/resources/updates/[slug]");
  assert.ok(route);
  assert.deepEqual(route.additionalSignals, ["datePublished:", "dateModified:"]);
});

test("calculator routes retain WebApplication and visible FAQ schema", () => {
  const route = DYNAMIC_SEO_ROUTE_CONTRACTS.find((entry) => entry.routePattern === "/calculators/[slug]");
  assert.ok(route);
  assert.equal(route.schemaSignal, "webApplication={{");
  assert.ok(route.additionalSignals?.includes("faq={guide.faq}"));
});

test("customer story route is the only dynamic family allowed conditional noindex", () => {
  const conditional = DYNAMIC_SEO_ROUTE_CONTRACTS.filter((route) => route.allowConditionalNoindex);
  assert.deepEqual(conditional.map((route) => route.routePattern), ["/customers/[slug]"]);

  const customer = conditional[0];
  assert.ok(customer.additionalSignals?.includes("PUBLISHABLE_CUSTOMER_STORIES"));
  assert.ok(customer.additionalSignals?.includes("robots: { index: true, follow: true }"));
  assert.ok(customer.additionalSignals?.includes("if (!story) notFound()"));
});

test("SEO launch audit consumes the dynamic route contract registry", () => {
  const audit = readFileSync("scripts/seo-launch-audit.ts", "utf8");
  assert.ok(audit.includes('import { DYNAMIC_SEO_ROUTE_CONTRACTS } from "../src/lib/dynamic-seo-routes";'));
  assert.ok(audit.includes("for (const route of DYNAMIC_SEO_ROUTE_CONTRACTS)"));
  assert.ok(audit.includes('code: "missing-dynamic-contract"'));
  assert.ok(audit.includes('code: "missing-dynamic-title"'));
  assert.ok(audit.includes('code: "missing-dynamic-description"'));
});
