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
    <section className="first-payroll-card" aria-label="Ready for first payroll">
      <div className="first-payroll-head">
        <div>
          <div className="first-payroll-kicker"><ShieldCheck size={14} /> FIRST PAYROLL</div>
          <h2>{readiness.ready ? "Ready for first payroll." : "Finish setup before money moves."}</h2>
          <p>
            {readiness.ready
              ? "The roster, payout details, and maker-checker roles are in place."
              : `${readiness.completed} of ${readiness.total} launch checks are complete.`}
          </p>
        </div>

        <div className="first-payroll-progress" aria-label={`${percent}% ready`}>
          <strong>{readiness.completed}/{readiness.total}</strong>
          <span>ready</span>
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
                ? "Your first payroll run has already started."
                : "All first-payroll setup checks are green."
              : "Payroll stays blocked until every active employee has payout details."}
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
    </section>
  );
}
