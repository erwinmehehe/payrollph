import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { organizations, subscriptions, users } from "../db/schema";

/** Inactive owners cannot log in until they confirm possession of their address. */
export const saasSignupVerifications = pgTable("saas_signup_verifications", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().unique().references(() => organizations.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const saasBillingCheckouts = pgTable("saas_billing_checkouts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  subscriptionId: integer("subscription_id").notNull().references(() => subscriptions.id, { onDelete: "cascade" }),
  referenceId: varchar("reference_id", { length: 100 }).notNull().unique(),
  providerSessionId: varchar("provider_session_id", { length: 180 }).unique(),
  providerPlanId: varchar("provider_plan_id", { length: 180 }).unique(),
  plan: varchar("plan", { length: 32 }).notNull(),
  seats: integer("seats").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: varchar("currency", { length: 8 }).notNull().default("PHP"),
  status: varchar("status", { length: 24 }).notNull().default("creating"),
  checkoutUrl: text("checkout_url"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("saas_billing_checkouts_org_idx").on(table.organizationId, table.createdAt),
  uniqueIndex("saas_billing_one_open_checkout").on(table.organizationId)
    .where(sql`${table.status} in ('creating','awaiting_payment','review_required')`),
]);

export const saasBillingState = pgTable("saas_billing_state", {
  organizationId: integer("organization_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  subscriptionId: integer("subscription_id").notNull().references(() => subscriptions.id, { onDelete: "cascade" }),
  providerPlanId: varchar("provider_plan_id", { length: 180 }),
  lastPaidCycleId: varchar("last_paid_cycle_id", { length: 180 }),
  paidThrough: timestamp("paid_through", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const saasBillingEvents = pgTable("saas_billing_events", {
  id: serial("id").primaryKey(),
  providerEventKey: varchar("provider_event_key", { length: 250 }).notNull().unique(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  providerPlanId: varchar("provider_plan_id", { length: 180 }).notNull(),
  eventType: varchar("event_type", { length: 80 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("saas_billing_events_org_idx").on(table.organizationId, table.createdAt)]);
