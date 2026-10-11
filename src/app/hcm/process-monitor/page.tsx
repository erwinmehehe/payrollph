import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import {
  MONITOR_FILTERS, canonicalHcmId, canReadHcmProcessMonitor,
  monitorEnabledForEmployer, validMonitorFilter,
  type HcmMonitorFilter, type MonitorProcessItem, type MonitorStepItem,
} from "@/lib/hcm-process-monitor";
import { loadHcmProcessMonitor } from "@/lib/hcm-process-monitor-server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "HCM Process Monitor | Linaw",
  robots: { index: false, follow: false },
};

type Search = {
  organizationId?: string | string[];
  status?: string | string[];
  cursor?: string | string[];
  processId?: string | string[];
};

function one(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function monitorHref(input: {
  org: number; filter: HcmMonitorFilter; cursor?: number; processId?: number;
}) {
  const values = new URLSearchParams({ organizationId: String(input.org) });
  if (input.filter !== "all") values.set("status", input.filter);
  if (input.cursor && input.cursor > 0) values.set("cursor", String(input.cursor));
  if (input.processId) values.set("processId", String(input.processId));
  return "/hcm/process-monitor?" + values.toString();
}

const PH_FORMAT = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short",
});
function localInstant(value: string | null) {
  return value ? PH_FORMAT.format(new Date(value)) : "Not recorded";
}
function statusTone(value: string) {
  if (value === "applied" || value === "completed") return "text-emerald-800 bg-emerald-50";
  if (value === "declined" || value === "failed") return "text-rose-800 bg-rose-50";
  if (value === "cancelled" || value === "skipped") return "text-slate-600 bg-slate-100";
  return "text-amber-800 bg-amber-50";
}

function ProcessCard({
  row, selected, href,
}: {
  row: MonitorProcessItem; selected: boolean; href: string;
}) {
  return (
    <Link
      href={href}
      aria-current={selected ? "true" : undefined}
      className={"block rounded-2xl border p-4 outline-offset-2 transition-colors hover:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-600 " +
        (selected ? "border-emerald-600 bg-emerald-50/40" : "border-slate-200 bg-white")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{row.typeLabel} <span className="font-normal text-slate-500">#{row.id}</span></p>
        <span className={"rounded-full px-2.5 py-1 text-[11px] font-semibold " + statusTone(row.status)}>
          {row.statusLabel}
        </span>
      </div>
      <p className="mt-2 text-xs text-slate-600">
        Requested {localInstant(row.initiatedAt)}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {row.effectiveDate
          ? "Source effective date: " + row.effectiveDate + " (PH business date)"
          : "No source effective date recorded"}
      </p>
    </Link>
  );
}

function StepRow({ step }: { step: MonitorStepItem }) {
  return (
    <li className="relative border-l-2 border-slate-200 pl-5 pb-6 last:pb-0">
      <span aria-hidden="true" className="absolute -left-[6px] top-1 h-2.5 w-2.5 rounded-full bg-emerald-600" />
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-slate-900">
          Step {step.stepIndex + 1} · {step.typeLabel}
        </p>
        <span className={"rounded-full px-2 py-0.5 text-[11px] font-medium " + statusTone(step.status)}>
          {step.statusLabel}
        </span>
        {step.overdue && (
          <span className="text-xs font-semibold text-rose-700">Past recorded deadline</span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-600">
        Assignment: {step.assignmentKind === "role" ? "Configured role" :
          step.assignmentKind === "named_or_other" ? "Restricted assignee" : "Not recorded"}
      </p>
      <p className="mt-1 text-xs text-slate-600">
        Deadline: {step.dueEvidence === "recorded"
          ? localInstant(step.dueAt) + " (Asia/Manila)"
          : step.dueEvidence === "missing" ? "No timed SLA recorded" : "Source timestamp needs verification"}
      </p>
      {step.completedAt && (
        <p className="mt-1 text-xs text-slate-500">Completed {localInstant(step.completedAt)}</p>
      )}
    </li>
  );
}

export default async function HcmProcessMonitorPage({
  searchParams,
}: { searchParams: Promise<Search> }) {
  const query = await searchParams;
  const organizationId = canonicalHcmId(one(query.organizationId));
  if (!organizationId || !monitorEnabledForEmployer(organizationId)) notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");

  const filterText = one(query.status) ?? "all";
  const cursor = query.cursor === undefined ? 0 : canonicalHcmId(one(query.cursor), true);
  const selectedProcessId = query.processId === undefined ? null : canonicalHcmId(one(query.processId));
  if (!validMonitorFilter(filterText) || cursor === null ||
      (query.processId !== undefined && selectedProcessId === null)) notFound();

  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
  const access = denied ? null : await getAccess(user.id, organizationId);
  if (denied || !canReadHcmProcessMonitor(access)) notFound();

  let source: Awaited<ReturnType<typeof loadHcmProcessMonitor>> | null = null;
  try {
    source = await loadHcmProcessMonitor({
      organizationId, filter: filterText, cursor, selectedProcessId,
    });
  } catch {
    // A timed-out or failed source must never render "zero workflows".
  }

  const view = source;
  const originHref = "/app?organizationId=" + organizationId;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">
                Linaw / People / HCM
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Business Process Monitor</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Follow recorded workflow progress and genuine step deadlines.
                This is a read-only overview, not an approval or payroll-release screen.
              </p>
            </div>
            <Link href={originHref}
              className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-emerald-600">
              Back to workspace
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-5 px-5 py-7 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div>
            <p className="text-xs font-semibold text-slate-500">Employer context</p>
            <p className="font-semibold">Employer #{organizationId}</p>
            <p className="mt-1 text-xs text-slate-500">Selected explicitly · data never carries across employers</p>
          </div>
          <form method="GET" action="/hcm/process-monitor" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="organizationId" value={String(organizationId)} />
            <label className="grid gap-1 text-xs font-semibold text-slate-600">
              Workflow status
              <select name="status" defaultValue={filterText}
                className="min-w-44 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:ring-2 focus-visible:ring-emerald-600">
                {MONITOR_FILTERS.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice === "all" ? "All recorded statuses" : choice.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit"
              className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:ring-2 focus-visible:ring-emerald-600">
              Apply
            </button>
          </form>
        </div>

        {!view ? (
          <section role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-6">
            <h2 className="font-semibold text-amber-900">Workflow source unavailable</h2>
            <p className="mt-2 text-sm text-amber-900">
              We could not verify the source records. Do not treat this as an empty queue.
            </p>
            <Link href={monitorHref({ org: organizationId, filter: filterText })}
              className="mt-3 inline-block text-sm font-semibold underline">
              Retry source
            </Link>
          </section>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <p aria-live="polite">
                {view.items.length} recorded process{view.items.length === 1 ? "" : "es"} on this page
                {view.page.hasMore ? " · more source records available" : " · end of selected page range"}
              </p>
              <p>Observed {localInstant(view.observedAt)} · Asia/Manila</p>
            </div>

            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
              <section aria-labelledby="monitor-process-list" className="space-y-3">
                <h2 id="monitor-process-list" className="text-lg font-semibold">Recorded workflows</h2>
                {view.items.map((item) => (
                  <ProcessCard
                    key={item.id}
                    row={item}
                    selected={item.id === selectedProcessId}
                    href={monitorHref({
                      org: organizationId, filter: filterText,
                      cursor: cursor || undefined, processId: item.id,
                    })}
                  />
                ))}
                {view.items.length === 0 && (
                  <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
                    No workflow records in this filtered page. Other statuses or earlier records may exist.
                  </p>
                )}
                <nav aria-label="Process history pagination" className="flex flex-wrap items-center gap-3 pt-2">
                  {view.page.hasMore && view.page.nextCursor && (
                    <Link href={monitorHref({ org: organizationId, filter: filterText, cursor: view.page.nextCursor })}
                      className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">
                      Older workflows
                    </Link>
                  )}
                  {cursor > 0 && (
                    <Link href={monitorHref({ org: organizationId, filter: filterText })}
                      className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 underline">
                      Back to newest
                    </Link>
                  )}
                </nav>
              </section>

              <section aria-labelledby="monitor-process-detail"
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
                <h2 id="monitor-process-detail" className="text-lg font-semibold">Step timeline</h2>
                {view.detail.state === "not_selected" && (
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    Select a recorded workflow to inspect its available steps and deadlines.
                  </p>
                )}
                {view.detail.state === "not_found" && (
                  <p role="status" className="mt-3 text-sm leading-6 text-slate-600">
                    This workflow is not recorded for the selected employer. No other employer’s detail was loaded.
                  </p>
                )}
                {view.detail.state === "recorded" && (
                  <>
                    <div className="mt-4 border-b border-slate-100 pb-5">
                      <p className="text-sm font-semibold">{view.detail.process.typeLabel} #{view.detail.process.id}</p>
                      <p className="mt-1 text-xs text-slate-600">{view.detail.process.statusLabel}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        {view.detail.process.effectiveDate
                          ? "Source effective date: " + view.detail.process.effectiveDate + " · not an SLA"
                          : "Source effective date not recorded"}
                      </p>
                    </div>
                    {view.detail.steps.length ? (
                      <ol aria-label="Recorded process steps" className="mt-6">
                        {view.detail.steps.map((step) => <StepRow key={step.id} step={step} />)}
                      </ol>
                    ) : (
                      <p className="mt-5 text-sm text-slate-600">No recorded steps found. This does not prove the workflow completed.</p>
                    )}
                    {view.detail.stepsPartial && (
                      <p role="status" className="mt-4 text-xs font-medium text-amber-800">
                        Partial timeline: additional source steps exist beyond this preview.
                      </p>
                    )}
                    <div className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
                      <p className="font-semibold">Act in the original workflow</p>
                      <p className="mt-1 leading-6">
                        Decisions, delegations, and maker-checker rules remain in People → HCM Inbox.
                        Status here is recorded evidence, not permission to approve or change pay.
                      </p>
                      <Link href={originHref}
                        className="mt-3 inline-block font-semibold text-emerald-800 underline underline-offset-4">
                        Open governed workspace
                      </Link>
                    </div>
                  </>
                )}
              </section>
            </div>
          </>
        )}
        <p className="pb-7 text-xs leading-5 text-slate-500">
          Historical process records are snapshots of their authoritative workflow. Effective dates are
          Philippine business dates, not payment or SLA promises. No compensation, bank or private notes
          are returned by this view.
        </p>
      </div>
    </main>
  );
}
