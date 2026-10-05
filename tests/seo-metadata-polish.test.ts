import assert from "node:assert/strict";
import test from "node:test";
import { developerDocs } from "../src/lib/developer-docs";
import { regulatoryUpdates } from "../src/lib/seo-content-wave3";

test("developer docs use concise page-specific search metadata", () => {
  for (const doc of developerDocs) {
    const title = doc.metaTitle ?? `${doc.title} | Linaw Developers`;
    const description = doc.metaDescription ?? doc.description;
    assert.ok(title.length <= 60, `${doc.slug} developer title is too long: ${title.length}`);
    assert.ok(description.length >= 135, `${doc.slug} developer description is too short: ${description.length}`);
    assert.ok(description.length <= 165, `${doc.slug} developer description is too long: ${description.length}`);
  }
});

test("regulatory updates use concise metadata without rewriting article headlines", () => {
  for (const update of regulatoryUpdates) {
    const title = update.metaTitle ?? `${update.title} | Linaw`;
    const description = update.metaDescription ?? update.summary;
    assert.ok(title.length <= 60, `${update.slug} update title is too long: ${title.length}`);
    assert.ok(description.length >= 130, `${update.slug} update description is too short: ${description.length}`);
    assert.ok(description.length <= 165, `${update.slug} update description is too long: ${description.length}`);
    assert.ok(update.title.length > 0, "article headline must remain present");
  }
});

test("dynamic developer and regulatory routes prefer dedicated metadata fields", async () => {
  const { readFile } = await import("node:fs/promises");
  const developerRoute = await readFile("src/app/developers/[slug]/page.tsx", "utf8");
  const updateRoute = await readFile("src/app/resources/updates/[slug]/page.tsx", "utf8");
  assert.ok(developerRoute.includes("doc.metaTitle ??"));
  assert.ok(developerRoute.includes("doc.metaDescription ??"));
  assert.ok(updateRoute.includes("update.metaTitle ??"));
  assert.ok(updateRoute.includes("update.metaDescription ??"));
});
