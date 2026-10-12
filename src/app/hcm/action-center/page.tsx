import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { HcmBusinessProcessInbox } from "@/components/hcm-business-process-inbox";
import { HcmContextNavigation } from "@/components/hcm-context-navigation";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { denyOptInEnterpriseHcmPlan } from "@/lib/hcm-enterprise-plan-server";
import { canOpenPeopleHome, explicitHcmEmployerId, peopleHomeEnabledForOrganization } from "@/lib/hcm-people-home-scope";
import { loadPeopleHomeWorklist } from "@/lib/hcm-people-home-worklist";
import { roleHasPeopleWorkspace } from "@/lib/workspace-role-ui";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "HCM Action Center | Linaw",
  robots: { index: false, follow: false },
};

/** Source-connected only. Existing HCM/HR endpoints retain decision authority. */
export default async function HcmActionCenter({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { organizationId: requested } = await searchParams;
  const organizationId = explicitHcmEmployerId(requested);
  if (!organizationId || !peopleHomeEnabledForOrganization(organizationId)) notFound();

  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
  const access = denied ? null : await getAccess(user.id, organizationId);
  if (denied || !canOpenPeopleHome(access) || !roleHasPeopleWorkspace(access?.role) ||
      !access?.companyWide || !["owner", "admin", "hr"].includes(access.role)) {
    notFound();
  }

  const planDenied = await denyOptInEnterpriseHcmPlan(organizationId);
  if (planDenied) notFound();

  const [employer] = await db.select({ name: organizations.name })
    .from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!employer) notFound();

  const worklist = await loadPeopleHomeWorklist(organizationId, {
    id: user.id, name: user.name,
  });
  const panels = [
    {
      key: "decisions", title: "My HCM decisions",
      description: "Assigned steps only; no decision is performed by this preview.",
      data: worklist.decisions,
      href: "#hcm-decision-inbox", label: "Review assigned decisions",
    },
    {
      key: "follow-ups", title: "People Ops follow-ups",
      description: "Lifecycle and provisioning source checks, not new approvals.",
      data: worklist.followUps,
      href: `/app?organizationId=${organizationId}&workspacePage=People`,
      label: "Open People workspace",
    },
    {
      key: "cases", title: "Cases assigned to me",
      description: "Case ownership and source status, independent of HCM approvals.",
      data: worklist.ownedCases,
      href: `/hcm/work-items?organizationId=${organizationId}`,
      label: "Open HR case queue",
    },
  ];

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-7">
      <div className="mx-auto max-w-7xl">
        <HcmContextNavigation organizationId={organizationId} access={access} current="actionCenter" />
        <header className="mb-8 mt-8">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-800">
            People operations · {employer.name}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">HCM Action Center</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            One place for your assigned HR workflow steps, source follow-ups and owned cases.
            Actions remain governed by their original workflows, with the selected employer preserved.
          </p>
        </header>
        <section aria-label="Action categories" className="grid gap-4 lg:grid-cols-3">
          {panels.map(({ key, title, description, data, href, label }) => (
            <article key={key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
              <p className="mt-2 min-h-12 text-sm text-slate-600">{description}</p>
              {data.state === "unavailable" ? (
                <p role="status" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                  Source unavailable. No completion or all-clear state is inferred.
                </p>
              ) : (
                <>
                  <p className="mt-3 text-2xl font-semibold tabular-nums">
                    {data.items.length}{data.hasMore || data.partial ? "+" : ""}
                    <span className="ml-2 text-xs font-normal text-slate-500">items previewed</span>
                  </p>
                  <ul className="mt-4 space-y-2">
                    {data.items.slice(0, 3).map(item => (
                      <li key={item.key} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                        <span className="font-medium">{item.title}</span>
                        <span className="ml-2 text-xs text-slate-500">{item.category}</span>
                        {item.blockedByMakerChecker && <span className="mt-1 block text-xs text-amber-900">
                          Separate reviewer required
                        </span>}
                      </li>
                    ))}
                  </ul>
                  {data.items.length === 0 && <p className="mt-4 text-sm text-slate-500">
                    No matches in this bounded preview.
                  </p>}
                  {(data.hasMore || data.partial) && <p className="mt-2 text-xs text-amber-900">
                    Partial source preview; more items may exist.
                  </p>}
                </>
              )}
              <Link href={href} className="mt-5 inline-flex min-h-10 items-center rounded-lg border border-emerald-800 px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-emerald-700">
                {label}
              </Link>
            </article>
          ))}
        </section>
        <section id="hcm-decision-inbox" aria-labelledby="action-center-inbox-heading" className="mt-8 scroll-mt-6">
          <h2 id="action-center-inbox-heading" className="mb-3 text-xl font-semibold">Governed HCM decisions</h2>
          <p className="mb-4 max-w-3xl text-sm text-slate-600">
            Approve only through the existing approval endpoint. Review and to-do steps use their
            source-bound decision endpoint; a declined review requires a recorded explanation.
          </p>
          <HcmBusinessProcessInbox key={organizationId} organizationId={organizationId} />
        </section>
        <Link className="mt-5 inline-flex text-sm font-semibold text-emerald-800 underline"
          href={`/hcm/command-center?organizationId=${organizationId}`}>
          Return to People Home
        </Link>
      </div>
    </main>
  );
}
