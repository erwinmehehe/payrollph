import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("customer proof registry stays empty until approved evidence exists", () => {
  const stories = read("src/lib/customer-stories.ts");
  assert.ok(stories.includes("CUSTOMER_STORIES: CustomerStory[] = []"));
  assert.ok(stories.includes("Keep this empty rather than manufacturing social proof."));
});

test("customers hub stays noindex while the approved collection is empty", () => {
  const page = read("src/app/customers/page.tsx");
  assert.ok(page.includes("const approvedStories = CUSTOMER_STORIES.filter((story) => story.approved)"));
  assert.ok(page.includes("{ index: false, follow: true }"));
  assert.ok(page.includes("No public customer stories yet."));
  assert.ok(page.includes("invented percentages"));
});

test("customer story routes expose only approved stories", () => {
  const page = read("src/app/customers/[slug]/page.tsx");
  assert.ok(page.includes("const approvedStories = CUSTOMER_STORIES.filter((story) => story.approved)"));
  assert.ok(page.includes("generateStaticParams"));
  assert.ok(page.includes("if (!story) notFound()"));
  assert.ok(page.includes("story.quote?.approved"));
  assert.ok(page.includes("metric.evidenceNote") === false, "evidence notes should support publication controls, not be exposed as public copy");
});

test("customer stories use article and breadcrumb schema without review fabrication", () => {
  const page = read("src/app/customers/[slug]/page.tsx");
  assert.ok(page.includes("breadcrumbs={["));
  assert.ok(page.includes("article={{"));
  assert.ok(!page.includes("AggregateRating"));
  assert.ok(!page.includes('"@type": "Review"'));
  assert.ok(!page.includes("reviewRating"));
});

test("customer URLs enter XML sitemap only after approval", () => {
  const sitemap = read("src/lib/sitemap-data.ts");
  assert.ok(sitemap.includes("CUSTOMER_STORIES.filter((story) => story.approved)"));
  assert.ok(sitemap.includes("if (approvedStories.length === 0) return []"));
  assert.ok(sitemap.includes('path: `/customers/${slug}`'));
});

test("customer stories do not leak unapproved quotes or invent metrics", () => {
  const page = read("src/app/customers/[slug]/page.tsx");
  const contract = read("src/lib/customer-stories.ts");
  assert.ok(page.includes("story.quote?.approved ? story.quote : undefined"));
  assert.ok(page.includes("story.metrics.map"));
  assert.ok(contract.includes("metric verification"));
  assert.ok(!page.includes("best customer"));
  assert.ok(!page.includes("guaranteed"));
});
