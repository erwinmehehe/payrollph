import assert from "node:assert/strict";
import test from "node:test";
import { absolutePublicUrl, PUBLIC_SITE_URL } from "../src/lib/site-url";

test("public absolute URLs preserve ordinary internal paths, searches and hashes", () => {
  assert.equal(PUBLIC_SITE_URL, "https://payrollsoftware.ph");
  assert.equal(absolutePublicUrl(), "https://payrollsoftware.ph/");
  assert.equal(absolutePublicUrl("/robots.txt"), "https://payrollsoftware.ph/robots.txt");
  assert.equal(absolutePublicUrl("sitemap.xml"), "https://payrollsoftware.ph/sitemap.xml");
  assert.equal(absolutePublicUrl("/help?topic=payroll#details"),
    "https://payrollsoftware.ph/help?topic=payroll#details");
  assert.equal(absolutePublicUrl("https://payrollsoftware.ph/help"),
    "https://payrollsoftware.ph/help");
});

test("public absolute URLs refuse hostile redirects and protocol-relative hosts", () => {
  for (const candidate of [
    "https://evil.example/phishing",
    "http://payrollsoftware.ph/",
    "//evil.example/phishing",
    String.raw`\\evil.example\phishing`,
    "javascript:alert(1)",
    "data:text/html,html",
    "file:///etc/passwd",
    "https://payrollsoftware.ph.evil.example/",
    "https://payrollsoftware.ph@evil.example/",
    "https://user:pass@payrollsoftware.ph/",
  ]) {
    assert.throws(() => absolutePublicUrl(candidate), /canonical site origin/, candidate);
  }
});
