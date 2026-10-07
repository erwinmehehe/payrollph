import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { automationRules, automationRuleVersions } from "@/db/schema";
import {
  automationTriggerIsLive,
  normalizeAutomationActions,
  validAutomationConditions,
  validateAutomationActionTrigger,
  type AutomationTrigger,
} from "@/lib/automation";

export class AutomationVersionError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = "AutomationVersionError";
    this.status = status;
  }
}

export async function listAutomationRuleVersions(organizationId: number) {
  return db.select().from(automationRuleVersions)
    .where(eq(automationRuleVersions.organizationId, organizationId))
    .orderBy(desc(automationRuleVersions.ruleId), desc(automationRuleVersions.version));
}

function validateStoredDefinition(version: typeof automationRuleVersions.$inferSelect) {
  const trigger = version.trigger as AutomationTrigger;
  if (!automationTriggerIsLive(trigger)) {
    throw new AutomationVersionError("This draft uses a trigger whose authoritative adapter is not live.", 409);
  }
  if (!validAutomationConditions(version.conditions)) {
    throw new AutomationVersionError("Stored draft conditions are invalid.", 409);
  }
  const actions = normalizeAutomationActions(version.actions);
  if (!actions) throw new AutomationVersionError("Stored draft actions are invalid.", 409);
  const compatibility = validateAutomationActionTrigger(trigger, actions);
  if (compatibility) throw new AutomationVersionError(compatibility, 409);
  return { trigger, conditions: version.conditions, actions };
}

export async function saveAutomationRuleDraft(input: {
  organizationId: number;
  ruleId?: number | null;
  name: string;
  trigger: AutomationTrigger;
  conditions: unknown;
  actions: unknown;
  active: boolean;
  actorUserId: number;
}) {
  return db.transaction(async (tx) => {
    if (!input.ruleId) {
      const [rule] = await tx.insert(automationRules).values({
        organizationId: input.organizationId,
        name: input.name,
        trigger: input.trigger,
        conditions: input.conditions,
        actions: input.actions,
        active: false,
        publishedVersion: 0,
        draftVersion: 1,
        createdByUserId: input.actorUserId,
      }).returning();

      const [draft] = await tx.insert(automationRuleVersions).values({
        organizationId: input.organizationId,
        ruleId: rule.id,
        version: 1,
        status: "draft",
        name: input.name,
        trigger: input.trigger,
        conditions: input.conditions,
        actions: input.actions,
        active: input.active,
        createdByUserId: input.actorUserId,
      }).returning();
      return { rule, draft, created: true };
    }

    await tx.execute(sql`
      select id
      from automation_rules
      where id = ${input.ruleId}
        and organization_id = ${input.organizationId}
      for update
    `);
    const [rule] = await tx.select().from(automationRules).where(and(
      eq(automationRules.id, input.ruleId),
      eq(automationRules.organizationId, input.organizationId),
    )).limit(1);
    if (!rule) throw new AutomationVersionError("Automation rule not found.", 404);

    const nextVersion = rule.draftVersion ?? Math.max(1, rule.publishedVersion + 1);
    let draft;
    if (rule.draftVersion) {
      [draft] = await tx.update(automationRuleVersions).set({
        name: input.name,
        trigger: input.trigger,
        conditions: input.conditions,
        actions: input.actions,
        active: input.active,
      }).where(and(
        eq(automationRuleVersions.organizationId, input.organizationId),
        eq(automationRuleVersions.ruleId, rule.id),
        eq(automationRuleVersions.version, rule.draftVersion),
        eq(automationRuleVersions.status, "draft"),
      )).returning();
      if (!draft) throw new AutomationVersionError("The saved draft changed before this update.");
    } else {
      [draft] = await tx.insert(automationRuleVersions).values({
        organizationId: input.organizationId,
        ruleId: rule.id,
        version: nextVersion,
        status: "draft",
        name: input.name,
        trigger: input.trigger,
        conditions: input.conditions,
        actions: input.actions,
        active: input.active,
        createdByUserId: input.actorUserId,
      }).returning();
    }

    const [updatedRule] = await tx.update(automationRules).set({
      draftVersion: draft.version,
      updatedAt: new Date(),
    }).where(and(
      eq(automationRules.id, rule.id),
      eq(automationRules.organizationId, input.organizationId),
    )).returning();

    return { rule: updatedRule, draft, created: false };
  });
}

export async function publishAutomationRuleDraft(input: {
  organizationId: number;
  ruleId: number;
  actorUserId: number;
}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select id
      from automation_rules
      where id = ${input.ruleId}
        and organization_id = ${input.organizationId}
      for update
    `);
    const [rule] = await tx.select().from(automationRules).where(and(
      eq(automationRules.id, input.ruleId),
      eq(automationRules.organizationId, input.organizationId),
    )).limit(1);
    if (!rule) throw new AutomationVersionError("Automation rule not found.", 404);
    if (!rule.draftVersion) throw new AutomationVersionError("This rule has no draft to publish.");

    const [draft] = await tx.select().from(automationRuleVersions).where(and(
      eq(automationRuleVersions.organizationId, input.organizationId),
      eq(automationRuleVersions.ruleId, rule.id),
      eq(automationRuleVersions.version, rule.draftVersion),
      eq(automationRuleVersions.status, "draft"),
    )).limit(1);
    if (!draft) throw new AutomationVersionError("The draft version could not be found.");

    const definition = validateStoredDefinition(draft);
    const now = new Date();

    await tx.update(automationRuleVersions).set({ status: "superseded" }).where(and(
      eq(automationRuleVersions.ruleId, rule.id),
      eq(automationRuleVersions.status, "published"),
    ));
    const [published] = await tx.update(automationRuleVersions).set({
      status: "published",
      publishedByUserId: input.actorUserId,
      publishedAt: now,
    }).where(and(
      eq(automationRuleVersions.id, draft.id),
      eq(automationRuleVersions.status, "draft"),
    )).returning();
    if (!published) throw new AutomationVersionError("The draft changed before publication.");

    const [updatedRule] = await tx.update(automationRules).set({
      name: published.name,
      trigger: definition.trigger,
      conditions: definition.conditions,
      actions: definition.actions,
      active: published.active,
      publishedVersion: published.version,
      draftVersion: null,
      updatedAt: now,
    }).where(and(
      eq(automationRules.id, rule.id),
      eq(automationRules.organizationId, input.organizationId),
      eq(automationRules.draftVersion, draft.version),
    )).returning();
    if (!updatedRule) throw new AutomationVersionError("The rule changed before publication.");

    return { rule: updatedRule, published };
  });
}

export async function rollbackAutomationRule(input: {
  organizationId: number;
  ruleId: number;
  targetVersion: number;
  actorUserId: number;
}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select id
      from automation_rules
      where id = ${input.ruleId}
        and organization_id = ${input.organizationId}
      for update
    `);
    const [rule] = await tx.select().from(automationRules).where(and(
      eq(automationRules.id, input.ruleId),
      eq(automationRules.organizationId, input.organizationId),
    )).limit(1);
    if (!rule) throw new AutomationVersionError("Automation rule not found.", 404);

    const versions = await tx.select().from(automationRuleVersions).where(and(
      eq(automationRuleVersions.organizationId, input.organizationId),
      eq(automationRuleVersions.ruleId, rule.id),
    )).orderBy(desc(automationRuleVersions.version));
    const target = versions.find((row) =>
      row.version === input.targetVersion && row.status !== "draft"
    );
    if (!target) throw new AutomationVersionError("Rollback target is not a published historical version.", 404);

    const definition = validateStoredDefinition(target);
    const nextVersion = (versions[0]?.version ?? 0) + 1;
    const now = new Date();

    await tx.update(automationRuleVersions).set({ status: "superseded" }).where(and(
      eq(automationRuleVersions.ruleId, rule.id),
      eq(automationRuleVersions.status, "published"),
    ));
    await tx.update(automationRuleVersions).set({ status: "superseded" }).where(and(
      eq(automationRuleVersions.ruleId, rule.id),
      eq(automationRuleVersions.status, "draft"),
    ));

    const [published] = await tx.insert(automationRuleVersions).values({
      organizationId: input.organizationId,
      ruleId: rule.id,
      version: nextVersion,
      status: "published",
      name: target.name,
      trigger: definition.trigger,
      conditions: definition.conditions,
      actions: definition.actions,
      active: target.active,
      sourceVersion: target.version,
      createdByUserId: input.actorUserId,
      createdAt: now,
      publishedByUserId: input.actorUserId,
      publishedAt: now,
    }).returning();

    const [updatedRule] = await tx.update(automationRules).set({
      name: published.name,
      trigger: definition.trigger,
      conditions: definition.conditions,
      actions: definition.actions,
      active: published.active,
      publishedVersion: published.version,
      draftVersion: null,
      updatedAt: now,
    }).where(and(
      eq(automationRules.id, rule.id),
      eq(automationRules.organizationId, input.organizationId),
    )).returning();

    return { rule: updatedRule, published, restoredFromVersion: target.version };
  });
}

export async function setAutomationRuleActiveVersioned(input: {
  organizationId: number;
  ruleId: number;
  active: boolean;
  actorUserId: number;
}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select id
      from automation_rules
      where id = ${input.ruleId}
        and organization_id = ${input.organizationId}
      for update
    `);
    const [rule] = await tx.select().from(automationRules).where(and(
      eq(automationRules.id, input.ruleId),
      eq(automationRules.organizationId, input.organizationId),
    )).limit(1);
    if (!rule) throw new AutomationVersionError("Automation rule not found.", 404);
    if (rule.publishedVersion < 1) {
      throw new AutomationVersionError("Publish the rule before changing its live state.");
    }
    if (rule.draftVersion) {
      throw new AutomationVersionError("Publish or roll back the pending draft before changing the live enabled state.");
    }
    if (rule.active === input.active) return { rule, published: null };

    const versions = await tx.select().from(automationRuleVersions).where(and(
      eq(automationRuleVersions.organizationId, input.organizationId),
      eq(automationRuleVersions.ruleId, rule.id),
    )).orderBy(desc(automationRuleVersions.version));
    const nextVersion = (versions[0]?.version ?? rule.publishedVersion) + 1;
    const now = new Date();

    await tx.update(automationRuleVersions).set({ status: "superseded" }).where(and(
      eq(automationRuleVersions.ruleId, rule.id),
      eq(automationRuleVersions.status, "published"),
    ));
    const [published] = await tx.insert(automationRuleVersions).values({
      organizationId: input.organizationId,
      ruleId: rule.id,
      version: nextVersion,
      status: "published",
      name: rule.name,
      trigger: rule.trigger,
      conditions: rule.conditions,
      actions: rule.actions,
      active: input.active,
      sourceVersion: rule.publishedVersion,
      createdByUserId: input.actorUserId,
      createdAt: now,
      publishedByUserId: input.actorUserId,
      publishedAt: now,
    }).returning();

    const [updatedRule] = await tx.update(automationRules).set({
      active: input.active,
      publishedVersion: nextVersion,
      updatedAt: now,
    }).where(and(
      eq(automationRules.id, rule.id),
      eq(automationRules.organizationId, input.organizationId),
    )).returning();

    return { rule: updatedRule, published };
  });
}
