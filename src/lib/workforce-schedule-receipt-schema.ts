import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, pgTable, serial, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { employees, organizations, users } from "../db/schema";
import type { ScheduleReceiptSnapshot } from "./workforce-schedule-receipt";

/** Application append-only; historical rows are never rewritten by acknowledgment. */
export const workforceScheduleReceipts = pgTable("workforce_schedule_receipts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  acknowledgedByUserId: integer("acknowledged_by_user_id").notNull().references(() => users.id),
  workDate: date("work_date").notNull(),
  snapshotHash: varchar("snapshot_hash", { length: 64 }).notNull(),
  snapshot: jsonb("snapshot").$type<ScheduleReceiptSnapshot>().notNull(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("wfm_schedule_receipt_content_unique").on(table.organizationId, table.employeeId, table.acknowledgedByUserId, table.workDate, table.snapshotHash),
  index("wfm_schedule_receipt_employee_date_idx").on(table.organizationId, table.employeeId, table.workDate),
  check("wfm_schedule_receipt_hash_check", sql`${table.snapshotHash} ~ '^[a-f0-9]{64}$'`),
  check("wfm_schedule_receipt_snapshot_check", sql`coalesce(jsonb_typeof(${table.snapshot}) = 'object' and ${table.snapshot}->>'version' = '1' and ${table.snapshot}->>'date' = ${table.workDate}::text, false)`),
]);
