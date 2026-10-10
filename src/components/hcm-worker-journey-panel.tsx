"use client";

import type { HcmWorkerJourney, WorkerJourneyStage, WorkerJourneyState } from "@/lib/hcm-worker-journey";

const STATE_LABEL: Record<WorkerJourneyState, string> = {
  recorded: "Recorded",
  in_progress: "In progress",
  attention: "Review",
  not_recorded: "Not linked",
  not_applicable: "Not applicable",
  restricted: "Restricted",
};

const STATE_COLOR: Record<WorkerJourneyState, string> = {
  recorded: "var(--green, #207d59)",
  in_progress: "var(--amber, #ad7417)",
  attention: "var(--amber, #ad7417)",
  not_recorded: "inherit",
  not_applicable: "inherit",
  restricted: "inherit",
};

export function HcmWorkerJourneyPanel({
  journey,
  onPage,
}: {
  journey: HcmWorkerJourney;
  onPage: (page: WorkerJourneyStage["page"]) => void;
}) {
  return (
    <section aria-label="Connected employee journey evidence" style={{ marginTop: 18 }}>
      <div className="card-kicker">EMPLOYEE JOURNEY</div>
      <h3 style={{ fontSize: 14, margin: "4px 0 4px" }}>From hiring through final payroll and separation</h3>
      <p style={{ fontSize: 12, margin: "0 0 12px" }}>
        {journey.summary.recorded} of {journey.stages.length} milestones have linked completion evidence;
        {" "}{journey.summary.attention} need review, {journey.summary.inProgress} are in progress.
        Missing or restricted records are never counted as complete.
      </p>
      {journey.stages.map((item) => (
        <div className="payslip-line" key={item.id} style={{ gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "start" }}>
          <span style={{ minWidth: 0 }}>
            <strong style={{ display: "block", fontSize: 13 }}>{item.label}</strong>
            <em style={{ whiteSpace: "normal", overflowWrap: "anywhere", display: "block", marginTop: 3 }}>
              {item.detail}
            </em>
          </span>
          <span style={{ display: "flex", alignItems: "flex-end", flexDirection: "column", gap: 6 }}>
            <b style={{ fontSize: 12, color: STATE_COLOR[item.state], whiteSpace: "nowrap" }}>
              {STATE_LABEL[item.state]}
            </b>
            {item.state !== "restricted" && item.state !== "not_applicable" && (
              <button
                type="button"
                className="secondary-button"
                style={{ padding: "5px 8px", fontSize: 11 }}
                aria-label={`Open ${item.page} for ${item.label}`}
                onClick={() => onPage(item.page)}
              >
                Open {item.page}
              </button>
            )}
          </span>
        </div>
      ))}
      <div className="modal-note" style={{ marginTop: 12 }}>
        {journey.disclaimer}
      </div>
    </section>
  );
}
