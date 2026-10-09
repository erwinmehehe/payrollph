"use client";

import { useState } from "react";
import { ClipboardCopy, ClipboardCheck, ListChecks } from "lucide-react";
import {
  buildHcmGovernanceWorklist,
  formatHcmGovernanceWorklist,
  type HcmWorklistInput,
} from "@/lib/hcm-governance-worklist";

const INITIAL_VISIBLE_ITEMS = 6;

/**
 * A client-side view over the existing company-scoped aggregate dashboard.
 * It never requests row-level data, modifies an employee or uploads a report.
 */
export function HcmGovernanceWorklistPanel({ report }: { report: HcmWorklistInput }) {
  const [showAll, setShowAll] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "unavailable">("idle");
  const plan = buildHcmGovernanceWorklist(report);
  const visible = showAll ? plan.tasks : plan.tasks.slice(0, INITIAL_VISIBLE_ITEMS);
  const remaining = plan.tasks.length - visible.length;

  async function copyReviewPlan() {
    try {
      // Explicit click only; no background clipboard writes or external APIs.
      await navigator.clipboard.writeText(formatHcmGovernanceWorklist(plan));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("unavailable");
    }
  }

  return (
    <section style={{ marginTop: 14 }} aria-label="HCM aggregate remediation worklist">
      <div className="card-header" style={{ padding: 0, marginBottom: 9 }}>
        <div>
          <div className="card-kicker">SUGGESTED HR REVIEW WORKLIST</div>
          <h3 style={{ fontSize: 14, margin: "4px 0" }}>Turn aggregate signals into a review plan</h3>
          <p>
            {plan.highCount} high-priority categories, {plan.policyReviewCount} policy coverage checks.
            Reviewer roles are suggestions only. No employee-specific case, approval, or change is created here.
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void copyReviewPlan()}
          disabled={plan.tasks.length === 0}
          aria-label="Copy anonymous HCM governance review checklist"
        >
          {copyStatus === "copied" ? <ClipboardCheck size={14} /> : <ClipboardCopy size={14} />}
          {copyStatus === "copied" ? "Checklist copied" : "Copy review checklist"}
        </button>
      </div>
      <p aria-live="polite" style={{ fontSize: 12, margin: "4px 0 10px" }}>
        {copyStatus === "unavailable"
          ? "Clipboard access was blocked by your browser. No data was sent or saved."
          : copyStatus === "copied"
            ? "Only aggregate categories, counts, and suggested next steps were copied. No employee or bank details were included."
            : "Use the list to assign documented reviews through your existing HR task process."}
      </p>
      {plan.tasks.length === 0 ? (
        <div className="notice notice-blue">
          <ListChecks size={16} />
          <span>
            No aggregate review tasks were generated. This does not certify worker records,
            individual policy coverage, final-pay settlement, or statutory compliance.
          </span>
        </div>
      ) : (
        <>
          <ol style={{ paddingLeft: 21, margin: "8px 0 12px" }}>
            {visible.map(task => (
              <li key={task.key} style={{ marginBottom: 12, paddingLeft: 4 }}>
                <strong>{task.priority === "High" ? "Review first" : "Follow-up review"}: {task.title}</strong>
                <small style={{ display: "block", marginTop: 3 }}>
                  {task.matches == null
                    ? "Verify policy and supervisory scope; not a finding of noncompliance"
                    : String(task.matches) + " aggregate matches (may overlap other categories)"}
                  {" · Suggested reviewer: "}{task.suggestedReviewer}
                </small>
                <p style={{ margin: "4px 0 0" }}>{task.direction}</p>
              </li>
            ))}
          </ol>
          {remaining > 0 && (
            <button type="button" className="secondary-button" onClick={() => setShowAll(true)}>
              Show {remaining} more review tasks
            </button>
          )}
          {showAll && plan.tasks.length > INITIAL_VISIBLE_ITEMS && (
            <button type="button" className="secondary-button" onClick={() => setShowAll(false)}>
              Show fewer tasks
            </button>
          )}
        </>
      )}
      <small style={{ display: "block", marginTop: 8, color: "var(--muted)" }}>
        Not a case queue or completed-work tracker. Evidence must be investigated and recorded
        through authorized HR/payroll procedures. Counts are not unique employee totals.
      </small>
    </section>
  );
}
