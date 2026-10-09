import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { and, eq, ne, sql } from "drizzle-orm";
import { automationOperationalCases, employees, hcmLifecycleNotificationTasks, payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { getAccess, primaryCompanyOrganizationId, assertOrganizationRole, PEOPLE_ADMIN_ROLES } from "@/lib/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "HR Command Center | Linaw", robots: { index: false, follow: false } };

export default async function HcmCommandCenter() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const organizationId = await primaryCompanyOrganizationId(user.id);
  if (!organizationId) redirect("/app");
  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
  const access = await getAccess(user.id, organizationId);
  // Existing operational cases have no org-unit attribute. Never expose them to unit-scoped managers.
  if (denied || !access?.companyWide) return <main className="mx-auto max-w-3xl p-8"><h1 className="text-2xl font-bold">HR Command Center</h1><p className="mt-3">Company-wide People Operations access is required.</p><Link href="/app" className="mt-4 inline-block underline">Return to workspace</Link></main>;

  const [headcount, lifecycle, cases, runs] = await Promise.all([
    db.select({count:sql<number>`count(*)::int`}).from(employees).where(eq(employees.organizationId, organizationId)),
    db.select({count:sql<number>`count(*)::int`}).from(hcmLifecycleNotificationTasks).where(and(eq(hcmLifecycleNotificationTasks.organizationId,organizationId),ne(hcmLifecycleNotificationTasks.status,"resolved"))),
    db.select({count:sql<number>`count(*)::int`}).from(automationOperationalCases).where(and(eq(automationOperationalCases.organizationId,organizationId),ne(automationOperationalCases.status,"resolved"))),
    db.select({id:payrollRuns.id,label:payrollRuns.periodLabel,status:payrollRuns.status,payDate:payrollRuns.payDate,exceptions:payrollRuns.exceptions}).from(payrollRuns).where(eq(payrollRuns.organizationId,organizationId)).orderBy(sql`${payrollRuns.createdAt} DESC`).limit(5),
  ]);

  const summary = [
    {label:"Employee records",value:headcount[0]?.count??0},
    {label:"Lifecycle follow-ups",value:lifecycle[0]?.count??0},
    {label:"Operational cases",value:cases[0]?.count??0},
    {label:"Payroll exceptions (recent runs)",value:runs.reduce((n,r)=>n+(r.exceptions??0),0)},
  ];
  return <main className="mx-auto max-w-7xl px-6 py-10 text-slate-900">
    <header className="mb-8"><p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">People operations · Company workspace</p>
      <h1 className="mt-2 text-3xl font-bold">HR Command Center</h1>
      <p className="mt-2 max-w-3xl text-slate-600">One read-only overview across employee records, lifecycle follow-ups, operational case ownership, and payroll readiness. Each action remains governed by its original workflow.</p>
    </header>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{summary.map(s=><article key={s.label} className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">{s.label}</p><p className="mt-2 text-3xl font-bold">{s.value}</p></article>)}</div>
    <section className="mt-8 grid gap-4 lg:grid-cols-2">
      <article className="rounded-xl border bg-white p-6"><h2 className="text-xl font-semibold">HR ownership and follow-ups</h2>
        <p className="mt-2 text-slate-600">Review case deadlines, overdue escalations and named HR owners.</p>
        <Link className="mt-5 inline-block rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white" href={`/hcm/work-items?organizationId=${organizationId}`}>Open HR Work Queue</Link>
      </article>
      <article className="rounded-xl border bg-white p-6"><h2 className="text-xl font-semibold">Employee and payroll workspace</h2>
        <p className="mt-2 text-slate-600">Continue lifecycle and payroll actions with existing approvals and release controls.</p>
        <Link className="mt-5 inline-block rounded-lg border px-4 py-2 font-semibold text-emerald-900" href="/app">Open workspace</Link>
      </article>
    </section>
    <section className="mt-8 rounded-xl border bg-white p-6"><h2 className="text-xl font-semibold">Recent payroll runs</h2>
      <p className="mt-1 text-sm text-slate-600">Snapshot only. No payroll action can be initiated here.</p>
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">Period</th><th className="p-3">Status</th><th className="p-3">Pay date</th><th className="p-3">Exceptions</th></tr></thead>
        <tbody>{runs.map(r=><tr className="border-b" key={r.id}><td className="p-3">{r.label}</td><td className="p-3">{r.status}</td><td className="p-3">{r.payDate}</td><td className="p-3">{r.exceptions}</td></tr>)}</tbody></table>
        {runs.length===0&&<p className="p-4 text-slate-500">No payroll runs yet.</p>}
      </div>
    </section>
  </main>;
}
