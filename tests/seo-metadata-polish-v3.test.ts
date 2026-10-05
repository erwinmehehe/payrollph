import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { developerDocs } from "../src/lib/developer-docs";

const read = (path: string) => readFileSync(path, "utf8");

test("developer docs use concise page-specific search metadata", () => {
  for (const doc of developerDocs) {
    const title = doc.metaTitle ?? `${doc.title} | Linaw Developers`;
    const description = doc.metaDescription ?? doc.description;
    assert.ok(title.length <= 60, `${doc.slug} developer title is too long: ${title.length}`);
    assert.ok(description.length >= 135, `${doc.slug} developer description is too short: ${description.length}`);
    assert.ok(description.length <= 165, `${doc.slug} developer description is too long: ${description.length}`);
  }
});

test("dynamic developer route prefers dedicated metadata fields", () => {
  const route = read("src/app/developers/[slug]/page.tsx");
  assert.ok(route.includes("doc.metaTitle ??"));
  assert.ok(route.includes("doc.metaDescription ??"));
});

test("regulatory update route prefers existing dedicated metadata fields", () => {
  const route = read("src/app/resources/updates/[slug]/page.tsx");
  const data = read("src/lib/seo-content-wave3.ts");
  assert.ok(route.includes("update.metaTitle ??"));
  assert.ok(route.includes("update.metaDescription ??"));
  assert.ok(data.includes("metaTitle?: string"));
  assert.ok(data.includes("metaDescription?: string"));
});
