import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { managerTeamPositiveId } from "@/lib/hcm-manager-team";
import { authorizeManagerTeam, loadManagerTeamPage } from "@/lib/hcm-manager-team-server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "My Team | Linaw",
  robots: { index: false, follow: false },
};

export default async function HcmMyTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string; cursor?: string }>;
}) {
  if (process.env.HCM_MANAGER_TEAM_ENABLED !== "true") notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const organizationId = managerTeamPositiveId(params.organizationId);
  const cursor = params.cursor === undefined ? null : managerTeamPositiveId(params.cursor);
  if (!organizationId || (params.cursor !== undefined && cursor === null)) notFound();

  const access = await authorizeManagerTeam(user.id, organizationId);
  if (!access) notFound();

  let unavailable = false;
  let result: Awaited<ReturnType<typeof loadManagerTeamPage>> | null = null;
  try {
    result = await loadManagerTeamPage(access, cursor);
  } catch {
    unavailable = true;
  }

  const firstPage = "/hcm/my-team?organizationId=" + organizationId;
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/app" className="text-sm font-semibold text-emerald-800 underline-offset-4 hover:underline">
          Return to workspace
        </Link>
        <header className="mt-7 flex flex-wrap justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">
              HCM · Manager self-service · Read-only preview
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">My Team</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Current direct reports verified from your linked worker identity, today's position manager references,
              and effective-dated primary assignments. This is not a historical reporting chart or employee census.
            </p>
          </div>
          <div className="h-fit rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            Employer <strong className="ml-2 text-slate-900">{organizationId}</strong>
            <span className="mx-3 text-slate-300">|</span>
            Philippine business date <strong className="ml-2 text-slate-900">{result?.businessDate ?? "Unavailable"}</strong>
          </div>
        </header>

        <section aria-labelledby="manager-team-title" className="mt-7 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5 sm:p-6">
            <h2 id="manager-team-title" className="text-xl font-semibold">Recorded direct reports</h2>
            <p className="mt-1 text-sm text-slate-600">
              Showing only this page of verified relationships. Missing or conflicting primary assignment evidence is excluded,
              not counted as no employee. Job/position manager links reflect current source records only.
            </p>
          </div>

          {unavailable && (
            <div role="alert" className="p-6 text-sm text-amber-900">
              Team evidence is temporarily unavailable. No source outage should be interpreted as an empty team.
            </div>
          )}

          {!unavailable && result?.items.length === 0 && (
            <div role="status" className="p-6 text-sm text-slate-600">
              No verified direct-report assignments on this page. This is not a statement that your team has no workers.
              Confirm your manager-to-worker mapping and current assignment evidence with HR.
            </div>
          )}

          {!unavailable && result && result.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] border-collapse text-left text-sm">
                <caption className="sr-only">Current verified direct-report position assignments</caption>
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-semibold">Worker</th>
                    <th scope="col" className="px-5 py-3 font-semibold">Current position</th>
                    <th scope="col" className="px-5 py-3 font-semibold">Recorded unit</th>
                    <th scope="col" className="px-5 py-3 font-semibold">Current status</th>
                    <th scope="col" className="px-5 py-3 font-semibold">Position evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => (
                    <tr key={item.assignmentId} className="border-t border-slate-200 align-top">
                      <td className="px-5 py-4">
                        <div className="font-semibold">{item.name}</div>
                        <div className="mt-1 text-xs text-slate-600">{item.employeeNo}</div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-medium">{item.currentPositionCode}</div>
                        <div className="mt-1 text-xs text-slate-600">Assignment #{item.assignmentId}</div>
                      </td>
                      <td className="px-5 py-4">{item.currentOrgUnit ?? "Unit not recorded"}</td>
                      <td className="px-5 py-4">{item.currentStatus}</td>
                      <td className="px-5 py-4">
                        {item.evidence === "recorded_current_assignment"
                          ? "Current primary assignment recorded"
                          : "Position status needs HR review"}
                        <div className="mt-1 text-xs text-slate-600">
                          Effective from {item.effectiveFrom}
                          {item.effectiveUntil ? " to " + item.effectiveUntil : ""}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!unavailable && result && (
            <nav aria-label="Manager team pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-5">
              <p className="text-xs text-slate-600">
                {result.items.length} verified assignment(s) on this page; not total team headcount.
              </p>
              <div className="flex flex-wrap gap-3">
                {cursor !== null && (
                  <Link href={firstPage} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
                    First page
                  </Link>
                )}
                {result.hasMore && result.nextCursor && (
                  <Link
                    href={firstPage + "&cursor=" + result.nextCursor}
                    className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900"
                  >
                    Next page
                  </Link>
                )}
              </div>
            </nav>
          )}
        </section>
        <p className="mt-5 max-w-4xl text-xs leading-6 text-slate-600">
          Governance: no changes or approvals can be submitted here. Use the existing authorized HR and workforce
          workflows for corrections. The manager relationship in today's mutable position record cannot prove who
          managed a worker historically; ambiguous overlapping primary assignments are withheld.
        </p>
      </div>
    </main>
  );
}
