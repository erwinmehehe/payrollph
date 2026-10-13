// Only imported by feature-gated employer registration endpoints.
import { sql } from "drizzle-orm";
import { pgTable, serial, integer, varchar, text, boolean, timestamp, unique, uniqueIndex, index } from "drizzle-orm/pg-core";
import { organizations, users } from "@/db/schema";
export const registeredLegalEntities = pgTable(
  "legal_entities",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 40 }).notNull(),
    legalName: varchar("legal_name", { length: 200 }).notNull(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    birTin: varchar("bir_tin", { length: 16 }),
    birBranchCode: varchar("bir_branch_code", { length: 4 }),
    registeredAddress: text("registered_address"),
    sssEmployerNo: varchar("sss_employer_no", { length: 24 }),
    philHealthEmployerNo: varchar("philhealth_employer_no", { length: 24 }),
    pagIbigEmployerNo: varchar("pagibig_employer_no", { length: 24 }),
    statutoryDeductionTiming: varchar("statutory_deduction_timing", { length: 24 }).notNull().default("split"),
    payrollCalendarMode: varchar("payroll_calendar_mode", { length: 24 }).notNull().default("flexible"),
    disbursementBankCode: varchar("disbursement_bank_code", { length: 16 }),
    disbursementAccountName: varchar("disbursement_account_name", { length: 160 }),
    disbursementAccount: varchar("disbursement_account", { length: 160 }),
    primaryEntity: boolean("primary_entity").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("legal_entities_org_code_unique").on(table.organizationId, table.code),
    // A table-level UNIQUE constraint is available during CREATE TABLE,
    // before Drizzle emits dependent composite FKs in disposable db:push.
    unique("legal_entities_org_id_unique").on(table.organizationId, table.id),
    uniqueIndex("legal_entities_org_primary_unique")
      .on(table.organizationId)
      .where(sql`${table.primaryEntity} = true`),
    index("legal_entities_org_active_idx").on(table.organizationId, table.active),
  ],
);

