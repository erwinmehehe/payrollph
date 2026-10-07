import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("0068 adds immutable Automation Studio version history and draft pointers", () => {
  const migration = read("drizzle/0068_automation_rule_version_governance.sql");
  assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS "published_version"'));
  assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS "draft_version"'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "automation_rule_versions"'));
  assert.ok(migration.includes("automation_rule_versions_rule_version_unique"));
  assert.ok(migration.includes("automation_rule_versions_one_draft_unique"));
  assert.ok(migration.includes("'draft','published','superseded'"));
  assert.ok(migration.includes("INSERT INTO \"automation_rule_versions\""));
});

test("fresh database schema mirrors version governance", () => {
  const schema = read("src/db/schema.ts");
  const baseline = read("drizzle/baseline.sql");
  for (const source of [schema, baseline]) {
    assert.ok(source.includes("automation_rule_versions"));
    assert.ok(source.includes("published_version"));
    assert.ok(source.includes("draft_version"));
    assert.ok(source.includes("automation_rule_versions_rule_version_unique"));
  }
  assert.ok(schema.includes("automation_rule_versions_status_check"));
});

test("saving a workflow edits a draft rather than the live runtime snapshot", () => {
  const versioning = read("src/lib/automation-versioning.ts");
  assert.ok(versioning.includes("saveAutomationRuleDraft"));
  assert.ok(versioning.includes('status: "draft"'));
  assert.ok(versioning.includes("draftVersion: draft.version"));
  assert.ok(versioning.includes("active: false"));
  assert.equal(
    /saveAutomationRuleDraft[\s\S]*?updatedRule[\s\S]*?name: input\.name/.test(versioning),
    false,
    "existing published runtime row must not be overwritten while saving a draft",
  );
});

test("publish atomically promotes the draft into the runtime rule", () => {
  const versioning = read("src/lib/automation-versioning.ts");
  assert.ok(versioning.includes("publishAutomationRuleDraft"));
  assert.ok(versioning.includes('eq(automationRuleVersions.status, "draft")'));
  assert.ok(versioning.includes('status: "published"'));
  assert.ok(versioning.includes("publishedVersion: published.version"));
  assert.ok(versioning.includes("draftVersion: null"));
  assert.ok(versioning.includes("for update"));
});

test("rollback creates a new published version copied from history", () => {
  const versioning = read("src/lib/automation-versioning.ts");
  assert.ok(versioning.includes("rollbackAutomationRule"));
  assert.ok(versioning.includes("sourceVersion: target.version"));
  assert.ok(versioning.includes("const nextVersion = (versions[0]?.version ?? 0) + 1"));
  assert.ok(versioning.includes('status: "superseded"'));
  assert.ok(versioning.includes('status: "published"'));
});

test("enable and disable are versioned production changes and cannot jump over a draft", () => {
  const versioning = read("src/lib/automation-versioning.ts");
  assert.ok(versioning.includes("setAutomationRuleActiveVersioned"));
  assert.ok(versioning.includes("Publish or roll back the pending draft"));
  assert.ok(versioning.includes("sourceVersion: rule.publishedVersion"));
});

test("Automation Studio API exposes history and separates save publish rollback actions", () => {
  const api = read("src/app/api/automation-studio/route.ts");
  assert.ok(api.includes("listAutomationRuleVersions"));
  assert.ok(api.includes('action === "save-rule"'));
  assert.ok(api.includes('action === "publish-rule"'));
  assert.ok(api.includes('action === "rollback-rule"'));
  assert.ok(api.includes("Automation Studio draft published"));
  assert.ok(api.includes("Automation Studio rule rolled back"));
});

test("Studio UI makes staging and rollback visible", () => {
  const ui = read("src/components/automation-studio-panel.tsx");
  assert.ok(ui.includes("Save draft"));
  assert.ok(ui.includes("waiting to publish"));
  assert.ok(ui.includes("Publish v"));
  assert.ok(ui.includes("Rollback to v"));
  assert.ok(ui.includes("do not affect production until separately published"));
});

test("runtime engine remains pinned to published automation_rules snapshots", () => {
  const engine = read("src/lib/automation.ts");
  assert.ok(engine.includes("from(automationRules)"));
  assert.ok(engine.includes("eq(automationRules.active, true)"));
  assert.equal(engine.includes("automationRuleVersions"), false);
  assert.ok(engine.includes("workflow: plan"));
});
