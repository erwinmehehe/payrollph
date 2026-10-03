"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  BookOpenCheck,
  Check,
  ChevronRight,
  CircleDollarSign,
  FileCheck2,
  Landmark,
  LockKeyhole,
  ReceiptText,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import type { DashboardData, Notify, PayrollRun } from "./types";
import { Status, formatDate, money } from "./ui";

type CloseEvidence = {
  agency: string;
  form: string;
  kind: string;
  periodType: string;
  status: string;
  proven: boolean;
  reference: string | null;
  submittedAt: string | null;
  note: string | null;
};

type ClosePayload = {
  run: PayrollRun;
  state: {
    released: boolean;
    payoutCompleted: boolean;
    journalExported: boolean;
    liabilitiesReady: boolean;
    filingEvidenceComplete: boolean;
    requiresFilingEvidenceAcknowledgement: boolean;
    closed: boolean;
    closedAt: string | null;
    hardBlockers: string[];
    canClose: boolean;
  };
  payout: {
    bankFile: { status: "waiting" | "generated"; filename: string | null };
    payout: {
      status: "waiting-for-file" | "ready" | "submitted" | "completed";
      label: string;
      reference: string | null;
      method: string | null;
      completedAt: string | null;
    };
  };
  liabilities: {
    sss: number;
    philHealth: number;
    pagIbig: number;
    birWithholding: number;
    governmentLoans: number;
    totalStatutoryLiabilities: number;
    netPayroll: number;
    employerStatutoryExpense: number;
  } | null;
  liabilityError: string | null;
  filingEvidence: CloseEvidence[];
  journal: {
    exported: boolean;
    exportedAt: string | null;
    filename: string | null;
  };
  governmentExports: Array<{ id: number; createdAt: string; template: string; filename: string }>;
  closeEvent: {
    id: number;
    actor: string;
    createdAt: string;
  } | null;
};

export function BookkeeperPayrollClose({
  data,
  run,
  notify,
  onRefresh,
  onExportJournal,
}: {
  data: DashboardData;
  run: PayrollRun;
  notify: Notify;
  onRefresh: () => Promise<void>;
  onExportJournal: () => Promise<void>;
}) {
  const [payload, setPayload] = useState<ClosePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [ackEvidence, setAckEvidence] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch("/api/payroll-runs/" + run.id + "/close", { cache: "no-store" })
      .then(async (response) => ({ ok: response.ok, payload: await response.json().catch(() => ({})) }))
      .then(({ ok, payload: next }) => {
        if (!alive) return;
        if (!ok) {
          setPayload(null);
          setLoadError(next.error ?? "Payroll close status could not be loaded.");
          return;
        }
        setPayload(next);
        setLoadError("");
      })
      .catch(() => {
        if (!alive) return;
        setPayload(null);
        setLoadError("Payroll close status could not be loaded because the server could not be reached.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [run.id, data.auditEvents.length, reloadKey]);

  async function closePayroll() {
    if (!payload) return;
    setClosing(true);
    try {
      const response = await fetch("/api/payroll-runs/" + run.id + "/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmed: confirmClose,
          acknowledgeFilingEvidenceGaps: ackEvidence,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(body.error ?? "Payroll close could not be completed.", "err");
        setReloadKey((key) => key + 1);
        return;
      }
      notify(body.alreadyClosed ? "This payroll was already closed." : "Payroll close recorded in the audit trail.", "ok");
      setConfirmClose(false);
      setAckEvidence(false);
      await onRefresh();
      setReloadKey((key) => key + 1);
    } catch {
      notify("Payroll close could not be completed because the server could not be reached.", "err");
    } finally {
      setClosing(false);
    }
  }

  function scrollTo(selector: string) {
    document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (loading) {
    return (
      <section className="bookkeeper-close-center" aria-label="Bookkeeper payroll close">
        <div className="bookkeeper-close-loading">Loading payroll close controls…</div>
      </section>
    );
  }

  if (!payload) {
    return (
      <section className="bookkeeper-close-center" aria-label="Bookkeeper payroll close">
        <div className="notice notice-red" style={{ margin: 0 }}>
          <AlertTriangle size={15} />
          <span>{loadError || "Payroll close status is unavailable."}</span>
        </div>
      </section>
    );
  }

  const evidenceProven = payload.filingEvidence.filter((item) => item.proven).length;
  const evidenceGaps = payload.filingEvidence.filter((item) => !item.proven);
  const closeEnabled =
    payload.state.canClose
    && confirmClose
    && (!payload.state.requiresFilingEvidenceAcknowledgement || ackEvidence);

  return (
    <section className="bookkeeper-close-center" aria-label="Bookkeeper payroll close">
      <div className="bookkeeper-close-heading">
        <div>
          <div className="card-kicker">PAYROLL CLOSE</div>
          <h2>{payload.state.closed ? "Payroll closed." : "Finish the accounting close."}</h2>
          <p>
            {run.periodLabel} · reconcile payout, export the balanced journal, review statutory liabilities and preserve filing evidence.
          </p>
        </div>
        <div className="bookkeeper-close-heading-status">
          <Status value={payload.state.closed ? "Closed" : payload.state.canClose ? "Ready to close" : "In progress"} />
          <span>{payload.state.closedAt ? "Closed " + formatDate(payload.state.closedAt) : "Pay date " + formatDate(run.payDate)}</span>
        </div>
      </div>

      {payload.liabilities && (
        <div className="bookkeeper-close-liabilities">
          <div>
            <span>SSS liability</span>
            <strong>{money(payload.liabilities.sss)}</strong>
            <small>employee + employer + EC for this journal</small>
          </div>
          <div>
            <span>PhilHealth liability</span>
            <strong>{money(payload.liabilities.philHealth)}</strong>
            <small>employee + employer share</small>
          </div>
          <div>
            <span>Pag-IBIG liability</span>
            <strong>{money(payload.liabilities.pagIbig)}</strong>
            <small>mandatory + voluntary + employer</small>
          </div>
          <div>
            <span>BIR withholding</span>
            <strong>{money(payload.liabilities.birWithholding)}</strong>
            <small>compensation tax payable for this cutoff</small>
          </div>
        </div>
      )}

      <div className="bookkeeper-close-steps">
        <CloseStep
          no={1}
          icon={<WalletCards size={14} />}
          title="Payout confirmed"
          done={payload.state.payoutCompleted}
          current={payload.state.released && !payload.state.payoutCompleted}
          detail={
            payload.state.payoutCompleted
              ? payload.payout.payout.label + (payload.payout.payout.reference ? " · Ref " + payload.payout.payout.reference : "")
              : run.status !== "Released"
                ? "Owner must release payroll before payout can be reconciled."
                : "Waiting for bank confirmation or provider settlement. Bookkeepers cannot self-confirm money movement."
          }
          action={!payload.state.payoutCompleted && run.status === "Released" ? (
            <button className="secondary-button" onClick={() => scrollTo("[data-payout-operations]")}>Review payout</button>
          ) : undefined}
        />

        <CloseStep
          no={2}
          icon={<BookOpenCheck size={14} />}
          title="Journal exported"
          done={payload.state.journalExported}
          current={payload.state.payoutCompleted && !payload.state.journalExported}
          detail={
            payload.state.journalExported
              ? (payload.journal.filename || "Accounting journal") + " exported" + (payload.journal.exportedAt ? " on " + formatDate(payload.journal.exportedAt) : "") + "."
              : "Export the final balanced payroll journal for Xero / QuickBooks."
          }
          action={!payload.state.journalExported && run.status === "Released" ? (
            <button className="secondary-button" onClick={() => void onExportJournal()}>Export journal</button>
          ) : undefined}
        />

        <CloseStep
          no={3}
          icon={<CircleDollarSign size={14} />}
          title="Statutory liabilities prepared"
          done={payload.state.liabilitiesReady}
          current={payload.state.journalExported && !payload.state.liabilitiesReady}
          detail={
            payload.state.liabilitiesReady && payload.liabilities
              ? "SSS, PhilHealth, Pag-IBIG and BIR total " + money(payload.liabilities.totalStatutoryLiabilities) + " in this cutoff journal."
              : payload.liabilityError ?? "Liabilities are prepared from the same balanced journal builder."
          }
        />

        <CloseStep
          no={4}
          icon={<FileCheck2 size={14} />}
          title="Filing evidence reviewed"
          done={payload.state.filingEvidenceComplete}
          current={payload.state.liabilitiesReady && !payload.state.filingEvidenceComplete}
          detail={
            payload.state.filingEvidenceComplete
              ? "Current-format agency acceptance evidence is recorded for all tracked forms."
              : evidenceProven + " of " + payload.filingEvidence.length + " tracked filing formats have current acceptance evidence. Agency periods differ from this semi-monthly cutoff, so gaps must be acknowledged rather than falsely marked filed."
          }
          action={!payload.state.filingEvidenceComplete ? (
            <button className="secondary-button" onClick={() => scrollTo("[data-filing-evidence-section]")}>Review evidence</button>
          ) : undefined}
        />

        <CloseStep
          no={5}
          icon={<ReceiptText size={14} />}
          title="Close payroll"
          done={payload.state.closed}
          current={!payload.state.closed && payload.state.canClose}
          detail={
            payload.state.closed
              ? "Accounting close recorded by " + (payload.closeEvent?.actor ?? "an authorized user") + ". The released payroll remains immutable."
              : payload.state.hardBlockers.length
                ? payload.state.hardBlockers[0]
                : "Record the accounting close with payout, journal, liabilities and filing-evidence state attached."
          }
        />
      </div>

      {evidenceGaps.length > 0 && !payload.state.closed && (
        <div className="bookkeeper-close-evidence">
          <div className="bookkeeper-close-evidence-title">
            <ShieldCheck size={14} />
            <div>
              <strong>Filing evidence still open</strong>
              <span>These are evidence gaps, not claims that the payroll calculation is wrong.</span>
            </div>
          </div>
          <div className="bookkeeper-close-evidence-list">
            {payload.filingEvidence.map((item) => (
              <div key={item.agency + "-" + item.form} data-proven={item.proven ? "true" : "false"}>
                <span>{item.agency} {item.form}</span>
                <strong>{item.proven ? "Accepted file evidence" : item.status}</strong>
              </div>
            ))}
          </div>
          <label className="bookkeeper-close-check">
            <input
              type="checkbox"
              checked={ackEvidence}
              onChange={(event) => setAckEvidence(event.target.checked)}
            />
            <span>
              I reviewed the outstanding filing evidence. Closing this cutoff records the accounting close only and does not claim the agencies accepted or received anything that is not evidenced above.
            </span>
          </label>
        </div>
      )}

      {!payload.state.closed && (
        <div className="bookkeeper-close-actionbar">
          <label className="bookkeeper-close-check">
            <input
              type="checkbox"
              checked={confirmClose}
              onChange={(event) => setConfirmClose(event.target.checked)}
            />
            <span>I reviewed the completed payout, balanced journal, statutory liabilities and filing-evidence status for this payroll.</span>
          </label>
          <button
            className="primary-button brand bookkeeper-close-button"
            disabled={closing || !closeEnabled}
            onClick={() => void closePayroll()}
          >
            <LockKeyhole size={14} /> {closing ? "Closing…" : "Close payroll"}
          </button>
        </div>
      )}

      {payload.state.closed && (
        <div className="bookkeeper-close-complete">
          <BadgeCheck size={16} />
          <div>
            <strong>Accounting close recorded</strong>
            <span>
              This is an audited close marker. It does not replace agency filing acknowledgements or change the payroll run from Released.
            </span>
          </div>
        </div>
      )}

      <div className="bookkeeper-close-footnote">
        <Landmark size={13} />
        <span>Government liabilities shown here are cutoff-level accounting liabilities from the balanced payroll journal. Filing/remittance periods can span different payroll cutoffs.</span>
        <Check size={13} />
        <span>Close is idempotent: once the audit marker exists, the workflow reports it as closed instead of creating a second close record.</span>
      </div>
    </section>
  );
}

function CloseStep({
  no,
  icon,
  title,
  done,
  current,
  detail,
  action,
}: {
  no: number;
  icon: React.ReactNode;
  title: string;
  done: boolean;
  current: boolean;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <article className="bookkeeper-close-step" data-state={done ? "done" : current ? "current" : "pending"}>
      <span className="bookkeeper-close-step-no">{done ? <Check size={12} /> : no}</span>
      <span className="bookkeeper-close-step-icon">{icon}</span>
      <div>
        <div className="bookkeeper-close-step-title">
          <strong>{title}</strong>
          <span>{done ? "Complete" : current ? "Current" : "Pending"}</span>
        </div>
        <p>{detail}</p>
      </div>
      {action && <div className="bookkeeper-close-step-action">{action}<ChevronRight size={13} /></div>}
    </article>
  );
}
