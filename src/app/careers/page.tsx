import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobRequisitions, organizations } from "@/db/schema";
import { CareersBoard } from "@/components/careers-board";
import { careersNoticeConfig, careersSchemaReady, publishedCareersPredicate } from "@/lib/careers-privacy-gates";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Careers | Linaw" };

export default async function CareersPage({ searchParams }: {
  searchParams: Promise<{ organizationId?: string }>;
}) {
  const notice = careersNoticeConfig();
  // Before privacy/migration activation, never evaluate a requisition query.
  if (!notice) notFound();
  const { organizationId: raw } = await searchParams;
  const organizationId = Number(raw);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) notFound();
  if (!await careersSchemaReady()) notFound();

  const [organization] = await db.select({ name: organizations.name })
    .from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!organization) notFound();
  const jobs = await db.select({
    id: jobRequisitions.id, title: jobRequisitions.title,
    department: jobRequisitions.department, description: jobRequisitions.description,
    employmentType: jobRequisitions.employmentType,
  }).from(jobRequisitions).where(publishedCareersPredicate(organizationId)).limit(60);
  return <CareersBoard organizationId={organizationId} organizationName={organization.name}
    jobs={jobs} privacyNoticeVersion={notice.version} privacyNoticeUrl={notice.url}/>;
}
