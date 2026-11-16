import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { assertMembership, getAccess } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { workplaceEntity, workplaceFeatureEnabled } from "@/lib/ph-workplace-context";
import { positiveId } from "@/lib/ph-workplace-compliance-policy";
import { EmployeeWorkplaceConcern } from "@/components/employee-workplace-concern";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Confidential Workplace Concern | Linaw",
  robots: { index: false, follow: false },
};

export default async function EmployeeConcernPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!workplaceFeatureEnabled("phProtectedCases")) notFound();
  const session = await getSessionUser();
  if (!session) redirect("/login");
  // Self-service never accepts a caller-supplied employer, subject or worker.
  if (Object.keys(await searchParams).length > 0) notFound();
  const employeeId = positiveId(session.employeeId);
  if (session.role !== "employee" || !employeeId) notFound();
  const [employee] = await db.select({
    id: employees.id, organizationId: employees.organizationId,
    legalEntityId: employees.legalEntityId, status: employees.status,
  }).from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!employee || employee.status !== "Active") notFound();
  if (await assertMembership(session.id, employee.organizationId)) notFound();
  const access = await getAccess(session.id, employee.organizationId);
  if (!access || access.role !== "employee") notFound();
  const scope = await workplaceEntity(employee.organizationId);
  if (scope.denied || employee.legalEntityId !== scope.legalEntityId) notFound();
  return <main className="mx-auto max-w-3xl space-y-5 px-5 py-8">
    <nav className="text-sm"><Link href="/app" className="font-medium text-emerald-800 hover:underline">
      ← Back to employee workspace</Link></nav>
    <header>
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-800">Protected • Authenticated</p>
      <h1 className="mt-2 text-3xl font-bold">Confidential workplace concern</h1>
      <p className="mt-2 text-sm text-slate-600">
        Choose an appointed complaint officer. Your written statement is encrypted and only you and your
        specifically assigned active officer/reviewer can view it. This is not an anonymous channel.
      </p>
    </header>
    <EmployeeWorkplaceConcern key={employee.id} organizationId={employee.organizationId} />
  </main>;
}
