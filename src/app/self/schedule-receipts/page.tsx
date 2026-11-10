import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertMembership, getAccess } from "@/lib/access";
import { receiptPilotAllowed, validReceiptId } from "@/lib/workforce-schedule-receipt";
import { EmployeeScheduleReceipts } from "@/components/employee-schedule-receipts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Schedule receipts | Linaw", robots: { index: false, follow: false } };
export default async function ScheduleReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.WFM_SCHEDULE_RECEIPTS_ENABLED !== "true") notFound();
  const session = await getSessionUser();
  if (!session) redirect("/login");
  if (session.role !== "employee" || !validReceiptId(session.employeeId)) notFound();

  // Self-service has no client-selected employer or worker. Do not render an
  // own-account shell in response to a forged foreign scope selector.
  const params = await searchParams;
  if (["organizationId", "employeeId", "userId", "orgUnitId", "workDate"].some(
    key => Object.prototype.hasOwnProperty.call(params, key))) notFound();

  const [employee] = await db.select({
    id: employees.id, organizationId: employees.organizationId, status: employees.status,
  }).from(employees).where(eq(employees.id, session.employeeId)).limit(1);
  if (!employee || employee.status !== "Active") notFound();

  // Match the API's transaction-time employee-role gate, not just a generic
  // active organization membership, before mounting the private receipt client.
  const access = await getAccess(session.id, employee.organizationId);
  if (!access || access.role !== "employee") notFound();
  if (await assertMembership(session.id, employee.organizationId)) notFound();
  if (!receiptPilotAllowed(employee.organizationId, process.env.WFM_SCHEDULE_RECEIPTS_ENABLED,
    process.env.WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS)) notFound();
  return <main data-organization-id={employee.organizationId}
    style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
    <Link href="/app">Back to employee workspace</Link>
    <h1>My schedule receipts</h1>
    <EmployeeScheduleReceipts key={`${session.id}:${employee.organizationId}:${employee.id}`} />
  </main>;
}
