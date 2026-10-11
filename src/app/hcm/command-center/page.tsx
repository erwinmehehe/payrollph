import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { and, eq, ne, sql } from "drizzle-orm";
import { automationOperationalCases, employees, hcmLifecycleNotificationTasks, organizations } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { canOpenPeopleHome, explicitHcmEmployerId } from "@/lib/hcm-people-home-scope";

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
  if (!organizationId) {
    return <main className="mx-auto max-w-3xl px-6 py-12 text-slate-900">
      <h1 className="text-2xl font-bold">Select an employer</h1>
      <p className="mt-3 text-slate-600">Open your workspace and select the employer whose People Home you want to view. No employer has been chosen for this page.</p>
      <Link href="/app" className="mt-5 inline-block rounded-lg border px-4 py-2 font-semibold text-emerald-900">Open workspace</Link>
    </main>;
  }

  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
  const access = denied ? null : await getAccess(user.id, organizationId);
  if (denied || !canOpenPeopleHome(access)) notFound();

  // HR counts are source records, not wages, payroll-readiness or assigned approvals.
  // Decisions remain in their original permission-checked source workflows.
  const [employer, headcount, lifecycle, cases] = await Promise.all([
    db.select({ name: organizations.name }).from(organizations)
      .where(eq(organizations.id, organizationId)).limit(1),
    db.select({ count: sql<number>`count(*)::int` }).from(employees)
      .where(eq(employees.organizationId, organizationId)),
    db.select({ count: sql<number>`count(*)::int` }).from(hcmLifecycleNotificationTasks)
      .where(and(
        eq(hcmLifecycleNotificationTasks.organizationId, organizationId),
        ne(hcmLifecycleNotificationTasks.status, "resolved"),
      )),
    db.select({ count: sql<number>`count(*)::int` }).from(automationOperationalCases)
      .where(and(
        eq(automationOperationalCases.organizationId, organizationId),
        ne(automationOperationalCases.status, "resolved"),
      )),
  ]);
  if (!employer[0]) notFound();

  const summary = [
    { label: "Employee records", value: headcount[0]?.count ?? 0 },
    { label: "Unresolved lifecycle follow-ups", value: lifecycle[0]?.count ?? 0 },
    { label: "Open operational cases", value: cases[0]?.count ?? 0 },
  ];

  return <main className="mx-auto max-w-7xl px-6 py-10 text-slate-900">
    <header className="mb-8">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">People operations · {employer[0].name}</p>
      <h1 className="mt-2 text-3xl font-bold">People Home</h1>
      <p className="mt-2 max-w-3xl text-slate-600">
        Read-only workforce context for the selected employer. Counts reflect recorded source data, not completed approvals, verified attendance or payroll readiness.
      </p>
    </header>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {summary.map((item) => <article key={item.label} className="rounded-xl border bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">{item.label}</p>
        <p className="mt-2 text-3xl font-bold">{item.value}</p>
      </article>)}
    </div>

    <section aria-label="Continue work in its source" className="mt-8 grid gap-4 lg:grid-cols-3">
      <article className="rounded-xl border bg-white p-6">
        <h2 className="text-xl font-semibold">My HCM decisions</h2>
        <p className="mt-2 text-slate-600">Open People in the workspace to review business-process steps actually assigned to you. The source workflow controls all decisions.</p>
        <Link className="mt-5 inline-block rounded-lg border px-4 py-2 font-semibold text-emerald-900" href={`/app?organizationId=${organizationId}`}>Open People workspace</Link>
      </article>
      <article className="rounded-xl border bg-white p-6">
        <h2 className="text-xl font-semibold">People Ops follow-ups</h2>
        <p className="mt-2 text-slate-600">Review employment, onboarding, positions and separation findings in the existing People Operations Inbox.</p>
        <Link className="mt-5 inline-block rounded-lg border px-4 py-2 font-semibold text-emerald-900" href={`/app?organizationId=${organizationId}`}>Review People inbox</Link>
      </article>
      <article className="rounded-xl border bg-white p-6">
        <h2 className="text-xl font-semibold">Operational cases</h2>
        <p className="mt-2 text-slate-600">Assign, update and escalate cases in the governed HR Work Queue. An open case is not an assigned approval.</p>
        <Link className="mt-5 inline-block rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white" href={`/hcm/work-items?organizationId=${organizationId}`}>Open HR Work Queue</Link>
      </article>
    </section>

    <div className="mt-8">
      <Link href={`/app?organizationId=${organizationId}`} className="text-sm font-semibold text-emerald-800 underline">Back to selected employer workspace</Link>
    </div>
  </main>;
}
