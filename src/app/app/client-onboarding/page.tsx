import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, legalEntities, organizations, subscriptions, userOrganizations } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { isSelfServeOrganization } from "@/lib/saas-workspace-access";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES, primaryCompanyOrganizationId } from "@/lib/access";
import { canonicalPeoplePageOrganizationId } from "@/lib/tenant-people-page-employer";
import { buildClientOnboardingChecklist } from "@/lib/client-onboarding-checklist";
import { ClientSetupTour } from "@/components/client-setup-tour";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Company setup guide | Linaw",
  robots: { index: false, follow: false },
};

/**
 * Client setup is an authenticated, read-only view of existing source records.
 * It never creates a payroll run, approval, employee, bank file or migration.
 */
export default async function ClientOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { organizationId: raw } = await searchParams;
  const organizationId = raw === undefined
    ? await primaryCompanyOrganizationId(user.id)
    : canonicalPeoplePageOrganizationId(raw);
  if (!organizationId) notFound();

  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
  const access = denied ? null : await getAccess(user.id, organizationId);
  // Only company-wide authorized People administrators may inspect these
  // company-wide setup counts. A unit-scoped role must not gain wider scope.
  if (denied || !access?.companyWide || !["owner", "admin"].includes(access.role)) notFound();

  // Preserve the same self-service billing entry gate as /app.
  // A direct guide/dashboard URL must not bypass pending-payment access.
  if (await isSelfServeOrganization(organizationId)) {
    const [billing] = await db.select({ status: subscriptions.status })
      .from(subscriptions).where(eq(subscriptions.organizationId, organizationId)).limit(1);
    if (!billing || billing.status === "pending_payment") {
      redirect(`/billing/setup?organizationId=${organizationId}`);
    }
  }

  const [orgs, workforce, team, entityCounts] = await Promise.all([
    db.select({
      name: organizations.name,
      legalName: organizations.legalName,
      birTin: organizations.birTin,
      sssEmployerNo: organizations.sssEmployerNo,
      philHealthEmployerNo: organizations.philHealthEmployerNo,
      pagIbigEmployerNo: organizations.pagIbigEmployerNo,
    }).from(organizations).where(eq(organizations.id, organizationId)).limit(1),
    db.select({ total: sql<number>`count(*)::int` }).from(employees)
      .where(eq(employees.organizationId, organizationId)),
    db.select({ total: sql<number>`count(*)::int` }).from(userOrganizations)
      .where(and(
        eq(userOrganizations.organizationId, organizationId),
        eq(userOrganizations.active, true),
        ne(userOrganizations.role, "employee"),
      )),
    db.select({ total: sql<number>`count(*)::int` }).from(legalEntities)
      .where(eq(legalEntities.organizationId, organizationId)),
  ]);
  const org = orgs[0];
  if (!org) notFound();
  const configured = [
    org.birTin, org.sssEmployerNo, org.philHealthEmployerNo, org.pagIbigEmployerNo,
  ].filter((value) => Boolean(value?.trim())).length;
  const checklist = buildClientOnboardingChecklist(organizationId, {
    organizationName: org.name,
    legalName: org.legalName,
    employeeRecords: workforce[0]?.total ?? 0,
    activeTeamMembers: team[0]?.total ?? 0,
    employerRegistrationFields: configured,
    hasMultipleLegalEmployers: (entityCounts[0]?.total ?? 0) > 1,
  });
  const percent = Math.round((checklist.recordedRequired / checklist.requiredTotal) * 100);
  const home = `/app?organizationId=${organizationId}`;

  return (
    <main className="mx-auto max-w-6xl px-5 py-9 text-slate-900 sm:px-7">
      <nav aria-label="Back to workspace">
        <Link href={home} className="text-sm font-semibold text-emerald-800 hover:underline">
          ← Back to {org.name} workspace
        </Link>
      </nav>
      <header className="mt-8 max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Getting started · {org.name}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Set up your Linaw workspace</h1>
        <p className="mt-3 text-base leading-7 text-slate-600">
          Follow the steps below to add your business information, employees and team.
          Each status comes from saved workspace records, not a manual tick box.
        </p>
      </header>

      <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
        aria-label="Workspace setup progress">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-600">Required setup fields recorded</p>
            <p className="mt-1 text-3xl font-bold">{checklist.recordedRequired} of {checklist.requiredTotal}</p>
          </div>
          <p className="text-sm font-semibold text-emerald-800">{percent}% of checklist</p>
        </div>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100" role="progressbar"
          aria-valuenow={checklist.recordedRequired} aria-valuemin={0}
          aria-valuemax={checklist.requiredTotal} aria-label="Required setup items recorded">
          <div className="h-full rounded-full bg-emerald-700" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-600">
          Recorded means a corresponding field or row exists; it does not mean the information was independently checked.
          Team invitations are optional and excluded from this percentage.
        </p>
      </section>

      <section className="mt-9" aria-labelledby="setup-steps">
        <h2 id="setup-steps" className="text-xl font-bold">Your setup checklist</h2>
        <ol className="mt-4 grid gap-4 md:grid-cols-2">
          {checklist.steps.map((step, index) => (
            <li key={step.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="inline-flex size-9 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-700">
                  {index + 1}
                </span>
                <span className={step.recorded
                  ? "rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800"
                  : "rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900"}>
                  {step.recorded ? "Recorded" : step.optional ? "Optional" : "Needs attention"}
                </span>
              </div>
              <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">{step.detail}</p>
              <p className="mt-3 text-xs text-slate-600">{step.instruction}</p>
              <Link href={step.destination}
                className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl border border-emerald-700 px-4 py-2 text-sm font-bold text-emerald-900 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
                {step.action} →
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <ClientSetupTour organizationId={organizationId} />

      <section className="mt-9 grid gap-4 md:grid-cols-2" aria-labelledby="next-steps">
        <div className="rounded-2xl bg-slate-900 p-6 text-white">
          <h2 id="next-steps" className="text-xl font-bold">Explore your workspace</h2>
          <p className="mt-2 text-sm leading-6 text-slate-200">
            Start with People, then learn where Settings, Reports, Documents and Approvals live.
            You can return to this guide whenever you need it.
          </p>
          <Link href={home} className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-white px-5 py-2 text-sm font-bold text-slate-900 hover:bg-slate-100">
            Open workspace →
          </Link>
        </div>
        <aside className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
          <h2 className="text-xl font-bold">Before processing real payroll</h2>
          <p className="mt-2 text-sm leading-6">
            Setup progress is not payroll certification. Independently review imported employee data,
            roles, statutory registrations, privacy and security controls, then complete the existing
            payroll readiness and reconciliation gates. This guide cannot approve or release a run.
          </p>
        </aside>
      </section>
    </main>
  );
}
