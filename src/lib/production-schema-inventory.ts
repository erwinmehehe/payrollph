/**
 * Structural production release canary. Never queries payroll records or changes
 * the database. Passing does NOT certify applied migration receipts or authorize
 * live payroll, employee access, or bank payouts.
 */
export const requiredReleaseTables = [
  "organizations", "users", "employees", "payroll_runs", "payroll_entries", "audit_events",
  // drizzle/0100 — controlled compensation automation delivery
  "compensation_automation_intents",
  // drizzle/0106 — verified employer onboarding and billing
  "saas_signup_verifications", "saas_billing_checkouts", "saas_billing_state", "saas_billing_events",
  // drizzle/0109 — append-only audit and tamper-evident sealing
  "audit_chain_heads",
  // drizzle/0110 — durable provider event inbox
  "provider_events",
] as const;

export const requiredReleaseColumns = [
  "saas_signup_verifications.organization_id",
  "saas_signup_verifications.token_hash",
  "saas_signup_verifications.verified_at",
  "saas_billing_checkouts.reference_id",
  "saas_billing_state.subscription_id",
  "audit_events.chain_seq",
  "audit_events.prev_hash",
  "audit_events.row_hash",
  "provider_events.event_id",
  "provider_events.organization_id",
  "compensation_automation_intents.event_key",
] as const;

export const requiredReleaseIndexes = [
  "saas_billing_one_open_checkout",
  "audit_events_chain_seq_unique",
  "provider_events_provider_event_id_unique",
  "comp_automation_intent_key_unique",
] as const;

export const requiredReleaseFunctions = ["seal_audit_events(integer)"] as const;
export const requiredReleaseTriggers = ["audit_events.audit_events_protect_mutation"] as const;

export type ReleaseSchemaInventory = {
  tables: readonly string[];
  columns: readonly string[];
  indexes: readonly string[];
  functions: readonly string[];
  triggers: readonly string[];
};

export function evaluateReleaseSchemaInventory(inventory: ReleaseSchemaInventory) {
  const found = {
    tables: new Set(inventory.tables),
    columns: new Set(inventory.columns),
    indexes: new Set(inventory.indexes),
    functions: new Set(inventory.functions),
    triggers: new Set(inventory.triggers),
  };
  const missing = {
    tables: requiredReleaseTables.filter((name) => !found.tables.has(name)),
    columns: requiredReleaseColumns.filter((name) => !found.columns.has(name)),
    indexes: requiredReleaseIndexes.filter((name) => !found.indexes.has(name)),
    functions: requiredReleaseFunctions.filter((name) => !found.functions.has(name)),
    triggers: requiredReleaseTriggers.filter((name) => !found.triggers.has(name)),
  };
  return {
    schemaCompatible: Object.values(missing).every((items) => items.length === 0),
    missing,
    readOnly: true as const,
    migrationReceiptsVerified: false as const,
    payrollGaApproved: false as const,
  };
}
