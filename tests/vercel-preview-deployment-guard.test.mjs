import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync("vercel.json", "utf8"));
const gitRules = config.git?.deploymentEnabled;

test("Vercel denies automatic deployments on unlisted Git branches", () => {
  assert.ok(gitRules && typeof gitRules === "object" && !Array.isArray(gitRules));
  assert.equal(gitRules["**"], false, "Catch-all Git branches must be disabled until staging isolation is proven");
});

test("only main can trigger an automatic deployment", () => {
  assert.deepEqual(
    Object.entries(gitRules).filter(([, enabled]) => enabled === true).map(([branch]) => branch),
    ["main"],
    "No wildcard, staging or Preview branch can bypass the production-only allowlist",
  );
});

test("named staging and preview branches explicitly remain disabled", () => {
  assert.equal(gitRules.staging, false);
  assert.equal(gitRules.preview, false);
  assert.equal(gitRules.main, true, "This guard must not silently change the existing main auto-deploy policy");
});

test("Hobby deployment must not register the unsupported five-minute cron", () => {
  assert.equal(config.crons, undefined,
    "Reintroducing a five-minute Cron on Hobby would block production deployments");
});
