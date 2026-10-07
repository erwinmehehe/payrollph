import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const migration = readFileSync("drizzle/0068_automation_rule_versioning.sql", "utf8");
const baseline = readFileSync("drizzle/baseline.sql", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const api = readFileSync("src/app/api/automation-studio/route.ts", "utf8");
const panel = readFileSync("src/components/automation-studio-panel.tsx", "utf8");
const engine = readFileSync("src/lib/automation.ts", "utf8");

test("automation rule versions are persisted with fresh-database parity", () => {
  for (const source of [migration, baseline]) {
    assert.ok(source.includes('CREATE TABLE IF NOT EXISTS "automation_rule_versions"'));
    assert.ok(source.includes('"published_version" integer NOT NULL DEFAULT 1'));
    assert.ok(source.includes('"draft_version" integer'));
    assert.ok(source.includes('"automation_rule_versions_rule_version_unique"'));
    assert.ok(source.includes("'Migration backfill'"));
  }

  assert.ok(schema.includes("export const automationRuleVersions = pgTable("));
  assert.ok(schema.includes('publishedVersion: integer("published_version")'));
  assert.ok(schema.includes('draftVersion: integer("draft_version")'));
  assert.ok(schema.includes("automation_rule_versions_version_check"));
});

test("existing automation rules are backfilled as published version one", () => {
  assert.ok(migration.includes('INSERT INTO "automation_rule_versions"'));
  assert.ok(migration.includes('FROM "automation_rules"'));
  assert.ok(migration.includes('ON CONFLICT ("rule_id","version") DO NOTHING'));
  assert.ok(migration.includes('"published_version" = COALESCE("published_version",1)'));
});

test("Automation Studio GET exposes rule version history", () => {
  assert.ok(api.includes("automationRuleVersions"));
  assert.ok(api.includes("ruleVersions"));
  assert.ok(api.includes("desc(automationRuleVersions.version)"));
  assert.ok(panel.includes("ruleVersions: AutomationRuleVersion[]"));
  assert.ok(panel.includes("versionsByRule"));
});

test("legacy save remains versioned and immediate-publish compatible", () => {
  const start = api.indexOf('if (action === "save-rule")');
  const end = api.indexOf('if (action === "save-draft")', start);
  const block = api.slice(start, end);
  assert.ok(block.includes("tx.insert(automationRuleVersions)"));
  assert.ok(block.includes("publishedVersion: nextVersion"));
  assert.ok(block.includes("draftVersion: null"));
  assert.ok(block.includes("Automation Studio rule updated and published"));
  assert.ok(block.includes("publishedVersion: 1"));
});

test("staging a draft never replaces the live workflow definition", () => {
  const start = api.indexOf('if (action === "save-draft")');
  const end = api.indexOf('if (action === "publish-draft")', start);
  const block = api.slice(start, end);

  assert.ok(block.includes("tx.insert(automationRuleVersions)"));
  assert.ok(block.includes("draftVersion: nextVersion"));
  assert.equal(block.includes("name: definition.name,\n          trigger: definition.trigger"), false);
  assert.equal(block.includes("publishedVersion: nextVersion"), false);
});

test("publishing and rollback are serialized and restore complete immutable definitions", () => {
  const publishStart = api.indexOf('if (action === "publish-draft")');
  const rollbackStart = api.indexOf('if (action === "rollback-rule")');
  const setActiveStart = api.indexOf('if (action === "set-active")');
  const publish = api.slice(publishStart, api.indexOf('if (action === "discard-draft")', publishStart));
  const rollback = api.slice(rollbackStart, setActiveStart);

  for (const block of [publish, rollback]) {
    assert.ok(block.includes("for update"));
    assert.ok(block.includes("name: definition.name"));
    assert.ok(block.includes("trigger: definition.trigger"));
    assert.ok(block.includes("conditions: definition.conditions"));
    assert.ok(block.includes("actions: definition.actions"));
    assert.ok(block.includes("draftVersion: null"));
    assert.ok(block.includes("publishedByUserId: user.id"));
  }
  assert.ok(publish.includes("current.draftVersion"));
  assert.ok(rollback.includes("targetVersion"));
});

test("discarding a draft preserves immutable history", () => {
  const start = api.indexOf('if (action === "discard-draft")');
  const end = api.indexOf('if (action === "rollback-rule")', start);
  const block = api.slice(start, end);
  assert.ok(block.includes("draftVersion: null"));
  assert.equal(block.includes("delete(automationRuleVersions)"), false);
  assert.equal(api.includes("update(automationRuleVersions)"), false);
});

test("execution idempotency and in-flight workflow snapshots remain unchanged", () => {
  assert.ok(engine.includes("automationExecutions_rule_event_unique") || schema.includes("automation_executions_rule_event_unique"));
  assert.ok(engine.includes("workflow,"));
  assert.ok(engine.includes("execution.workflow"));
  assert.ok(engine.includes(".onConflictDoNothing().returning()"));
});

test("Studio UI exposes staged publishing and rollback without silently publishing edits", () => {
  assert.ok(panel.includes("Edit draft"));
  assert.ok(panel.includes("Stage draft"));
  assert.ok(panel.includes("Publish v"));
  assert.ok(panel.includes("Discard"));
  assert.ok(panel.includes("Roll back"));
  assert.ok(panel.includes('action: editingRuleId ? "save-draft" : "save-rule"'));
  assert.ok(panel.includes("The live workflow is unchanged until you publish it."));
  assert.ok(panel.includes("Version {rule.publishedVersion} published"));
});
