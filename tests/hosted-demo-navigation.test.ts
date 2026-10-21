import assert from "node:assert/strict";
import test from "node:test";
import { hostedDemoDestination, HOSTED_DEMO_ORIGIN } from "../src/lib/hosted-demo-navigation";

const main = { APP_BASE_URL: "https://erwinmehehe-payrollph.vercel.app" };

test("flag off preserves the local role picker for every disabled value", () => {
  for (const value of [undefined, "false", "TRUE", "1", ""]) {
    assert.equal(hostedDemoDestination({ ...main, HOSTED_DEMO_NAVIGATION_ENABLED: value }), null);
  }
});

test("enabled navigation uses only the fixed verified destination", () => {
  assert.equal(hostedDemoDestination({ ...main, HOSTED_DEMO_NAVIGATION_ENABLED: "true" }), `${HOSTED_DEMO_ORIGIN}/demo`);
});

test("demo deployment stays local even if the flag is accidentally enabled", () => {
  for (const suffix of ["", "/", "/demo?next=https://example.com"]) {
    assert.equal(hostedDemoDestination({ APP_BASE_URL: `${HOSTED_DEMO_ORIGIN}${suffix}`, HOSTED_DEMO_NAVIGATION_ENABLED: "true" }), null);
  }
});

test("missing or invalid deployment configuration keeps the existing page", () => {
  for (const base of [undefined, "invalid", "http://localhost:3000", "javascript:alert(1)"]) {
    assert.equal(hostedDemoDestination({ APP_BASE_URL: base, HOSTED_DEMO_NAVIGATION_ENABLED: "true" }), null);
  }
});
