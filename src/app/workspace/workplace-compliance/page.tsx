import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { positiveId } from "@/lib/ph-workplace-compliance-policy";
import { workplaceAdmin, workplaceFeatureEnabled } from "@/lib/ph-workplace-context";
import { WorkplaceComplianceConsole } from "@/components/workplace-compliance-console";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Philippine Workplace Compliance | Linaw",
  robots: { index: false, follow: false },
};

export default async function WorkplaceCompliancePage({ searchParams }: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const enabled = {
    dole: workplaceFeatureEnabled("phDoleExtended"),
    osh: workplaceFeatureEnabled("phOshRecords"),
    cases: workplaceFeatureEnabled("phProtectedCases"),
  };
  if (!Object.values(enabled).some(Boolean)) notFound();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const raw = (await searchParams).organizationId;
  const organizationId = typeof raw === "string" ? positiveId(raw) : null;
  if (!organizationId) notFound();
  const scope = await workplaceAdmin(user.id, organizationId);
  if (scope.denied) notFound();
  const [company] = await db.select({ name: organizations.name }).from(organizations)
    .where(eq(organizations.id, organizationId)).limit(1);
  if (!company) notFound();
  return <main className="mx-auto max-w-6xl space-y-6 px-5 py-8">
    <nav className="text-sm"><Link href={"/app?organizationId=" + organizationId}
      className="font-medium text-emerald-800 hover:underline">← Back to workspace</Link></nav>
    <header>
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-800">Pilot • Release-controlled</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Philippine workplace compliance</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">
        {company.name} · DOLE supporting evidence, OSH and training registers, and protected
        investigation workflows. Records in this preview are not government submissions or legal certification.
      </p>
    </header>
    <WorkplaceComplianceConsole key={organizationId} organizationId={organizationId} enabled={enabled} />
  </main>;
}
