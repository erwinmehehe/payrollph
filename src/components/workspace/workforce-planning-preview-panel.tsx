"use client";

import type { RecoveryDraft } from "@/lib/workforce-recovery-draft";
import type { WorkforcePlanningPreview } from "@/lib/workforce-planning-preview";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency", currency: "PHP", minimumFractionDigits: 2,
});

type Recommendation = {
  requirementId: number;
  recommendations: Array<{
    rank: number;
    employeeId: number;
    employeeName: string;
    workloadRisk: "low" | "medium" | "high";
    reasons: string[];
  }>;
};

function costLabel(preview: WorkforcePlanningPreview) {
  if (preview.costStatus === "restricted") return "Restricted to People/Payroll";
  if (preview.costStatus === "incomplete") return "Unavailable — review pay evidence";
  return peso.format(preview.estimatedAdditionalBaseCost ?? 0);
}

function scenarioName(draft: RecoveryDraft) {
  return draft.mode === "balanced" ? "Balance planned hours" : "Maximize eligible coverage";
}

/** All inputs come from the existing role-scoped coverage API; no writes. */
export function WorkforcePlanningPreviewPanel({
  selected,
  alternative,
  selectedDraft,
  alternativeDraft,
  recommendations,
  worksites,
  shifts,
  readiness,
}: {
  selected: WorkforcePlanningPreview;
  alternative: WorkforcePlanningPreview;
  selectedDraft: RecoveryDraft;
  alternativeDraft: RecoveryDraft;
  recommendations: Recommendation[];
  worksites: Array<{ id: number; name: string; code: string }>;
  shifts: Array<{ id: number; name: string; code: string; startTime: string; endTime: string }>;
  readiness: { status: string; blockerCount: number; warningCount: number };
}) {
  const siteNames = new Map(worksites.map((site) => [site.id, site.code + " · " + site.name]));
  const shiftNames = new Map(shifts.map((shift) => [
    shift.id, shift.code + " " + shift.startTime + "–" + shift.endTime,
  ]));
  const recommended = new Map(recommendations.map((row) => [row.requirementId, row.recommendations]));
  const selectedNames = new Map<number, string[]>();
  for (const fill of selectedDraft.fills) {
    selectedNames.set(fill.requirementId, [
      ...(selectedNames.get(fill.requirementId) ?? []), fill.employeeName,
    ]);
  }
  const first = selected.rows.slice(0, 12);

  return (
    <section id="wfm-planning-preview" style={{ padding: "0 18px 18px" }}
      aria-label="Staffing and labor-cost planning comparison" data-wfm-planning-preview>
      <article className="card" style={{ margin: 0 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">Manager planning · read-only comparison</div>
            <h3>Compare staffing coverage and the base-pay estimate before staging</h3>
            <p>
              Current demand and eligible scheduled workers come from the workforce coverage engine.
              Both options use the same server-checked eligibility list; neither publishes a shift.
            </p>
          </div>
        </div>
        <div className="module-grid two" style={{ padding: "0 18px 18px" }}>
          {[{ draft: selectedDraft, projection: selected, active: true },
            { draft: alternativeDraft, projection: alternative, active: false }].map((scenario) => (
            <div className="card" style={{ margin: 0 }} key={scenario.draft.mode}>
              <div className="card-header">
                <div>
                  <div className="card-kicker">{scenario.active ? "Selected planning strategy" : "Alternative (comparison only)"}</div>
                  <h4>{scenarioName(scenario.draft)}</h4>
                </div>
              </div>
              <div style={{ padding: "0 18px 18px" }}>
                <p><strong>{scenario.projection.uncoveredBefore}</strong> uncovered staffing slot(s) now → <strong>{scenario.projection.uncoveredAfter}</strong> projected after the draft</p>
                <p><strong>{scenario.projection.proposedAssignments}</strong> suggested assignment(s) · {scenario.projection.unresolvedRequirements} requirement(s) still short</p>
                <p><strong>Estimated added base pay:</strong> {costLabel(scenario.projection)}</p>
                <small className="id">
                  {scenario.draft.avoidedConflictingAssignments} proposed shift conflict(s) avoided ·
                  {" "}{scenario.draft.missingWorkloadEvidence} worker(s) lacked complete workload evidence
                </small>
              </div>
            </div>
          ))}
        </div>
        <div className="notice notice-slate" style={{ margin: "0 18px 16px" }}>
          <span>
            <strong>Planning estimate, not payroll.</strong> Cost uses per-requirement existing
            scheduled/actual/workspace benchmark rates only when the People/Payroll cost permission
            and required pay evidence are present. It is not each proposed employee&apos;s wage.
            {" "}{selected.costingBoundary} Approval, premiums, overtime, night differential,
            statutory contributions and employee-specific pay must be recalculated before release.
          </span>
        </div>
        {readiness.status !== "ready" && (
          <div className="notice notice-amber" style={{ margin: "0 18px 16px" }} role="status">
            <span>
              Current roster readiness is <strong>{readiness.status}</strong>
              {" "}({readiness.blockerCount} blocker(s), {readiness.warningCount} warning(s)).
              Hypothetical coverage does not remove readiness gates or approve publishing.
            </span>
          </div>
        )}
        {selected.evidenceWarnings.map((warning) => (
          <div key={warning} className="notice notice-amber" role="alert"
            style={{ margin: "0 18px 12px" }}>{warning}</div>
        ))}
        {selected.rows.length === 0 ? (
          <div className="notice notice-slate" style={{ margin: "0 18px 16px" }}>
            <span>No recorded uncovered requirements for the selected planning period. Confirm requirements are complete before publishing.</span>
          </div>
        ) : (
          <>
            <div className="data-table-wrap slim-scroll" style={{ overflowX: "auto" }}>
              <table className="data-table" aria-label="Proposed staffing by uncovered requirement">
                <thead>
                  <tr>
                    <th scope="col">Date and worksite</th>
                    <th scope="col">Shift</th>
                    <th scope="col">Demand / eligible scheduled</th>
                    <th scope="col">Current gap</th>
                    <th scope="col">Proposed</th>
                    <th scope="col">Remaining gap</th>
                    <th scope="col">Additional base-pay estimate</th>
                  </tr>
                </thead>
                <tbody>
                  {first.map((row) => (
                    <tr key={row.requirementId}>
                      <td><strong>{row.workDate}</strong>
                        <span className="id" style={{ display: "block" }}>
                          {siteNames.get(row.worksiteId) ?? "Unresolved site"}
                        </span></td>
                      <td>{shiftNames.get(row.shiftDefinitionId) ?? "Unresolved shift"}</td>
                      <td>{row.requiredHeadcount} / {row.availableScheduledHeadcount}</td>
                      <td><strong>{row.baselineGap}</strong></td>
                      <td>
                        <strong>{row.proposedFills}</strong>
                        {(selectedNames.get(row.requirementId) ?? []).slice(0, 3).map((name, index) => (
                          <span className="id" key={row.requirementId + ":" + index}
                            style={{ display: "block" }}>{name}</span>
                        ))}
                        {(recommended.get(row.requirementId) ?? []).slice(0, 3).length > 0 && (
                          <details>
                            <summary className="id">Eligible alternatives (up to 3)</summary>
                            {(recommended.get(row.requirementId) ?? []).slice(0, 3).map((person) => (
                              <p className="id" key={person.employeeId}>
                                {person.rank}. {person.employeeName} · {person.workloadRisk} workload
                                <span style={{ display: "block" }}>{person.reasons.slice(0, 2).join("; ")}</span>
                              </p>
                            ))}
                          </details>
                        )}
                      </td>
                      <td>{row.projectedGap}</td>
                      <td>{selected.costStatus === "estimated" && row.estimatedAddedBaseCost !== null
                        ? peso.format(row.estimatedAddedBaseCost) : costLabel(selected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selected.rows.length > first.length && (
              <p className="id" style={{ padding: "8px 18px 0" }}>
                Showing the first {first.length} of {selected.rows.length} uncovered requirements.
                Review the complete coverage data below before staging.
              </p>
            )}
          </>
        )}
        <p className="id" style={{ padding: "10px 18px 18px" }}>
          Candidate eligibility is a snapshot from the last refresh. Managers must confirm schedule
          conflicts, leave, certifications, current worksite, workload limits and approval before
          assignments take effect. This comparison does not create or publish shifts.
        </p>
      </article>
    </section>
  );
}
