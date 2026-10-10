"use client";

import { useMemo, useState } from "react";
import type { HcmWorkerJourney, WorkerJourneyStage } from "@/lib/hcm-worker-journey";
import { buildHcmJourneyActionPlan } from "@/lib/hcm-journey-action-plan";

const PRIORITY_LABEL = {
  review: "Needs review",
  follow_up: "Follow up",
  source_check: "Source check",
} as const;

/** Read-only suggestions: buttons only navigate to governed modules. */
export function HcmWorkerJourneyActions({
  journey,
  onPage,
}: {
  journey: HcmWorkerJourney;
  onPage: (page: WorkerJourneyStage["page"]) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const plan = useMemo(() => buildHcmJourneyActionPlan(journey), [journey]);
  const shown = showAll ? plan.actions : plan.actions.slice(0, 4);

  return (
    <section aria-label="Employee journey next actions" style={{ marginTop: 18 }}>
      <div className="card-kicker">NEXT HCM ACTIONS</div>
      <h3 style={{ fontSize: 14, margin: "4px 0 4px" }}>Review what needs attention next</h3>
      <p style={{ fontSize: 12, margin: "0 0 12px" }}>
        {plan.summary.review} requiring review, {plan.summary.followUp} in progress,
        {" "}{plan.summary.sourceCheck} optional record checks.
        Suggestions do not perform approvals or automatically change employee records.
      </p>

      {plan.actions.length === 0 ? (
        <div className="notice notice-slate" style={{ margin: 0 }}>
          No source-linked next actions are identified for the stages you can access.
          This is not a compliance or settlement certification.
        </div>
      ) : (
        <>
          {shown.map((action) => (
            <div
              key={action.stageId}
              className="payslip-line"
              style={{ gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "start" }}
            >
              <span style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 13, display: "block" }}>{action.title}</strong>
                <em style={{ whiteSpace: "normal", overflowWrap: "anywhere", display: "block", marginTop: 3 }}>
                  {PRIORITY_LABEL[action.priority]} · {action.responsibleTeam}
                </em>
                <small style={{ display: "block", marginTop: 4 }}>{action.instruction}</small>
              </span>
              <button
                type="button"
                className="secondary-button"
                style={{ padding: "5px 8px", fontSize: 11 }}
                aria-label={"Open " + action.page + " to review " + action.stageLabel}
                onClick={() => onPage(action.page)}
              >
                Open {action.page}
              </button>
            </div>
          ))}
          {plan.actions.length > 4 && (
            <button type="button" className="secondary-button" onClick={() => setShowAll((value) => !value)}>
              {showAll ? "Show fewer" : "Show all " + plan.actions.length + " next actions"}
            </button>
          )}
        </>
      )}
      <div className="modal-note" style={{ marginTop: 12 }}>{plan.disclaimer}</div>
    </section>
  );
}
