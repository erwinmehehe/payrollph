import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import {
  canonicalManagerTeamId, managerDirectReportsEnabledForEmployer,
  type ManagerDirectReportsPayload,
} from "@/lib/hcm-manager-direct-reports";
import {
  loadManagerDirectReports, ManagerDirectReportsAccessError,
  ManagerDirectReportsQueryError,
} from "@/lib/hcm-manager-direct-reports-server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Current Direct Reports | Linaw HCM",
  robots: { index: false, follow: false },
};

function safeParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}
function href(organizationId: number, cursor?: number) {
  const params = new URLSearchParams({ organizationId: String(organizationId) });
  if (cursor) params.set("cursor", String(cursor));
  return "/hcm/manager-direct-reports?" + params.toString();
}

/** A distinct read-only screen, never the general unit-member directory. */
export default async function ManagerDirectReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    organizationId?: string | string[];
    cursor?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const organizationId = canonicalManagerTeamId(safeParam(params.organizationId));
  if (!organizationId || !managerDirectReportsEnabledForEmployer(organizationId)) notFound();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const cursor = params.cursor === undefined ? 0 :
    canonicalManagerTeamId(safeParam(params.cursor), true);
  if (cursor === null) notFound();

  let data: ManagerDirectReportsPayload | null = null;
  try {
    data = await loadManagerDirectReports({ userId: user.id, organizationId, cursor });
  } catch (error) {
    if (error instanceof ManagerDirectReportsAccessError ||
        error instanceof ManagerDirectReportsQueryError) notFound();
    // Source outages are NOT an empty or verified team.
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 text-slate-900 sm:px-8">
      <Link
        href={"/app?organizationId=" + organizationId}
        className="text-sm font-semibold text-emerald-800 underline underline-offset-4 focus-visible:outline focus-visible:outline-2"
      >Return to selected employer</Link>
      <header className="mt-7 border-b border-slate-200 pb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Read-only manager view</p>
        <h1 className="mt-2 text-3xl font-bold">Current direct reports</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          Employer #{organizationId}. This screen shows only currently recorded primary
          assignments whose position names your verified employee identity as manager.
          Shared department membership alone does not establish a reporting relationship.
        </p>
      </header>

      {!data ? (
        <section role="alert" className="mt-8 rounded-xl border border-amber-300 p-6">
          <h2 className="font-semibold">Direct-report records unavailable</h2>
          <p className="mt-2 text-sm">
            The source could not be verified. This is not an empty team or an all-clear status.
          </p>
          <Link href={href(organizationId)} className="mt-4 inline-block underline">
            Retry current records
          </Link>
        </section>
      ) : (
        <>
          <p role="status" className="mt-6 text-sm text-slate-700">
            Source business date: {data.asOfDate} (Asia/Manila).
            Showing {data.items.length} verified assignment records on this page;
            no organization-wide headcount is inferred.
          </p>
          {data.items.length === 0 ? (
            <section className="mt-6 rounded-xl border border-slate-300 bg-slate-50 p-6">
              <h2 className="font-semibold">No verified direct reports on this page</h2>
              <p className="mt-2 text-sm">
                This does not prove the manager has no staff. Missing, expired,
                conflicting, or differently scoped source assignments are not shown.
              </p>
            </section>
          ) : (
            <ol className="mt-6 grid gap-4 sm:grid-cols-2" aria-label="Verified current direct reports">
              {data.items.map((worker) => (
                <li key={worker.assignmentId} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="text-lg font-semibold">{worker.name}</h2>
                  <p className="mt-1 text-sm text-slate-700">
                    Worker {worker.employeeNo} · {worker.status}
                  </p>
                  <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
                    <dt className="text-slate-600">Position</dt>
                    <dd className="min-w-0 break-words font-medium">{worker.positionCode}</dd>
                    <dt className="text-slate-600">Reporting unit</dt>
                    <dd className="min-w-0 break-words">{worker.reportingUnitName}</dd>
                    <dt className="text-slate-600">Primary assignment</dt>
                    <dd>#{worker.assignmentId}</dd>
                    <dt className="text-slate-600">Effective dates</dt>
                    <dd>{worker.effectiveFrom} to {worker.effectiveUntil ?? "open-ended"}</dd>
                  </dl>
                </li>
              ))}
            </ol>
          )}
          <nav aria-label="Direct-report pages" className="mt-7 flex flex-wrap items-center gap-4">
            {cursor > 0 && (
              <Link href={href(organizationId)}
                className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold">
                Back to first page
              </Link>
            )}
            {data.page.hasMore && data.page.nextCursor && (
              <Link href={href(organizationId, data.page.nextCursor)}
                className="rounded-lg bg-emerald-900 px-4 py-2 text-sm font-semibold text-white">
                Next verified records
              </Link>
            )}
          </nav>
          <p className="mt-7 max-w-3xl text-xs leading-5 text-slate-600">
            {data.warning} Source records can change between page loads.
            No approvals, employee edits, payroll calculations, or payment actions are available.
          </p>
        </>
      )}
    </main>
  );
}
