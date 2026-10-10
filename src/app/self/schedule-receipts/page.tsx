import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertMembership } from "@/lib/access";
import { receiptPilotAllowed } from "@/lib/workforce-schedule-receipt";
import { EmployeeScheduleReceipts } from "@/components/employee-schedule-receipts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Schedule receipts | Linaw", robots: { index: false, follow: false } };
export default async function ScheduleReceiptsPage() {
  if (process.env.WFM_SCHEDULE_RECEIPTS_ENABLED !== "true") notFound();
  const session = await getSessionUser();
  if (!session) redirect("/login");
  if (session.role !== "employee" || !session.employeeId) notFound();
  const [employee] = await db.select({ id: employees.id, organizationId: employees.organizationId }).from(employees)
    .where(eq(employees.id, session.employeeId)).limit(1);
  if (!employee || await assertMembership(session.id, employee.organizationId)) notFound();
  if (!receiptPilotAllowed(employee.organizationId, process.env.WFM_SCHEDULE_RECEIPTS_ENABLED,
    process.env.WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS)) notFound();
  return <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
    <Link href="/app">Back to employee workspace</Link>
    <h1>My schedule receipts</h1>
    <EmployeeScheduleReceipts key={`${session.id}:${employee.organizationId}:${employee.id}`} />
  </main>;
}
