import { pool } from "@/db";
import { integer, jsonb, pgTable, varchar } from "drizzle-orm/pg-core";

/**
 * Transitional opt-in mapping for columns introduced by 0122.
 * IMPORTANT: do not add these fields to the shared organizations table in
 * src/db/schema.ts until the controlled production migration is complete.
 * Normal organization SELECT * queries must work against old databases.
 */
export const organizationModuleSettings = pgTable("organizations", {
  id: integer("id").primaryKey(),
  moduleNavigationMode: varchar("module_navigation_mode", { length: 8 }).notNull(),
  enabledModules: jsonb("enabled_modules").$type<string[]>().notNull(),
});

export function hasTenantModuleColumns(columns: readonly string[]): boolean {
  return columns.includes("module_navigation_mode") && columns.includes("enabled_modules");
}

/** Fail closed before any optional query on databases that lack 0122. */
export async function tenantModuleStorageAvailable(): Promise<boolean> {
  try {
    const result = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns " +
      "WHERE table_schema = current_schema() AND table_name = 'organizations' " +
      "AND column_name IN ('module_navigation_mode', 'enabled_modules')",
    );
    return hasTenantModuleColumns(result.rows.map(row => row.column_name));
  } catch {
    return false;
  }
}
