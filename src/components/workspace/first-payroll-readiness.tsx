"use client";

import { ArrowRight, Check, CircleAlert, ShieldCheck, UsersRound, WalletCards } from "lucide-react";
import type { FirstPayrollReadiness as FirstPayrollReadinessState } from "@/lib/first-payroll-readiness";

export function FirstPayrollReadinessCard({
  readiness,
  onPage,
  onNewRun,
}: {
  readiness: FirstPayrollReadinessState;
  onPage: (page: string) => void;
  onNewRun: () => void;
}) {
  if (readiness.firstPayrollReleased) return null;

  const percent = Math.round((readiness.completed / readiness.total) * 100);

  return (
    <section className="first-payroll-card" aria-label="First payroll setup readiness">
      <div className="first-payroll-head">
        <div>
          <div className="first-payroll-kicker"><ShieldCheck size={14} /> FIRST PAYROLL</div>
          <h2>{readiness.ready ? "Workspace setup complete." : "Complete first-payroll setup."}</h2>
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

      <div className="first-payroll-grid">
        {readiness.items.map((item) => (
          <article className={item.ready ? "first-payroll-item is-ready" : "first-payroll-item"} key={item.key}>
            <div className="first-payroll-icon">
              {item.ready ? <Check size={15} /> : item.key === "employees" || item.key === "payroll-officer" || item.key === "checker" ? <UsersRound size={15} /> : <CircleAlert size={15} />}
            </div>
            <div>
              <strong>{item.label}</strong>
              <p>{item.detail}</p>
            </div>
            {!item.ready && (
              <button className="first-payroll-link" onClick={() => onPage(item.actionPage)}>
                {item.actionLabel} <ArrowRight size={13} />
              </button>
            )}
          </article>
        ))}
      </div>

      <div className="first-payroll-footer">
        <div>
          <WalletCards size={17} />
          <span>
            {readiness.ready
              ? readiness.firstPayrollStarted
                ? "Your first payroll run has started. Review calculations, exceptions and approval status in Payroll."
                : "Setup checks are green. Review employee pay inputs, attendance and statutory deductions before calculating."
              : "Finish the five setup checks before starting a payroll calculation."}
          </span>
        </div>
        {readiness.ready && (
          <button
            className="primary-button"
            onClick={readiness.firstPayrollStarted ? () => onPage("Payroll") : onNewRun}
          >
            {readiness.firstPayrollStarted ? "Open payroll" : "Start first payroll"} <ArrowRight size={15} />
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
