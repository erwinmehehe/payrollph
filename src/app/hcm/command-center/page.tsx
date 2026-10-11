import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { eq, sql } from "drizzle-orm";
import { employees, organizations } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { canOpenPeopleHome, explicitHcmEmployerId, peopleHomeEnabledForOrganization } from "@/lib/hcm-people-home-scope";
import { loadPeopleHomeWorklist } from "@/lib/hcm-people-home-worklist";

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

  // Exact headcount remains distinct from bounded, incomplete work previews.
  const [employer, headcount] = await Promise.all([
    db.select({ name: organizations.name }).from(organizations)
      .where(eq(organizations.id, organizationId)).limit(1),
    db.select({ count: sql<number>`count(*)::int` }).from(employees)
      .where(eq(employees.organizationId, organizationId)),
  ]);
  if (!employer[0]) notFound();

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
    <header className="mb-8">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">People operations · {employer[0].name}</p>
      <h1 className="mt-2 text-3xl font-bold">People Home</h1>
      <p className="mt-2 max-w-3xl text-slate-600">
        Read-only workforce context for the selected employer. Counts reflect recorded source data, not completed approvals, verified attendance or payroll readiness.
      </p>
    </header>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {summary.map((item) => <article key={item.label} className="rounded-xl border bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">{item.label}</p>
        <p className="mt-2 text-3xl font-bold">{item.value}</p>
      </article>)}
    </div>

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
              {section.data.items.length === 0 && (
                <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                  No matching items in this preview. The source workspace remains authoritative.
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
                  <Link href={item.sourceUrl} className="mt-2 inline-block text-sm font-semibold text-emerald-800 underline">
                    Open source workflow
                  </Link>
                </li>)}
              </ul>
              {(section.data.hasMore || section.data.partial) && <p className="mt-3 text-xs text-slate-600">
                Partial, bounded preview. Other work, including additional source categories or assignees beyond the scan limit, may exist. Open the authoritative inbox for a complete review.
              </p>}
            </>
          )}
          <Link className="mt-5 inline-block rounded-lg border border-emerald-800 px-4 py-2 text-sm font-semibold text-emerald-900"
            href={section.sourceUrl}>Open {section.sourceName}</Link>
        </article>)}
      </div>
    </section>
    <div className="mt-8">
      <Link href={`/app?organizationId=${organizationId}`} className="text-sm font-semibold text-emerald-800 underline">Back to selected employer workspace</Link>
    </div>
  </main>;
}
