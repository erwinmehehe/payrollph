import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { SEO_INTENT_OWNERS, normalizeSeoIntent } from "../src/lib/seo-intent-ownership";

const read = (path: string) => readFileSync(path, "utf8");

test("self-serve demo owns generic payroll software demo intent", () => {
  const demo = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/demo");
  assert.equal(demo?.primaryIntent, "payroll software demo philippines");
  assert.equal(demo?.intentClass, "conversion");
});

test("guided booking owns a distinct book-demo intent", () => {
  const booked = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/book-demo");
  assert.equal(booked?.primaryIntent, "book payroll software demo philippines");
  assert.equal(booked?.intentClass, "conversion");
});

test("demo and book-demo primary intents do not normalize to the same phrase", () => {
  const demo = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/demo");
  const booked = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/book-demo");

  assert.notEqual(
    normalizeSeoIntent(demo?.primaryIntent ?? ""),
    normalizeSeoIntent(booked?.primaryIntent ?? ""),
  );
});

test("live demo metadata targets self-serve product demo intent", () => {
  const page = read("src/app/demo/page.tsx");
  assert.ok(page.includes('title: "Payroll Software Demo Philippines | Live Linaw Demo"'));
  assert.ok(page.includes('alternates: { canonical: "/demo" }'));
  assert.ok(page.includes('name: "Live payroll demo", path: "/demo"'));
});

test("book-demo metadata targets guided booking intent", () => {
  const page = read("src/app/book-demo/page.tsx");
  assert.ok(page.includes('title: "Book Payroll Software Demo Philippines | Linaw"'));
  assert.ok(page.includes('alternates: { canonical: "/book-demo" }'));
  assert.ok(page.includes('name: "Book a payroll demo", path: "/book-demo"'));
});

test("self-serve demo and guided booking metadata titles are unique", () => {
  const demo = read("src/app/demo/page.tsx");
  const booked = read("src/app/book-demo/page.tsx");

  const demoTitle = demo.match(/title:\s*"([^"]+)"/)?.[1];
  const bookedTitle = booked.match(/title:\s*"([^"]+)"/)?.[1];

  assert.ok(demoTitle);
  assert.ok(bookedTitle);
  assert.notEqual(demoTitle, bookedTitle);
});
