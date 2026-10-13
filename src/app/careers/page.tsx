import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobRequisitions, organizations } from "@/db/schema";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { CareersBoard } from "@/components/careers-board";
import { applicantPrivacyControlsEnabled } from "@/lib/recruitment-applicant-privacy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Careers | Linaw" };

export default async function CareersPage({ searchParams }: {
  searchParams: Promise<{ organizationId?: string }>;
}) {
  if (!criticalReleaseFlagEnabled("recruitmentJourney") || !applicantPrivacyControlsEnabled() || !criticalReleaseFlagEnabled("publicIntakeProof")) notFound();
  const noticeVersion = process.env.CAREERS_PRIVACY_NOTICE_VERSION ?? "";
  const noticeUrl = process.env.CAREERS_PRIVACY_NOTICE_URL ?? "";
  if (!/^[A-Za-z0-9._-]{2,64}$/.test(noticeVersion) || !/^https:\/\/[^\s]+$/.test(noticeUrl)) notFound();
  // The public careers source has only tenant-level filtering. Do not display
  // or publish from it in multi-entity mode until legal-employer attribution is reviewed.
  if (criticalReleaseFlagEnabled("multiEntity")) notFound();
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
    sql`${jobRequisitions.status} in ('open', 'interviewing')`, sql`${jobRequisitions.positionId} is not null`,
  )).limit(60);
  return <CareersBoard organizationId={organizationId} organizationName={organization.name} jobs={jobs} privacyNoticeVersion={noticeVersion} privacyNoticeUrl={noticeUrl}/>;
}
