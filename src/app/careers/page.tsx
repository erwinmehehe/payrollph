import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { jobRequisitions, organizations } from "@/db/schema";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { CareersBoard } from "@/components/careers-board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Careers | Linaw" };

export default async function CareersPage({ searchParams }: {
  searchParams: Promise<{ organizationId?: string }>;
}) {
  if (!criticalReleaseFlagEnabled("recruitmentJourney")) notFound();
  const { organizationId: raw } = await searchParams;
  const organizationId = Number(raw);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) notFound();
  const [organization] = await db.select({ name: organizations.name })
    .from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!organization) notFound();
  const jobs = await db.select({
    id: jobRequisitions.id, title: jobRequisitions.title, department: jobRequisitions.department,
    description: jobRequisitions.description, employmentType: jobRequisitions.employmentType,
  }).from(jobRequisitions).where(and(
    eq(jobRequisitions.organizationId, organizationId), eq(jobRequisitions.careersPublished, true),
    ne(jobRequisitions.status, "filled"), ne(jobRequisitions.status, "cancelled"),
  )).limit(60);
  return <CareersBoard organizationId={organizationId} organizationName={organization.name} jobs={jobs}/>;
}
