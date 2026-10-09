import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { automationLanguageStudioEnabled } from "../src/lib/automation-language-release";

const KEYS = [
  "AUTOMATION_LANGUAGE_STUDIO_ENABLED",
  "AUTOMATION_LANGUAGE_ACCEPTANCE_MODE",
  "APP_BASE_URL",
  "OPENAI_AUTOMATION_DRAFT_ENABLED",
  "OPENAI_API_KEY",
  "DATABASE_URL",
  "CI",
] as const;
type Key = typeof KEYS[number];

function withEnvironment(changes: Partial<Record<Key, string>>, fn: () => void) {
  const before = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(changes)) {
      if (value !== undefined) process.env[key] = value;
    }
    fn();
  } finally {
    for (const key of KEYS) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

const fixture = {
  CI: "true",
  AUTOMATION_LANGUAGE_ACCEPTANCE_MODE: "synthetic-postgres-only",
  APP_BASE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  OPENAI_AUTOMATION_DRAFT_ENABLED: "false",
  OPENAI_API_KEY: "",
};

test("rollout defaults OFF without an explicit authorized environment setting", () => {
  withEnvironment({}, () => assert.equal(automationLanguageStudioEnabled(), false));
  withEnvironment({ OPENAI_AUTOMATION_DRAFT_ENABLED: "true" }, () =>
    assert.equal(automationLanguageStudioEnabled(), false));
  withEnvironment({ OPENAI_API_KEY: "test-key-not-real" }, () =>
    assert.equal(automationLanguageStudioEnabled(), false));
  withEnvironment({ AUTOMATION_LANGUAGE_STUDIO_ENABLED: "false" }, () =>
    assert.equal(automationLanguageStudioEnabled(), false));
  withEnvironment({ AUTOMATION_LANGUAGE_STUDIO_ENABLED: "1" }, () =>
    assert.equal(automationLanguageStudioEnabled(), false));
  withEnvironment({ AUTOMATION_LANGUAGE_STUDIO_ENABLED: "true" }, () =>
    assert.equal(automationLanguageStudioEnabled(), true));
});

test("only a completely isolated synthetic CI fixture can use its test-mode exception", () => {
  withEnvironment(fixture, () => assert.equal(automationLanguageStudioEnabled(), true));
  for (const bad of [
    { CI: "false" },
    { AUTOMATION_LANGUAGE_ACCEPTANCE_MODE: "production" },
    { APP_BASE_URL: "https://payroll.example.com" },
    { DATABASE_URL: "postgresql://postgres:postgres@prod-db.internal:5432/app_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/payroll_prod" },
    { OPENAI_AUTOMATION_DRAFT_ENABLED: "true" },
    { OPENAI_API_KEY: "test-key-not-real" },
    { AUTOMATION_LANGUAGE_STUDIO_ENABLED: "false" },
  ]) {
    withEnvironment({ ...fixture, ...bad }, () =>
      assert.equal(automationLanguageStudioEnabled(), false, JSON.stringify(bad)));
  }
});

test("rollout flag guards the actual backend and hides UI; manual Studio remains available", () => {
  const api = readFileSync("src/app/api/automation-studio/route.ts", "utf8");
  const ui = readFileSync("src/components/automation-studio-panel.tsx", "utf8");
  const env = readFileSync(".env.local.example", "utf8");

  assert.ok(api.includes("features: { languageDraftingEnabled: automationLanguageStudioEnabled() }"));
  assert.ok(api.includes('(action === "draft-from-language" || action === "save-language-draft")'));
  assert.ok(api.includes("!automationLanguageStudioEnabled()"));
  assert.ok(api.includes('"LANGUAGE_DRAFTING_DISABLED"'));
  assert.ok(ui.includes("data.features.languageDraftingEnabled && ("));
  assert.ok(ui.includes("WORKFLOW TEMPLATES"));
  assert.ok(ui.includes("Configured automations"));
  assert.ok(env.includes("AUTOMATION_LANGUAGE_STUDIO_ENABLED=false"));
  assert.ok(!env.includes("NEXT_PUBLIC_AUTOMATION_LANGUAGE_STUDIO_ENABLED"));
});
