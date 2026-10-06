import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  hcmLifecyclePolicies,
  hcmLifecyclePolicyEvents,
} from "@/db/schema";

export type HcmLifecyclePolicyConfig = {
  actionWindowDays: number;
  reminderDays: number[];
  overdueEscalationDays: [number, number];
  requireManagerReviewForProbation: boolean;
  requireDecisionRationaleNote: boolean;
  requireNonRenewalAttachment: boolean;
};

export type HcmLifecyclePolicyView = HcmLifecyclePolicyConfig & {
  id: number | null;
  version: number;
  persisted: boolean;
  updatedByName: string | null;
  updatedAt: string | null;
};

export const DEFAULT_HCM_LIFECYCLE_POLICY: HcmLifecyclePolicyConfig = {
  actionWindowDays: 30,
  reminderDays: [30, 14, 7, 1, 0],
  overdueEscalationDays: [1, 5],
  requireManagerReviewForProbation: false,
  requireDecisionRationaleNote: false,
  requireNonRenewalAttachment: false,
};

function integerArray(value: unknown) {
  if (!Array.isArray(value)) return null;
  const values = value.map(Number);
  if (values.some((item) => !Number.isInteger(item))) return null;
  return values;
}

function normalizeReminderDays(value: unknown, actionWindowDays: number) {
  const items = integerArray(value);
  if (!items || items.length < 1 || items.length > 8) {
    throw new Error("Reminder days must contain between 1 and 8 integer milestones.");
  }
  const unique = [...new Set(items)].sort((left, right) => right - left);
  if (!unique.includes(0)) {
    throw new Error("Reminder days must include 0 for the due-date reminder.");
  }
  if (unique.some((day) => day < 0 || day > actionWindowDays)) {
    throw new Error("Reminder milestones must be between 0 and the lifecycle action window.");
  }
  return unique;
}

function normalizeEscalationDays(value: unknown): [number, number] {
  const items = integerArray(value);
  if (!items || items.length !== 2) {
    throw new Error("Overdue escalation days must contain exactly two integer thresholds.");
  }
  const unique = [...new Set(items)].sort((left, right) => left - right);
  if (unique.length !== 2 || unique[0] < 1 || unique[1] > 30 || unique[0] >= unique[1]) {
    throw new Error("Overdue escalation thresholds must be two increasing values between 1 and 30 days.");
  }
  return [unique[0], unique[1]];
}

function requireBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`${label} must be true or false.`);
  return value;
}

export function parseHcmLifecyclePolicyInput(value: Record<string, unknown>): HcmLifecyclePolicyConfig {
  const actionWindowDays = Number(value.actionWindowDays);
  if (!Number.isInteger(actionWindowDays) || actionWindowDays < 7 || actionWindowDays > 90) {
    throw new Error("Lifecycle action window must be between 7 and 90 days.");
  }
  return {
    actionWindowDays,
    reminderDays: normalizeReminderDays(value.reminderDays, actionWindowDays),
    overdueEscalationDays: normalizeEscalationDays(value.overdueEscalationDays),
    requireManagerReviewForProbation: requireBoolean(
      value.requireManagerReviewForProbation,
      "Require manager review for probation",
    ),
    requireDecisionRationaleNote: requireBoolean(
      value.requireDecisionRationaleNote,
      "Require decision rationale note",
    ),
    requireNonRenewalAttachment: requireBoolean(
      value.requireNonRenewalAttachment,
      "Require non-renewal attachment",
    ),
  };
}

function rowConfig(row: typeof hcmLifecyclePolicies.$inferSelect): HcmLifecyclePolicyConfig {
  const actionWindowDays = Number(row.actionWindowDays);
  return {
    actionWindowDays,
    reminderDays: normalizeReminderDays(row.reminderDays, actionWindowDays),
    overdueEscalationDays: normalizeEscalationDays(row.overdueEscalationDays),
    requireManagerReviewForProbation: row.requireManagerReviewForProbation,
    requireDecisionRationaleNote: row.requireDecisionRationaleNote,
    requireNonRenewalAttachment: row.requireNonRenewalAttachment,
  };
}

export function lifecyclePolicySnapshot(config: HcmLifecyclePolicyConfig) {
  return {
    actionWindowDays: config.actionWindowDays,
    reminderDays: [...config.reminderDays],
    overdueEscalationDays: [...config.overdueEscalationDays],
    requireManagerReviewForProbation: config.requireManagerReviewForProbation,
    requireDecisionRationaleNote: config.requireDecisionRationaleNote,
    requireNonRenewalAttachment: config.requireNonRenewalAttachment,
  };
}

export async function loadHcmLifecyclePolicy(organizationId: number): Promise<HcmLifecyclePolicyView> {
  const [row] = await db.select().from(hcmLifecyclePolicies)
    .where(eq(hcmLifecyclePolicies.organizationId, organizationId))
    .limit(1);
  if (!row) {
    return {
      ...DEFAULT_HCM_LIFECYCLE_POLICY,
      id: null,
      version: 0,
      persisted: false,
      updatedByName: null,
      updatedAt: null,
    };
  }
  return {
    ...rowConfig(row),
    id: row.id,
    version: row.version,
    persisted: true,
    updatedByName: row.updatedByName,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class HcmLifecyclePolicyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HcmLifecyclePolicyConflictError";
  }
}

export async function saveHcmLifecyclePolicy(input: {
  organizationId: number;
  expectedVersion: number;
  config: HcmLifecyclePolicyConfig;
  actorUserId: number;
  actorName: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(hcmLifecyclePolicies)
      .where(eq(hcmLifecyclePolicies.organizationId, input.organizationId))
      .limit(1);

    if (!existing) {
      if (input.expectedVersion !== 0) {
        throw new HcmLifecyclePolicyConflictError(
          "Lifecycle policy changed before this update. Refresh and try again.",
        );
      }
      const [created] = await tx.insert(hcmLifecyclePolicies).values({
        organizationId: input.organizationId,
        version: 1,
        ...input.config,
        updatedByUserId: input.actorUserId,
        updatedByName: input.actorName,
        createdAt: now,
        updatedAt: now,
      }).returning();

      await tx.insert(hcmLifecyclePolicyEvents).values({
        organizationId: input.organizationId,
        policyId: created.id,
        eventType: "created",
        actorUserId: input.actorUserId,
        actorName: input.actorName,
        fromVersion: null,
        toVersion: 1,
        beforeSnapshot: null,
        afterSnapshot: lifecyclePolicySnapshot(rowConfig(created)),
        createdAt: now,
      });

      return created;
    }

    if (existing.version !== input.expectedVersion) {
      throw new HcmLifecyclePolicyConflictError(
        "Lifecycle policy changed before this update. Refresh and try again.",
      );
    }

    const before = lifecyclePolicySnapshot(rowConfig(existing));
    const [updated] = await tx.update(hcmLifecyclePolicies).set({
      ...input.config,
      version: existing.version + 1,
      updatedByUserId: input.actorUserId,
      updatedByName: input.actorName,
      updatedAt: now,
    }).where(and(
      eq(hcmLifecyclePolicies.id, existing.id),
      eq(hcmLifecyclePolicies.version, input.expectedVersion),
    )).returning();

    if (!updated) {
      throw new HcmLifecyclePolicyConflictError(
        "Lifecycle policy changed before this update. Refresh and try again.",
      );
    }

    await tx.insert(hcmLifecyclePolicyEvents).values({
      organizationId: input.organizationId,
      policyId: updated.id,
      eventType: "updated",
      actorUserId: input.actorUserId,
      actorName: input.actorName,
      fromVersion: existing.version,
      toVersion: updated.version,
      beforeSnapshot: before,
      afterSnapshot: lifecyclePolicySnapshot(rowConfig(updated)),
      createdAt: now,
    });

    return updated;
  });
}
