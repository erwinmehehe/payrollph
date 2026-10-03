"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  Calculator,
  Check,
  FileCheck2,
  LockKeyhole,
  Send,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { buildOwnerReleaseSummary } from "@/lib/owner-release-summary";
import { derivePayrollPayoutState } from "@/lib/payroll-payout-state";
import type { DashboardData, PayrollEntry, PayrollRun, Task } from "./types";
import { Status, formatDate, money } from "./ui";

type ReleaseChecklistItem = {
  key: "inputs" | "attendance" | "calculation" | "exceptions" | "statutory" | "approval" | "bank";
  label: string;
  passed: boolean;
  blocking: boolean;
  acknowledgeable?: boolean;
  detail: string;
};

export function OwnerPayrollRelease({
  data,
  run,
  entries,
  checklist,
  relatedTask,
  busy,
  onRelease,
  onPage,
  onInspectPayroll,
}: {
  data: DashboardData;
  run: PayrollRun;
  entries: PayrollEntry[];
  checklist: ReleaseChecklistItem[] | null;
  relatedTask?: Task;
  busy: boolean;
  onRelease: () => void;
  onPage: (page: string) => void;
  onInspectPayroll: () => void;
}) {
  const summary = buildOwnerReleaseSummary({
    runStatus: run.status,
    grossPay: run.grossPay,
    netPay: run.netPay,
    entries,
    approvalStatus: relatedTask?.status,
    checklist,
  });
  const payout = derivePayrollPayoutState(data.auditEvents, run.id);
  const bankCheck = checklist?.find((item) => item.key === "bank");
  const checklistLoading = checklist == null;

  const bankReady = Boolean(bankCheck?.passed);
  const bankStatus = run.status === "Released"
    ? payout.bankFile.status === "generated"
      ? "Generated"
      : "Waiting"
    : bankReady
      ? "Ready after release"
      : "Blocked";

  const bankDetail = run.status === "Released"
    ? payout.bankFile.status === "generated"
      ? payout.bankFile.filename
        ? `${payout.bankFile.filename} · ${payout.bankFile.template ?? "bank template"}`
        : "Final bank file generated."
      : "Payroll is released. Generate the final bank file from Exports."
    : bankReady
      ? `Payout details are complete. ${data.templates.length ? `${data.templates.length} active bank template${data.templates.length === 1 ? "" : "s"} available.` : "Final bank export becomes available after release."}`
      : bankCheck?.detail ?? "Checking employee payout details.";

  const releaseLabel = summary.released
    ? "Payroll released"
    : !summary.checkerApproved
      ? "Waiting for checker"
      : summary.hardBlockers.length
        ? "Resolve blockers"
        : summary.acknowledgementItems.length
          ? "Review and release"
          : "Release payroll";

  return (
    <section className="owner-release-center" aria-label="Owner payroll release">
      <div className="owner-release-heading">
        <div>
          <div className="card-kicker">OWNER RELEASE</div>
          <h2>{run.periodLabel}</h2>
          <p>
            Confirm the independent checker, funding requirement and release controls before money-bearing payroll state is locked.
          </p>
        </div>
        <div className="owner-release-heading-status">
          <Status value={run.status} />
          <span>Pay date {formatDate(run.payDate)} · {run.employeeCount} employees</span>
        </div>
      </div>

      <div className="owner-release-money">
        <div>
          <span>Net salaries</span>
          <strong className="green-number">{money(summary.netPay)}</strong>
          <small>cash due to employees</small>
        </div>
        <div>
          <span>Employer statutory cost</span>
          <strong>{summary.employerStatutoryCost == null ? "—" : money(summary.employerStatutoryCost)}</strong>
          <small>
            {summary.employerStatutoryCost == null
              ? `calculation trace available for ${summary.employerCostCoverage}/${entries.length} entries`
              : "SSS + PhilHealth + Pag-IBIG employer share"}
          </small>
        </div>
        <div className="owner-release-funding">
          <span>Total funding requirement</span>
          <strong>{summary.totalFundingRequirement == null ? "—" : money(summary.totalFundingRequirement)}</strong>
          <small>gross payroll + employer statutory cost</small>
        </div>
      </div>

      <div className="owner-release-gates">
        <ReleaseGate
          icon={<ShieldCheck size={15} />}
          title="Checker approval"
          status={summary.checkerApproved ? "Approved" : summary.approvalStatus}
          good={summary.checkerApproved}
          detail={
            summary.checkerApproved
              ? `Independent review approved by ${relatedTask?.approver ?? "the assigned checker"}.`
              : relatedTask?.status === "Pending"
                ? `Waiting for ${relatedTask.approver} to complete independent review.`
                : relatedTask?.status === "Declined"
                  ? "Checker returned this payroll for correction."
                  : "This payroll has not received an approved checker decision."
          }
          action={!summary.checkerApproved ? (
            <button className="secondary-button" onClick={() => onPage("Approvals")}>Open approval</button>
          ) : undefined}
        />

        <ReleaseGate
          icon={<FileCheck2 size={15} />}
          title="Release controls"
          status={
            checklistLoading
              ? "Checking"
              : summary.hardBlockers.length
                ? `${summary.hardBlockers.length} blocked`
                : summary.acknowledgementItems.length
                  ? "Review required"
                  : "Clear"
          }
          good={!checklistLoading && summary.hardBlockers.length === 0 && summary.acknowledgementItems.length === 0}
          detail={
            checklistLoading
              ? "Loading the server-side release checklist and payroll assurance."
              : summary.hardBlockers.length
                ? summary.hardBlockers[0].detail
                : summary.acknowledgementItems.length
                  ? `${summary.acknowledgementItems.length} acknowledgeable exception item${summary.acknowledgementItems.length === 1 ? "" : "s"} remain for final sign-off.`
                  : "Calculation, statutory treatment, inputs and assurance controls are clear."
          }
          action={(summary.hardBlockers.length > 0 || summary.acknowledgementItems.length > 0) ? (
            <button className="secondary-button" onClick={onInspectPayroll}>Review controls</button>
          ) : undefined}
        />

        <ReleaseGate
          icon={<Banknote size={15} />}
          title="Bank / export readiness"
          status={bankStatus}
          good={bankReady || run.status === "Released"}
          detail={bankDetail}
          action={run.status === "Released" ? (
            <button className="secondary-button" onClick={() => onPage("Exports")}>Open exports</button>
          ) : !bankReady ? (
            <button className="secondary-button" onClick={() => onPage("People")}>Fix payout details</button>
          ) : undefined}
        />
      </div>

      {summary.hardBlockers.length > 0 && (
        <div className="owner-release-blockers">
          <div className="owner-release-blocker-heading">
            <AlertTriangle size={15} />
            <div>
              <strong>Release blockers</strong>
              <span>These are enforced again by the server when Release payroll is clicked.</span>
            </div>
          </div>
          {summary.hardBlockers.map((item) => (
            <div className="owner-release-blocker-row" key={item.key}>
              <span>{item.label}</span>
              <p>{item.detail}</p>
            </div>
          ))}
        </div>
      )}

      {summary.acknowledgementItems.length > 0 && summary.hardBlockers.length === 0 && !summary.released && (
        <div className="notice notice-amber owner-release-acknowledgement">
          <AlertTriangle size={15} />
          <span>
            <strong>Final sign-off required.</strong>{" "}
            {summary.acknowledgementItems.map((item) => item.label).join(" · ")} will be shown again in the release confirmation and recorded with the release.
          </span>
        </div>
      )}

      <div className="owner-release-actionbar">
        <div className="owner-release-authority">
          <LockKeyhole size={14} />
          <span>
            Release requires Owner/Admin authority and MFA. Payroll makers cannot release their own run.
          </span>
        </div>
        {summary.released ? (
          <span className="owner-release-complete"><Check size={14} /> Released and locked</span>
        ) : (
          <button
            className="primary-button brand owner-release-button"
            disabled={busy || checklistLoading || !summary.canRelease}
            onClick={onRelease}
          >
            <Send size={14} /> {releaseLabel}
          </button>
        )}
      </div>

      <div className="owner-release-footnote">
        <Calculator size={13} />
        <span>
          Funding requirement is a planning total: gross payroll plus the employer SSS, PhilHealth and Pag-IBIG cost stored by the payroll calculation. Net salaries are shown separately for payout.
        </span>
        <WalletCards size={13} />
        <span>
          Final bank files remain post-release artifacts, so payout destinations are checked now and the immutable bank export is generated after release.
        </span>
      </div>
    </section>
  );
}

function ReleaseGate({
  icon,
  title,
  status,
  good,
  detail,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  status: string;
  good: boolean;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <article className="owner-release-gate" data-good={good ? "true" : "false"}>
      <div className="owner-release-gate-icon">{icon}</div>
      <div>
        <div className="owner-release-gate-title">
          <strong>{title}</strong>
          <span>{good ? <BadgeCheck size={11} /> : <AlertTriangle size={11} />}{status}</span>
        </div>
        <p>{detail}</p>
      </div>
      {action && <div className="owner-release-gate-action">{action}</div>}
    </article>
  );
}
