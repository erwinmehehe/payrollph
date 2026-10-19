"use client";

import { ArrowRight, Check, CircleAlert, ShieldCheck, UsersRound, WalletCards } from "lucide-react";
import type { FirstPayrollReadiness as FirstPayrollReadinessState } from "@/lib/first-payroll-readiness";
import { buildFirstPayrollJourney, FIRST_PAYROLL_STEPS, type FirstPayrollKey } from "@/lib/first-payroll-journey";
import { FirstPayrollInlinePanel } from "./first-payroll-inline-panel";
import { useCallback, useState } from "react";
import type { DashboardData, Notify } from "./types";
import { firstPayrollRunHref } from "@/lib/first-payroll-run-navigation";
import { parseFirstPayrollProgressRead } from "@/lib/first-payroll-progress-read";
import { useScopedAsyncResource } from "./use-scoped-async-resource";

export function FirstPayrollReadinessCard({
  readiness,
  onPage,
  onNewRun,
  onSettings,
  allowedPages,
  guided = false,
  inlineEnabled = false,
  data,
  onRefresh,
  onDecide,
  canDecide = false,
  canManageDelegations = false,
  notify,
}: {
  readiness: FirstPayrollReadinessState;
  onPage: (page: string) => void;
  onNewRun: () => void;
  onSettings?: (tab: "organization" | "team") => void;
  allowedPages: readonly string[];
  guided?: boolean;
  inlineEnabled?: boolean;
  data?: DashboardData;
  onRefresh?: () => Promise<void>;
  onDecide?: (id: number, status: "Approved" | "Declined") => Promise<void>;
  canDecide?: boolean;
  canManageDelegations?: boolean;
  notify?: Notify;
}) {
  const [opened,setOpened]=useState<FirstPayrollKey|null>(null);
  const organizationId=data?.selectedOrganization.id;
  // Include the viewer and permissions: an old employer/role's progress must
  // disappear during render, even before an effect cancels its request.
  const scopeKey=JSON.stringify([
    organizationId??null,data?.user?.id??null,data?.access?.role??null,
    data?.access?.companyWide===true,
  ]);
  const loadProgress=useCallback(async (signal:AbortSignal)=>{
    if(!organizationId)throw new Error("Select an employer to load first-payroll progress.");
    const response=await fetch("/api/first-payroll/progress?organizationId="+organizationId,{cache:"no-store",signal});
    if(!response.ok)throw new Error("Saved first-payroll progress could not be verified.");
    return parseFirstPayrollProgressRead(await response.json(),organizationId);
  },[organizationId]);
  const {data:progress,error:progressError,loading:progressLoading,reload:reloadProgress}=
    useScopedAsyncResource(scopeKey,loadProgress,undefined,guided&&inlineEnabled&&Boolean(organizationId));
  // Keep the export/filing handoff visible after the first run is released.
  // Once a second run exists, the employer has completed the initial journey.
  if (readiness.firstPayrollReleased && readiness.payrollRunCount > 1) return null;

  const percent = Math.round((readiness.completed / readiness.total) * 100);
  const journey = buildFirstPayrollJourney(readiness).map(step=>{
    const recorded=progress?.completedSteps?.[step.key];
    const state=guided && inlineEnabled && (step.key==="company" || step.key==="time")
      ? recorded ? "complete" : step.key==="company" ? "available" : step.state
      : step.state;
    return {...step,state};
  });
  const ownerFor = (key:FirstPayrollKey) => FIRST_PAYROLL_STEPS.find(item=>item.key===key)?.owner ?? "owner";
  const resumeRun = data?.payrollRuns[0];
  const resumeHref = guided && inlineEnabled && data?.firstPayrollConnectedEnabled &&
    data.access?.companyWide && allowedPages.includes("Payroll") && resumeRun
      ? firstPayrollRunHref(data.selectedOrganization.id, resumeRun.id) : null;

  return (
    <section className="first-payroll-card" aria-label="First payroll setup readiness">
      <div className="first-payroll-head">
        <div>
          <div className="first-payroll-kicker"><ShieldCheck size={14} /> FIRST PAYROLL</div>
          <h2>{readiness.ready ? "Workspace setup complete." : "Your guided first payroll."}</h2>
          <p>
            {readiness.ready
              ? "Roster, payout details and assigned payroll/checker roles are configured. Payroll calculation and release still require separate checks."
              : `${readiness.completed} of ${readiness.total} workspace setup checks are complete. These do not certify payroll.`}
          </p>
        </div>

        <div className="first-payroll-progress" aria-label={`${percent}% setup complete`}>
          <strong>{readiness.completed}/{readiness.total}</strong>
          <span>setup</span>
        </div>
      </div>

      <div className="first-payroll-meter" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>

      {guided&&inlineEnabled&&progressLoading&&<p role="status">Checking saved first-payroll progress for this employer…</p>}
      {guided&&inlineEnabled&&progressError&&<div className="notice notice-amber" role="alert">
        <span>Saved first-payroll progress and role assignments are unavailable. Do not treat previous completion indicators as verified.</span>
        <button type="button" className="secondary-button" onClick={()=>void reloadProgress()}>Retry saved progress</button>
      </div>}
      {guided && <ol aria-label="Guided first payroll journey" className="grid gap-3 md:grid-cols-2" style={{ margin: "16px 0", padding: 0, listStyle: "none" }}>
        {journey.map((step, index) => (
          <li key={step.key} className="min-w-0 rounded-xl border p-4" style={{ borderColor: "var(--line)", background: "var(--canvas-subtle)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <strong>{index + 1}. {step.title}</strong>
              <span className="text-xs" style={{ marginLeft: "auto", color: "var(--muted)" }}>
                {guided&&inlineEnabled&&(step.key==="company"||step.key==="time")&&progressLoading
                  ? "Checking saved review"
                  : guided&&inlineEnabled&&(step.key==="company"||step.key==="time")&&progressError
                    ? "Review not verified"
                    : step.state === "complete" ? "Setup recorded" : step.state === "review" ? "Human review needed" : step.state === "available" ? "Next action" : "Upcoming"}
              </span>
            </div>
            <p style={{ fontSize: 12, margin: "8px 0" }}>{step.detail}</p>
            <p className="text-xs" style={{color:"var(--muted)"}}>Responsible: {guided&&inlineEnabled&&progressLoading
              ? "Checking assignment…" : guided&&inlineEnabled&&progressError
                ? "Assignment not verified" : progress?.stepOwners?.[step.key]??ownerFor(step.key)}</p>
            {step.key === "payroll" && resumeHref ? (
              <a className="first-payroll-link" href={resumeHref}>
                Open payroll run #{resumeRun!.id} <ArrowRight size={13} />
              </a>
            ) : inlineEnabled && data && onRefresh ? (
              <button type="button" className="first-payroll-link" aria-expanded={opened===step.key} onClick={() => setOpened(current=>current===step.key?null:step.key)}>
                {opened===step.key?"Close panel":step.actionLabel} <ArrowRight size={13} />
              </button>
            ) : allowedPages.includes(step.page) ? (
              <button type="button" className="first-payroll-link" onClick={() => {
                if (step.settingsTab && onSettings) onSettings(step.settingsTab);
                onPage(step.page);
              }}>
                {step.actionLabel} <ArrowRight size={13} />
              </button>
            ) : null}
            {inlineEnabled&&opened===step.key&&data&&onRefresh&&<FirstPayrollInlinePanel key={String(data.selectedOrganization.id)+":"+step.key} step={step.key} data={data} onRefresh={onRefresh} onProgressUpdate={reloadProgress} onDecide={onDecide} canDecide={canDecide} canManageDelegations={canManageDelegations} notify={notify}/>}
          </li>
        ))}
      </ol>}
      {!guided && <div className="first-payroll-grid">
        {readiness.items.map((item) => (
          <article className={item.ready ? "first-payroll-item is-ready" : "first-payroll-item"} key={item.key}>
            <div className="first-payroll-icon">
              {item.ready ? <Check size={15} /> : item.key === "employees" || item.key === "payroll-officer" || item.key === "checker" ? <UsersRound size={15} /> : <CircleAlert size={15} />}
            </div>
            <div>
              <strong>{item.label}</strong>
              <p>{item.detail}</p>
            </div>
            {!item.ready && allowedPages.includes(item.actionPage) && (
              <button className="first-payroll-link" onClick={() => {
                if (item.actionPage === "Settings" && onSettings) {
                  onSettings(item.key === "workspace" ? "organization" : "team");
                }
                onPage(item.actionPage);
              }}>
                {item.actionLabel} <ArrowRight size={13} />
              </button>
            )}
          </article>
        ))}
      </div>}

      <div className="first-payroll-footer">
        <div>
          <WalletCards size={17} />
          <span>
            {readiness.firstPayrollReleased
              ? "Your first payroll was released. Prepare payslips, filing worksheets and independently recorded government acknowledgements in Exports."
              : readiness.ready
                ? readiness.firstPayrollStarted
                  ? "Your first payroll run has started. Review calculations, exceptions and approval status in Payroll."
                  : "Setup checks are green. Review employee pay inputs, attendance and statutory deductions before calculating."
                : "Finish the five setup checks before starting a payroll calculation."}
          </span>
        </div>
        {readiness.ready && !readiness.firstPayrollReleased && resumeHref ? (
          <a className="primary-button" href={resumeHref}>Open payroll <ArrowRight size={15} /></a>
        ) : readiness.ready && allowedPages.includes(readiness.firstPayrollReleased ? "Exports" : "Payroll") && (
          <button
            className="primary-button"
            onClick={guided && inlineEnabled ? () => setOpened(readiness.firstPayrollReleased ? "exports" : "payroll") : readiness.firstPayrollReleased
              ? () => onPage("Exports")
              : readiness.firstPayrollStarted ? () => onPage("Payroll") : onNewRun}
          >
            {readiness.firstPayrollReleased
              ? "Open exports"
              : readiness.firstPayrollStarted ? "Open payroll" : "Start first payroll"} <ArrowRight size={15} />
          </button>
        )}
      </div>

      <div className="notice notice-blue" style={{ marginTop: 12, fontSize: 12 }}>
        <CircleAlert size={15} />
        <span>
          <strong>Readiness stages:</strong> Configure workspace ({readiness.ready ? "complete" : "incomplete"});
          calculate payroll (requires period-specific HR input checks);
          release payroll (requires calculation, statutory and independent checker approval);
          independently certify (requires signed real-employer reconciliation evidence).
          A completed setup checklist does not certify payroll or authorize payment.
        </span>
      </div>
    </section>
  );
}
