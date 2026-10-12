"use client";

import type { ReactNode } from "react";
import { ArrowRight, Check, CircleAlert, ShieldCheck, UsersRound, WalletCards } from "lucide-react";
import type { FirstPayrollReadiness as FirstPayrollReadinessState } from "@/lib/first-payroll-readiness";
import { buildFirstPayrollJourney } from "@/lib/first-payroll-journey";

export function FirstPayrollReadinessCard({
  readiness,
  onPage,
  onNewRun,
  onSettings,
  allowedPages,
  guided = false,
  inlineJourney,
}: {
  readiness: FirstPayrollReadinessState;
  onPage: (page: string) => void;
  onNewRun: () => void;
  onSettings?: (tab: "organization" | "team") => void;
  allowedPages: readonly string[];
  guided?: boolean;
  inlineJourney?: ReactNode;
}) {
  // Keep the export/filing handoff visible after the first run is released.
  // Once a second run exists, the employer has completed the initial journey.
  if (readiness.firstPayrollReleased && readiness.payrollRunCount > 1) return null;

  if (inlineJourney) return inlineJourney;

  const percent = Math.round((readiness.completed / readiness.total) * 100);
  const journey = buildFirstPayrollJourney(readiness);

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

      {guided && <ol aria-label="Guided first payroll journey" className="grid gap-3 md:grid-cols-2" style={{ margin: "16px 0", padding: 0, listStyle: "none" }}>
        {journey.map((step, index) => (
          <li key={step.key} className="rounded-xl border p-4" style={{ borderColor: "var(--line)", background: "var(--canvas-subtle)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <strong>{index + 1}. {step.title}</strong>
              <span className="text-xs" style={{ marginLeft: "auto", color: "var(--muted)" }}>
                {step.state === "complete" ? "Setup recorded" : step.state === "review" ? "Human review needed" : step.state === "available" ? "Next action" : "Upcoming"}
              </span>
            </div>
            <p style={{ fontSize: 12, margin: "8px 0" }}>{step.detail}</p>
            {step.state !== "complete" && step.state !== "upcoming" && allowedPages.includes(step.page) && (
              <button type="button" className="first-payroll-link" onClick={() => {
                if (step.settingsTab && onSettings) onSettings(step.settingsTab);
                onPage(step.page);
              }}>
                {step.actionLabel} <ArrowRight size={13} />
              </button>
            )}
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
        {readiness.ready && allowedPages.includes(readiness.firstPayrollReleased ? "Exports" : "Payroll") && (
          <button
            className="primary-button"
            onClick={readiness.firstPayrollReleased
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
