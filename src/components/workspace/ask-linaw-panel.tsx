"use client";

import { useMemo, useState } from "react";
import { MessageSquareText, Search, ShieldCheck } from "lucide-react";
import type { DashboardData } from "./types";
import { Status } from "./ui";

type Answer = {
  intent: string;
  title: string;
  answer: string;
  evidence: Array<{ label: string; value: string; source: string }>;
  limitations?: string;
  supportedPrompts?: readonly string[];
};

const DEFAULT_PROMPTS = [
  "What is blocking this payroll from release?",
  "Why did this employee's net pay change?",
  "Are our SSS, PhilHealth and Pag-IBIG remittances confirmed?",
  "Which government filing formats have accepted evidence?",
  "Which approved compliance rules are effective today?",
];

export function AskLinawPanel({
  data,
  setNotice,
}: {
  data: DashboardData;
  setNotice: (message: string) => void;
}) {
  const [question, setQuestion] = useState(DEFAULT_PROMPTS[0]);
  const [runId, setRunId] = useState<number | undefined>(data.payrollRuns[0]?.id);
  const [employeeId, setEmployeeId] = useState<number | undefined>(data.employees[0]?.id);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedRun = useMemo(
    () => data.payrollRuns.find((run) => run.id === runId) ?? data.payrollRuns[0],
    [data.payrollRuns, runId],
  );

  async function ask(nextQuestion = question) {
    const clean = nextQuestion.trim();
    if (!clean) return;
    setQuestion(clean);
    setBusy(true);
    try {
      const response = await fetch("/api/ask-linaw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: data.selectedOrganization.id,
          question: clean,
          runId: selectedRun?.id,
          employeeId,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(body.error ?? "Ask Linaw could not answer from the stored evidence.");
        return;
      }
      setAnswer(body as Answer);
    } catch {
      setNotice("Ask Linaw could not reach the evidence service.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" data-ask-linaw style={{ marginTop: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">ASK LINAW · EVIDENCE MODE</div>
          <h2>Ask the payroll record, not a generic chatbot.</h2>
          <p>Answers come from stored payroll traces, release controls, rule records, filing acknowledgements and remittance evidence. Unsupported questions are declined instead of guessed.</p>
        </div>
        <Status value="Deterministic" />
      </div>

      <div className="setting-form">
        <label style={{ gridColumn: "1 / -1" }}>Question
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void ask();
                }
              }}
              placeholder="What is blocking this payroll from release?"
              style={{ flex: 1 }}
            />
            <button className="primary-button" disabled={busy || !question.trim()} onClick={() => void ask()}>
              <Search size={14} /> {busy ? "Checking…" : "Ask"}
            </button>
          </div>
        </label>
        <label>Payroll run
          <select value={selectedRun?.id ?? ""} onChange={(event) => setRunId(Number(event.target.value))}>
            {data.payrollRuns.map((run) => (
              <option key={run.id} value={run.id}>{run.periodLabel} · {run.status}</option>
            ))}
          </select>
        </label>
        <label>Employee for pay questions
          <select value={employeeId ?? ""} onChange={(event) => setEmployeeId(Number(event.target.value))}>
            {data.employees.map((employee) => (
              <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} · {employee.employeeNo}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="card-body" style={{ paddingTop: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {DEFAULT_PROMPTS.map((prompt) => (
            <button key={prompt} className="secondary-button" disabled={busy} onClick={() => void ask(prompt)}>
              <MessageSquareText size={13} /> {prompt}
            </button>
          ))}
        </div>
      </div>

      {answer && (
        <>
          <div className="notice notice-blue" style={{ margin: "0 18px 14px", alignItems: "flex-start" }}>
            <ShieldCheck size={15} />
            <div>
              <strong>{answer.title}</strong>
              <p style={{ margin: "5px 0 0", lineHeight: 1.65 }}>{answer.answer}</p>
            </div>
          </div>
          {answer.evidence.length > 0 && (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead><tr><th>Evidence</th><th>Recorded value</th><th>Source</th></tr></thead>
                <tbody>
                  {answer.evidence.slice(0, 20).map((item, index) => (
                    <tr key={`${item.source}-${index}`}>
                      <td><strong>{item.label}</strong></td>
                      <td>{item.value}</td>
                      <td className="mono">{item.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {answer.limitations && <p className="disclaimer" style={{ margin: 18 }}>{answer.limitations}</p>}
        </>
      )}
    </section>
  );
}
