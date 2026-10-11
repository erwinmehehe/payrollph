"use client";

import { AlertTriangle, ArrowRight, Check, Clock3, FileCheck2, ShieldCheck, WalletCards } from "lucide-react";
import { derivePayrollPayoutState } from "@/lib/payroll-payout-state";
import { payrollRunPresentation } from "@/lib/payroll-workflow-presentation";
import type { DashboardData, PayrollRun, Task } from "./types";
import { formatDate, moneyExact, Status } from "./ui";

type ChecklistItem = { blocking: boolean; passed: boolean; acknowledgeable?: boolean };

type Props = {
  run: PayrollRun;
  task?: Task | null;
  events: DashboardData["auditEvents"];
  checklist: readonly ChecklistItem[] | null;
  role: string;
  canOpenExports: boolean;
  onContinue: () => void;
  onReviewExceptions: () => void;
  onOpenApprovals: () => void;
  onOpenExports: () => void;
};

export function PayrollPhaseTwoOverview({
  run, task, events, checklist, role, canOpenExports,
  onContinue, onReviewExceptions, onOpenApprovals, onOpenExports,
}: Props) {
  const view = payrollRunPresentation({
    run,
    approvalTask: task,
    payout: derivePayrollPayoutState(events, run.id),
    checklist,
  });
  const reviewNeeded = view.exceptionCount > 0 && !view.released;
  const canOpenApprovals = role !== "bookkeeper" || task?.status === "Pending";

  const action =
    view.released && canOpenExports ? { label: "Open payout & exports", run: onOpenExports }
    : view.released ? { label: "View payout details", run: onContinue }
    : role === "owner" ? { label: view.currentStage === "release" ? "Review release controls" : "Review payroll checks", run: onContinue }
    : role === "payroll" ? { label: "Continue payroll checks", run: onContinue }
    : { label: "Open run controls", run: onContinue };

  return (
    <section className="p2-payroll-overview" aria-label="Payroll workflow overview" data-p2-payroll-state={view.currentStage}>
      <div className="p2-payroll-overview-head">
        <div className="p2-payroll-title">
          <span className="p2-payroll-icon" aria-hidden><WalletCards size={21} /></span>
          <div>
            <span className="p2-overline">CURRENT PAYROLL</span>
            <h2>{run.periodLabel}</h2>
            <p>{run.scopeLabel} · Payday {formatDate(run.payDate)} · {run.employeeCount} employees</p>
          </div>
        </div>
        <div className="p2-payroll-status">
          {view.preliminary && <span className="p2-preliminary">Preliminary figures</span>}
          <Status value={run.status} />
        </div>
      </div>

      <div className="p2-payroll-values">
        <div><span>Gross pay</span><strong>{view.grossPay == null ? "—" : moneyExact(view.grossPay)}</strong></div>
        <div><span>Employee deductions</span><strong>{view.employeeDeductions == null ? "—" : moneyExact(view.employeeDeductions)}</strong></div>
        <div className="p2-net"><span>{view.preliminary ? "Estimated net payouts" : "Net employee payouts"}</span><strong>{view.netPay == null ? "—" : moneyExact(view.netPay)}</strong></div>
        <div><span>Payroll exceptions</span><strong>{view.exceptionCount}</strong></div>
      </div>

      <ol className="p2-payroll-steps" aria-label="Payroll lifecycle">
        {view.stages.map((stage, index) => (
          <li className={"p2-payroll-step " + stage.state} key={stage.key} aria-current={stage.state === "current" ? "step" : undefined}>
            <span className="p2-payroll-step-dot" aria-hidden>{stage.state === "done" ? <Check size={15} /> : index + 1}</span>
            <div>
              <strong>{stage.label}</strong>
              <small>{stage.detail}</small>
            </div>
          </li>
        ))}
      </ol>

      <div className="p2-payroll-lower">
        <div className="p2-payroll-guidance" role="status">
          {view.released ? <ShieldCheck size={19} /> : view.exceptionCount || view.blockerCount ? <AlertTriangle size={19} /> : <Clock3 size={19} />}
          <div>
            <strong>{view.released ? "Release does not mean paid" : "What happens next"}</strong>
            <p>{view.message}</p>
            {view.released && <p className="p2-payout-note">Bank payout: {view.payoutLabel}. Payment submission and confirmed completion are separate events.</p>}
            {!view.released && view.blockerCount != null && view.blockerCount > 0 && (
              <p className="p2-blocker-note">{view.blockerCount} blocking release check{view.blockerCount === 1 ? "" : "s"} reported by the server.</p>
            )}
            {!view.released && view.blockerCount == null && <p className="p2-payout-note">Release checks are being loaded. No eligibility is implied until the server validates them.</p>}
          </div>
        </div>
        <div className="p2-payroll-actions">
          <button className="p2-primary" type="button" onClick={action.run}>{action.label}<ArrowRight size={17} /></button>
          {reviewNeeded && <button className="p2-quiet" type="button" onClick={onReviewExceptions}><AlertTriangle size={15}/> Review exceptions</button>}
          {!view.released && task?.status === "Pending" && canOpenApprovals && (
            <button className="p2-quiet" type="button" onClick={onOpenApprovals}><FileCheck2 size={15}/> Check approval</button>
          )}
        </div>
      </div>
      <p className="p2-payroll-disclaimer">These are stored run figures, not new calculations. Final approval, release and payout actions remain in the existing permission-checked workflows.</p>
    </section>
  );
}
