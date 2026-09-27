"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Calendar, Check, Clock, FileText, Gavel, Plus, Shield, User, X } from "lucide-react";

type DisciplinaryCase = {
  id: number;
  caseNumber: string;
  employeeName: string;
  employeeNo: string;
  employeeTitle: string;
  offense: string;
  incidentDate: string;
  status: string;
  nteIssuedAt: string;
  nteDetails: string;
  employeeExplanation: string;
  explanationSubmittedAt: string;
  hearingDate: string;
  nodIssuedAt: string;
  nodDecision: string;
  penalty: string;
};

const OFFENSES = [
  "Habitual Tardiness & Undertime (Art. 297 Labor Code)",
  "Gross and Habitual Neglect of Duties",
  "Serious Misconduct or Insubordination",
  "Fraud or Willful Breach of Trust",
  "Unauthorized Absence (AWOL)",
  "Commission of a Crime or Offense against Co-workers",
  "Breach of Confidentiality / Security Policy",
  "Violation of Code of Conduct Section 4.2",
];

const PENALTIES = [
  "Written Warning",
  "Written Reprimand",
  "Suspension (1 to 3 Days)",
  "Suspension (4 to 15 Days)",
  "Suspension (16 to 30 Days)",
  "Termination with Cause (Art. 297)",
  "Exonerated / Case Dismissed",
];

export function DisciplinePanel({ organizationId, setNotice }: { organizationId: number; setNotice: (m: string) => void }) {
  const [cases, setCases] = useState<DisciplinaryCase[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showNteModal, setShowNteModal] = useState(false);
  const [activeCase, setActiveCase] = useState<DisciplinaryCase | null>(null);
  const [actionModal, setActionModal] = useState<"explain" | "hearing" | "nod" | null>(null);

  const [formNte, setFormNte] = useState({
    employeeId: "",
    offense: "Habitual Tardiness & Undertime (Art. 297 Labor Code)",
    incidentDate: new Date().toISOString().slice(0, 10),
    nteDetails: "",
  });

  const [explanationText, setExplanationText] = useState("");
  const [hearingDateStr, setHearingDateStr] = useState("");
  const [nodDecisionText, setNodDecisionText] = useState("");
  const [selectedPenalty, setSelectedPenalty] = useState("Written Warning");

  async function load() {
    const [caseRes, empRes] = await Promise.all([
      fetch(`/api/discipline?organizationId=${organizationId}`, { cache: "no-store" }),
      fetch(`/api/employees?organizationId=${organizationId}`, { cache: "no-store" }),
    ]);
    if (caseRes.ok) {
      const data = await caseRes.json();
      setCases(data.cases ?? []);
    }
    if (empRes.ok) {
      setEmployees(await empRes.json());
    }
    setLoaded(true);
  }

  useEffect(() => {
    void load();
  }, [organizationId]);

  async function issueNte(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/discipline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...formNte,
        organizationId,
        employeeId: Number(formNte.employeeId),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setNotice(data.error ?? "Failed to issue NTE.");
      return;
    }
    setNotice("Notice to Explain (NTE) formally issued. Employee given minimum 5 calendar days to respond.");
    setShowNteModal(false);
    setFormNte({ employeeId: "", offense: OFFENSES[0], incidentDate: new Date().toISOString().slice(0, 10), nteDetails: "" });
    await load();
  }

  async function submitAction(caseId: number, action: "submit_explanation" | "schedule_hearing" | "issue_nod") {
    let bodyPayload: any = { id: caseId, action };
    if (action === "submit_explanation") {
      bodyPayload.employeeExplanation = explanationText;
    } else if (action === "schedule_hearing") {
      bodyPayload.hearingDate = hearingDateStr;
    } else if (action === "issue_nod") {
      bodyPayload.nodDecision = nodDecisionText;
      bodyPayload.penalty = selectedPenalty;
    }

    const res = await fetch("/api/discipline", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload),
    });
    const data = await res.json();
    if (!res.ok) {
      setNotice(data.error ?? "Failed to update disciplinary action.");
      return;
    }
    setNotice(`Disciplinary step saved: ${action.replace("_", " ")}`);
    setActionModal(null);
    setActiveCase(null);
    setExplanationText("");
    setHearingDateStr("");
    setNodDecisionText("");
    await load();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Disciplinary Actions &amp; DOLE Due Process</h2>
          <p className="heading-copy">Twin-Notice Rule compliance: Notice to Explain (NTE) &rarr; Explanation &rarr; Hearing &rarr; Notice of Decision (NOD).</p>
        </div>
        <button className="primary-button" onClick={() => setShowNteModal(true)}>
          <Plus size={15} /> Issue Notice to Explain (NTE)
        </button>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="stat-card">
          <div className="stat-icon orange"><AlertCircle size={19} /></div>
          <p>NTE ISSUED</p>
          <h3>{cases.filter((c) => c.status === "nte_issued").length}</h3>
          <span>Awaiting response (5d rule)</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon purple"><FileText size={19} /></div>
          <p>EXPLANATIONS IN</p>
          <h3>{cases.filter((c) => c.status === "explanation_submitted").length}</h3>
          <span>Ready for hearing review</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon blue"><Calendar size={19} /></div>
          <p>HEARINGS SET</p>
          <h3>{cases.filter((c) => c.status === "hearing_scheduled").length}</h3>
          <span>Conferences scheduled</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon mint"><Gavel size={19} /></div>
          <p>DECISIONS ISSUED</p>
          <h3>{cases.filter((c) => c.status === "nod_issued" || c.status === "closed").length}</h3>
          <span>Formal NOD rendered</span>
        </article>
      </div>

      {showNteModal && (
        <article className="card" style={{ padding: 20, marginBottom: 18, border: "1.5px solid var(--amber-border)" }}>
          <div className="card-header" style={{ padding: 0, marginBottom: 14 }}>
            <div>
              <div className="card-kicker" style={{ color: "var(--amber)" }}>LEGAL DUE PROCESS · STEP 1</div>
              <h2 style={{ margin: 0 }}>Draft Notice to Explain (NTE)</h2>
              <p>State specific acts or omissions, rules breached, and require written response within 5 calendar days.</p>
            </div>
            <button className="icon-button" onClick={() => setShowNteModal(false)}><X size={16} /></button>
          </div>
          <form onSubmit={issueNte}>
            <div className="setting-form">
              <label>Respondent Employee
                <select required value={formNte.employeeId} onChange={(e) => setFormNte({ ...formNte, employeeId: e.target.value })}>
                  <option value="">Select Employee…</option>
                  {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName} ({emp.employeeNo})</option>)}
                </select>
              </label>
              <label>Alleged Violation / Labor Code Ground
                <select value={formNte.offense} onChange={(e) => setFormNte({ ...formNte, offense: e.target.value })}>
                  {OFFENSES.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label>Incident Date
                <input required type="date" value={formNte.incidentDate} onChange={(e) => setFormNte({ ...formNte, incidentDate: e.target.value })} />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>Specific Allegations &amp; Evidence Summary
                <textarea
                  required
                  rows={3}
                  placeholder="Detail the dates, times, attendance logs, or witnesses. Citing Company Code of Conduct Section..."
                  value={formNte.nteDetails}
                  onChange={(e) => setFormNte({ ...formNte, nteDetails: e.target.value })}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--line)", fontSize: 12 }}
                />
              </label>
            </div>
            <div className="notice notice-amber" style={{ margin: "10px 0" }}>
              <span><strong>Labor Code King of Kings doctrine:</strong> The first notice must apprise the employee with particularity of the specific acts or omissions complained of.</span>
            </div>
            <div className="run-actions">
              <button type="button" className="secondary-button" onClick={() => setShowNteModal(false)}>Cancel</button>
              <button className="primary-button">Formally Issue NTE</button>
            </div>
          </form>
        </article>
      )}

      {/* Action modal for Explanation, Hearing, NOD */}
      {actionModal && activeCase && (
        <article className="card" style={{ padding: 20, marginBottom: 18, background: "#fafcfa", border: "1.5px solid var(--green-border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div className="card-kicker">CASE {activeCase.caseNumber}</div>
              <h3 style={{ margin: 0, fontSize: 16 }}>{activeCase.employeeName} · {activeCase.offense}</h3>
            </div>
            <button className="icon-button" onClick={() => { setActionModal(null); setActiveCase(null); }}><X size={16} /></button>
          </div>

          {actionModal === "explain" && (
            <div>
              <p style={{ fontSize: 12, color: "var(--muted)" }}>Record the employee&apos;s written response to the allegations:</p>
              <textarea
                rows={4}
                required
                placeholder="Enter written explanation submitted by employee..."
                value={explanationText}
                onChange={(e) => setExplanationText(e.target.value)}
                style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--line)", fontSize: 12, marginBottom: 10 }}
              />
              <button className="primary-button" onClick={() => submitAction(activeCase.id, "submit_explanation")}>Save Written Explanation</button>
            </div>
          )}

          {actionModal === "hearing" && (
            <div>
              <p style={{ fontSize: 12, color: "var(--muted)" }}>Schedule an administrative conference to allow the employee to be heard:</p>
              <label className="input-label">Hearing Date &amp; Time
                <input type="datetime-local" value={hearingDateStr} onChange={(e) => setHearingDateStr(e.target.value)} />
              </label>
              <div style={{ marginTop: 10 }}>
                <button className="primary-button" onClick={() => submitAction(activeCase.id, "schedule_hearing")}>Confirm Hearing Schedule</button>
              </div>
            </div>
          )}

          {actionModal === "nod" && (
            <div>
              <p style={{ fontSize: 12, color: "var(--muted)" }}>Legal Due Process Step 2: Notice of Decision (NOD):</p>
              <div className="setting-form" style={{ padding: 0, marginBottom: 10 }}>
                <label>Penalty Decision
                  <select value={selectedPenalty} onChange={(e) => setSelectedPenalty(e.target.value)}>
                    {PENALTIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label style={{ gridColumn: "1 / -1" }}>Findings &amp; Rationale
                  <textarea
                    rows={3}
                    placeholder="Findings of the committee, considered circumstances, and conclusion..."
                    value={nodDecisionText}
                    onChange={(e) => setNodDecisionText(e.target.value)}
                    style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--line)", fontSize: 12 }}
                  />
                </label>
              </div>
              <button className="primary-button" onClick={() => submitAction(activeCase.id, "issue_nod")}>Formally Render Notice of Decision</button>
            </div>
          )}
        </article>
      )}

      <article className="card table-card">
        <div className="table-toolbar">
          <div><div className="card-kicker">DISCIPLINARY CASES</div><h2>Case Docket</h2></div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>CASE NO</th>
                <th>RESPONDENT</th>
                <th>ALLEGED OFFENSE</th>
                <th>INCIDENT DATE</th>
                <th>STATUS</th>
                <th>DECISION / PENALTY</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {cases.length === 0 && <tr><td colSpan={7}><div className="empty-state">No disciplinary cases on record. All teams in compliance.</div></td></tr>}
              {cases.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.caseNumber}</strong></td>
                  <td><strong>{c.employeeName}</strong><small style={{ display: "block", color: "var(--muted)" }}>{c.employeeTitle}</small></td>
                  <td><span style={{ fontSize: 11 }}>{c.offense}</span></td>
                  <td>{c.incidentDate}</td>
                  <td><span className={`status status-${c.status === "nod_issued" ? "verified" : c.status === "nte_issued" ? "needs-review" : "draft"}`}>{c.status.replace("_", " ")}</span></td>
                  <td><strong>{c.penalty}</strong></td>
                  <td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {c.status === "nte_issued" && (
                        <button className="secondary-button" style={{ height: 26, fontSize: 10, padding: "0 6px" }} onClick={() => { setActiveCase(c); setActionModal("explain"); }}>
                          + Defense
                        </button>
                      )}
                      {(c.status === "nte_issued" || c.status === "explanation_submitted") && (
                        <button className="secondary-button" style={{ height: 26, fontSize: 10, padding: "0 6px" }} onClick={() => { setActiveCase(c); setActionModal("hearing"); }}>
                          + Hearing
                        </button>
                      )}
                      {c.status !== "nod_issued" && c.status !== "closed" && (
                        <button className="primary-button" style={{ height: 26, fontSize: 10, padding: "0 6px" }} onClick={() => { setActiveCase(c); setActionModal("nod"); }}>
                          Issue NOD
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}
