import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { performanceCycles } from "@/db/schema";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES, primaryCompanyOrganizationId } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Goals & Review Cycles | Linaw", robots: { index: false } };

export default async function Page({ searchParams }: {
  searchParams: Promise<{ organizationId?: string }>;
}) {
  if (!criticalReleaseFlagEnabled("goalsReviewCycle")) notFound();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { organizationId: raw } = await searchParams;
  const organizationId = raw ? Number(raw) : await primaryCompanyOrganizationId(user.id);
  if (!organizationId || !Number.isSafeInteger(organizationId)) notFound();
  if (await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES)) notFound();
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) notFound();
  const cycles = await db.select({
    id: performanceCycles.id, name: performanceCycles.name,
    startDate: performanceCycles.startDate, endDate: performanceCycles.endDate,
    status: performanceCycles.status,
  }).from(performanceCycles)
    .where(and(eq(performanceCycles.organizationId, organizationId)))
    .orderBy(desc(performanceCycles.startDate)).limit(20);
  return <main className="mx-auto max-w-3xl space-y-5 p-5 sm:p-8">
    <Link href={`/app?organizationId=${organizationId}`} className="text-sm underline">Back to workspace</Link>
    <h1 className="text-2xl font-semibold">Goals and review cycles</h1>
    <p>Keep goals, self-assessments, manager reviews and completed-cycle records in the existing governed Performance workflow. This page reuses that system without creating a second approval path.</p>
    <Link className="inline-block rounded-md border px-4 py-2" href={`/app?organizationId=${organizationId}&workspacePage=Performance`}>Open Performance workspace</Link>
    <h2 className="text-lg font-semibold">Recent review cycles</h2>
    {cycles.length === 0 ? <p>No cycles have been created.</p> :
    <ul className="space-y-2">{cycles.map(cycle =>
      <li className="rounded-lg border p-3" key={cycle.id}>
        <strong>{cycle.name}</strong><div className="text-sm">{cycle.startDate} to {cycle.endDate} · {cycle.status}</div>
      </li>)}</ul>}
  </main>;
}
