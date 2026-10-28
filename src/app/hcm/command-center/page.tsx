import Link from "next/link";
import { HcmContextNavigation } from "@/components/hcm-context-navigation";
import { buildHcmNavigation, type HcmNavigationLink } from "@/lib/hcm-context-navigation";
import { advancedHcmLinks } from "@/lib/hcm-advanced-discovery";
import { getEntitlements } from "@/lib/billing";
import { enterpriseHcmPlanGateEnabled, evaluateEnterpriseHcmPlan } from "@/lib/hcm-enterprise-plan-policy";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { eq, sql } from "drizzle-orm";
import { employees, organizations } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { canOpenPeopleHome, explicitHcmEmployerId, peopleHomeEnabledForOrganization } from "@/lib/hcm-people-home-scope";
import { loadPeopleHomeWorklist, peopleHomeSourceLinkAccessibleName } from "@/lib/hcm-people-home-worklist";
import { roleHasPeopleWorkspace } from "@/lib/workspace-role-ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "People Home | Linaw HCM", robots: { index: false, follow: false } };

export default async function HcmCommandCenter({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { organizationId: requestedOrganizationId } = await searchParams;
  const organizationId = explicitHcmEmployerId(requestedOrganizationId);
  // An unselected employer is never a valid HCM pilot context, even for a
  // signed-in user. Do not render any People Home UI when flags are disabled.
  if (!organizationId) notFound();

  // Even a valid employer URL cannot bypass the independently controlled pilot allowlist.
  if (!peopleHomeEnabledForOrganization(organizationId)) notFound();

  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
  const access = denied ? null : await getAccess(user.id, organizationId);
  if (denied || !canOpenPeopleHome(access)) notFound();
  const hasPeopleWorkspace = roleHasPeopleWorkspace(access?.role);
  const canOpenSource = (url: string) => hasPeopleWorkspace || !url.startsWith("/app?");

  // Exact headcount remains distinct from bounded, incomplete work previews.
  const [employer, headcount] = await Promise.all([
    db.select({ name: organizations.name }).from(organizations)
      .where(eq(organizations.id, organizationId)).limit(1),
    db.select({ count: sql<number>`count(*)::int` }).from(employees)
      .where(eq(employees.organizationId, organizationId)),
  ]);
  if (!employer[0]) notFound();

  // Advanced navigation is optional, collapses by default, and fails closed
  // if billing metadata is unavailable. It cannot authorize a target route.
  let advancedLinks: HcmNavigationLink[] = [];
  // Non-enrolled pilot employers retain the existing Action Center shortcut.
  // For enrolled employers, suppress a link the authoritative destination
  // will reject unless billing confirms active Enterprise depth.
  let actionCenterAvailable = !enterpriseHcmPlanGateEnabled(organizationId, process.env);
  try {
    const entitlements = await getEntitlements(organizationId);
    const planDecision = evaluateEnterpriseHcmPlan(
      organizationId, entitlements, process.env,
    );
    if (planDecision === "allowed") actionCenterAvailable = true;
    if (planDecision === "allowed" || planDecision === "not-enforced") {
      advancedLinks = advancedHcmLinks(
        access,
        entitlements,
        buildHcmNavigation({ organizationId, access, current: "peopleHome" }),
      );
    }
  } catch {
    // A billing outage must not hide the ordinary HR workspace or expose depth.
  }

  const worklist = await loadPeopleHomeWorklist(organizationId, { id: user.id, name: user.name });
  const previewLabel = (section: typeof worklist.decisions) =>
    section.state === "unavailable" ? "Unavailable" : String(section.items.length) + " shown";
  const summary = [
    { label: "Employee records", value: String(headcount[0]?.count ?? 0) },
    { label: "My HCM decision preview", value: previewLabel(worklist.decisions) },
    { label: "People follow-up preview", value: previewLabel(worklist.followUps) },
    { label: "My case preview", value: previewLabel(worklist.ownedCases) },
  ];

  const sections = [
    {
      id: "my-decisions",
      heading: "My HCM decisions",
      description: "Only steps assigned to your identity or delegated role. Approval remains in its governed workflow.",
      data: worklist.decisions,
      sourceUrl: "/app?organizationId=" + organizationId + "&workspacePage=People&hcmPanel=bp",
      sourceName: "HCM Inbox",
    },
    {
      id: "people-followups",
      heading: "People Ops follow-ups",
      description: "Selected lifecycle notifications and provisioning checklists only; other People Ops sources remain in the full inbox.",
      data: worklist.followUps,
      sourceUrl: "/app?organizationId=" + organizationId + "&workspacePage=People",
      sourceName: "People Operations Inbox",
    },
    {
      id: "owned-cases",
      heading: "Cases assigned to me",
      description: "Operational cases with recorded ownership. Opening a case does not approve a transaction.",
      data: worklist.ownedCases,
      sourceUrl: "/hcm/work-items?organizationId=" + organizationId,
      sourceName: "HR Work Queue",
    },
  ];

  return <main className="mx-auto max-w-7xl px-6 py-10 text-slate-900">
    <HcmContextNavigation organizationId={organizationId} access={access} current="peopleHome" simpleHome />
    <header className="mb-8 mt-8">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">People operations · {employer[0].name}</p>
      <h1 className="mt-2 text-3xl font-bold">People Home</h1>
      <p className="mt-2 max-w-3xl text-slate-600">
        Read-only workforce context for the selected employer. Counts reflect recorded source data, not completed approvals, verified attendance or payroll readiness.
      </p>
    </header>

    {hasPeopleWorkspace && actionCenterAvailable && (
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link href={`/hcm/action-center?organizationId=${organizationId}`}
          className="inline-flex min-h-11 items-center rounded-xl bg-emerald-900 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
          Open HCM Action Center
        </Link>
        <span className="text-sm text-slate-600">Review source-linked HR decisions, follow-ups and owned cases.</span>
      </div>
    )}
    {!hasPeopleWorkspace && <p role="note" className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
      This role can review People Home summaries, but People directory and HCM Inbox actions must be opened by an authorized People workspace user.
    </p>}

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {summary.map((item) => <article key={item.label} className="rounded-xl border bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">{item.label}</p>
        <p className="mt-2 text-3xl font-bold">{item.value}</p>
      </article>)}
    </div>

    {advancedLinks.length > 0 && (
      <details className="mt-6 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
          Advanced HCM tools
          <span className="ml-2 font-normal text-slate-600">
            Jobs, organizational structure and governed workflow monitoring
          </span>
        </summary>
        <p className="mt-3 text-sm text-slate-600">
          Enterprise navigation for authorized HR administrators. Each tool enforces
          its own employer, role, permission and rollout policy when opened.
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {advancedLinks.map((link) => (
            <li key={link.id}>
              <Link href={link.href}
                className="flex min-h-11 items-center rounded-xl border border-emerald-100 bg-emerald-50/40 px-4 py-3 text-sm font-semibold text-emerald-900 hover:border-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </details>
    )}

    <section className="mt-8" aria-labelledby="people-home-worklist">
      <header>
        <h2 id="people-home-worklist" className="text-2xl font-bold">My tasks and source follow-ups</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Decisions, HR source reviews and owned cases are separate work categories. This is a read-only
          view of the underlying modules, not a new approval queue or a complete workforce census.
        </p>
      </header>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        {sections.map((section) => <article key={section.id} aria-labelledby={section.id} className="rounded-xl border bg-white p-5 shadow-sm">
          <h3 id={section.id} className="text-lg font-semibold">{section.heading}</h3>
          <p className="mt-2 min-h-12 text-sm text-slate-600">{section.description}</p>
          {section.data.state === "unavailable" ? (
            <p role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Source unavailable. No items or approvals have been verified. Open the source workspace or retry later.
            </p>
          ) : (
            <>
              {section.data.sourceUnavailable && (
                <p role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  Some People Ops follow-up sources are unavailable. Showing only verified results
                  from responding sources. The missing results are unknown, not an all-clear.
                </p>
              )}
              {section.data.items.length === 0 && (
                <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                  {section.data.sourceUnavailable
                    ? "No items were confirmed by the available source; other source results are unknown."
                    : "No matching items in this preview. The source workspace remains authoritative."}
                </p>
              )}
              <ul className="mt-3 space-y-3">
                {section.data.items.map((item) => <li key={item.key} className="rounded-lg border border-slate-200 p-3">
                  <p className="font-semibold text-slate-900">{item.title}</p>
                  <p className="mt-1 text-xs text-slate-600">{item.category}</p>
                  {item.dueAt && <p className="mt-1 text-xs text-slate-600">
                    Workflow deadline: {new Date(item.dueAt).toLocaleString("en-PH", {
                      timeZone: "Asia/Manila", year: "numeric", month: "short",
                      day: "numeric", hour: "numeric", minute: "2-digit",
                    })}
                  </p>}
                  {item.sourceDate && <p className="mt-1 text-xs text-slate-600">
                    Source milestone: {item.sourceDate} · verify against its own workflow, not an SLA
                  </p>}
                  {!item.dueAt && !item.sourceDate && <p className="mt-1 text-xs text-slate-500">
                    No dated deadline recorded
                  </p>}
                  {item.blockedByMakerChecker && <p className="mt-2 text-xs font-semibold text-amber-800">
                    You initiated this request. A separate reviewer is required.
                  </p>}
                  {canOpenSource(item.sourceUrl) ? (
                    <Link href={item.sourceUrl} className="mt-2 inline-flex min-h-11 items-center rounded-md text-sm font-semibold text-emerald-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700" aria-label={peopleHomeSourceLinkAccessibleName(item)}>
                      {item.source === "provisioning" ? "Open worker in People" : "Open source workflow"}
                    </Link>
                  ) : <p className="mt-2 text-xs text-slate-600">People workspace action unavailable to this role.</p>}
                </li>)}
              </ul>
              {(section.data.hasMore || section.data.partial) && <p className="mt-3 text-xs text-slate-600">
                Partial, bounded preview. Other work, including additional source categories or assignees beyond the scan limit, may exist. Open the authoritative inbox for a complete review.
              </p>}
            </>
          )}
          {canOpenSource(section.sourceUrl) ? (
            <Link className="mt-5 inline-flex min-h-11 items-center rounded-lg border border-emerald-800 px-4 py-2 text-sm font-semibold text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
              href={section.sourceUrl}>Open {section.sourceName}</Link>
          ) : <p className="mt-5 text-xs text-slate-600">This source requires an authorized People workspace role.</p>}
        </article>)}
      </div>
    </section>
    <div className="mt-8">
      <Link href={`/app?organizationId=${organizationId}`} className="inline-flex min-h-11 items-center rounded-md text-sm font-semibold text-emerald-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">Back to selected employer workspace</Link>
    </div>
  </main>;
}
