import Link from "next/link";
import { HcmContextNavigation } from "@/components/hcm-context-navigation";
import { notFound, redirect } from "next/navigation";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { explicitHcmEmployerId } from "@/lib/hcm-people-home-scope";
import {
  hirePayrollReviewEnabledForEmployer,
  type HirePayrollEvidenceState,
  type HirePayrollInputReview,
} from "@/lib/hcm-hire-payroll-review";
import { loadHirePayrollInputReview } from "@/lib/hcm-hire-payroll-review-server";
import { pilotFocusEnabledForOrganization } from "@/lib/pilot-navigation";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Hire to payroll input review | Linaw",
  robots: { index: false, follow: false },
};

const labels: Record<HirePayrollEvidenceState, string> = {
  recorded: "Fields recorded",
  needs_review: "Review needed",
  not_recorded: "Not recorded",
  partial: "Partial preview",
  not_assessed: "Not assessed",
};
const tones: Record<HirePayrollEvidenceState, string> = {
  recorded: "border-emerald-200 bg-emerald-50 text-emerald-900",
  needs_review: "border-amber-200 bg-amber-50 text-amber-950",
  not_recorded: "border-amber-200 bg-amber-50 text-amber-950",
  partial: "border-amber-200 bg-amber-50 text-amber-950",
  not_assessed: "border-slate-200 bg-slate-50 text-slate-700",
};

function validWorkerId(value: string | string[] | undefined): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Default-off, explicit-employer, read-only source preview. No approval or
 * payroll mutation action is reachable here. Full role/custom-deny authorization
 * precedes the first worker, payroll or provisioning query.
 */
export default async function HirePayrollInputReviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    organizationId?: string | string[];
    employeeId?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const organizationId = explicitHcmEmployerId(query.organizationId);
  const employeeId = validWorkerId(query.employeeId);
  if (!organizationId || !employeeId ||
      !hirePayrollReviewEnabledForEmployer(organizationId) ||
      pilotFocusEnabledForOrganization(organizationId)) notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");

  const denied = await assertOrganizationRole(
    user.id, organizationId, PEOPLE_ADMIN_ROLES,
    "Company-wide HR access is required.",
  );
  const access = denied ? null : await getAccess(user.id, organizationId);
  if (denied || !access?.companyWide ||
      !["owner", "admin", "hr"].includes(access.role)) notFound();

  let review: HirePayrollInputReview | null = null;
  let unavailable = false;
  try {
    review = await loadHirePayrollInputReview(organizationId, employeeId);
  } catch {
    // Fail closed. Never substitute empty or "complete" source evidence on error.
    unavailable = true;
  }
  if (!unavailable && !review) notFound();

  const back = "/app?organizationId=" + organizationId + "&workspacePage=Recruitment";
  const people = "/app?organizationId=" + organizationId + "&workspacePage=People";
  const attendance = "/app?organizationId=" + organizationId + "&workspacePage=Time%20%26%20attendance";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <HcmContextNavigation
          organizationId={organizationId} employeeId={employeeId}
          access={access} current="payrollReview"
        />
        <Link href={back} className="inline-block text-sm font-semibold text-emerald-800 underline-offset-4 hover:underline focus-visible:underline">
          Return to onboarding
        </Link>
        <header className="mt-7 rounded-2xl border border-slate-200 bg-white p-6">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">HCM · Read-only source review</p>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Hire-to-payroll input evidence</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700">
            Employer #{organizationId} · Worker #{employeeId}. Presence checks from the existing employee, pay profile and onboarding sources.
            A recorded field or completed checklist is not verification, an approved payroll calculation, or permission to release pay.
          </p>
        </header>

        {unavailable && (
          <section role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
            The input sources are temporarily unavailable. No payroll inputs have been confirmed.
            Return to the owning workflows and try again.
          </section>
        )}

        {review && !unavailable && (
          <>
            <p className="mt-5 text-xs text-slate-600">
              Read at {new Intl.DateTimeFormat("en-PH", {
                timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short",
              }).format(new Date(review.observedAt))} (PH). Source data may change after this snapshot.
            </p>
            <section aria-labelledby="hire-input-heading" className="mt-4">
              <h2 id="hire-input-heading" className="text-lg font-bold">Recorded source evidence</h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {review.sections.map((item) => (
                  <li key={item.key} className="rounded-xl border border-slate-200 bg-white p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="font-semibold text-slate-950">{item.label}</h3>
                      <span className={"rounded-full border px-2.5 py-1 text-xs font-semibold " + tones[item.state]}>
                        {labels[item.state]}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-700">{item.detail}</p>
                    <p className="mt-3 text-xs text-slate-500">Authoritative source: {item.source}</p>
                  </li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="hire-next-actions" className="mt-5 rounded-xl border border-slate-200 bg-white p-5">
              <h2 id="hire-next-actions" className="font-bold">Continue in the owning workflows</h2>
              <div className="mt-3 flex flex-wrap gap-3">
                <Link href={people} className="rounded-lg border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-50">Review employee record</Link>
                <Link href={attendance} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50">Review time and attendance</Link>
                <Link href={back} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50">Review onboarding tasks</Link>
              </div>
              <p className="mt-4 text-xs leading-5 text-slate-600">
                This preview never assesses period-specific work time, leave, statutory calculations,
                independent checker approval, bank settlement or filing acceptance. Those controls remain in their governed systems.
              </p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
