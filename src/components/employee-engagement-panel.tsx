"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Heart, MessageSquare, RefreshCw, Send, ShieldCheck } from "lucide-react";

type SurveyQuestion = { id: number; prompt: string; type: string; required: boolean };
type Survey = {
  id: number;
  name: string;
  kind: string;
  anonymous: boolean;
  privacyThreshold: number;
  closesAt: string | null;
  alreadyResponded: boolean;
  respondable: boolean;
  anonymityReady: boolean;
  questions: SurveyQuestion[];
};
type RecognitionEmployee = { id: number; firstName: string; lastName: string; title: string };
type Recognition = {
  id: number;
  senderName: string;
  recipientName: string;
  category: string;
  message: string;
  createdAt: string;
};

export function EmployeeEngagementPanel({ organizationId }: { organizationId: number }) {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [privacyNotice, setPrivacyNotice] = useState("");
  const [answers, setAnswers] = useState<Record<number, Record<number, string>>>({});
  const [employees, setEmployees] = useState<RecognitionEmployee[]>([]);
  const [recognition, setRecognition] = useState<Recognition[]>([]);
  const [currentEmployeeId, setCurrentEmployeeId] = useState<number | null>(null);
  const [recipientEmployeeId, setRecipientEmployeeId] = useState("");
  const [category, setCategory] = useState("appreciation");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [surveyResponse, recognitionResponse] = await Promise.all([
      fetch(`/api/engagement/respond?organizationId=${organizationId}`, { cache: "no-store" }),
      fetch(`/api/engagement/recognition?organizationId=${organizationId}`, { cache: "no-store" }),
    ]);
    const surveyPayload = await surveyResponse.json().catch(() => ({}));
    const recognitionPayload = await recognitionResponse.json().catch(() => ({}));
    if (surveyResponse.ok) {
      setSurveys(surveyPayload.surveys ?? []);
      setPrivacyNotice(surveyPayload.privacyNotice ?? "");
    }
    if (recognitionResponse.ok) {
      setEmployees(recognitionPayload.employees ?? []);
      setRecognition(recognitionPayload.recognition ?? []);
      setCurrentEmployeeId(recognitionPayload.currentEmployeeId ?? null);
    }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  const recognitionRecipients = useMemo(
    () => employees.filter((employee) => employee.id !== currentEmployeeId),
    [employees, currentEmployeeId],
  );

  function setAnswer(surveyId: number, questionId: number, value: string) {
    setAnswers((current) => ({
      ...current,
      [surveyId]: { ...(current[surveyId] ?? {}), [questionId]: value },
    }));
  }

  async function submitSurvey(survey: Survey) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/engagement/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          surveyId: survey.id,
          answers: survey.questions.flatMap((question) => {
            const value = answers[survey.id]?.[question.id] ?? "";
            if (!value && !question.required) return [];
            return [{
              questionId: question.id,
              ...(question.type === "text" ? { textValue: value } : { numericValue: Number(value) }),
            }];
          }),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error ?? "Survey response could not be submitted.");
        return;
      }
      setNotice(payload.message ?? "Response recorded.");
      setAnswers((current) => ({ ...current, [survey.id]: {} }));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function submitRecognition(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/engagement/recognition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          recipientEmployeeId: Number(recipientEmployeeId),
          category,
          message,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error ?? "Recognition could not be shared.");
        return;
      }
      setRecipientEmployeeId("");
      setCategory("appreciation");
      setMessage("");
      setNotice("Recognition shared.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="employee-section">
      <div className="employee-section-heading">
        <div>
          <span className="card-kicker">MY VOICE</span>
          <h2>Surveys &amp; recognition</h2>
          <p>Share feedback through active surveys and recognize coworkers for meaningful contributions.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
      </div>

      {notice && <div className="notice notice-green" style={{ marginBottom: 14 }}><span>{notice}</span></div>}
      {privacyNotice && <div className="notice" style={{ marginBottom: 14 }}><ShieldCheck size={15} /><span>{privacyNotice}</span></div>}

      <div className="module-grid two">
        <article className="card">
          <div className="card-header"><div><div className="card-kicker">OPEN SURVEYS</div><h3>Tell us what is working and what needs attention</h3></div></div>
          {surveys.length === 0 && <div className="empty-state">No engagement survey is open for you right now.</div>}
          {surveys.map((survey) => (
            <div key={survey.id} style={{ padding: "14px 16px", borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
                <div>
                  <strong>{survey.name}</strong>
                  <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 3 }}>
                    {survey.kind.toUpperCase()} · {survey.anonymous ? `Anonymous · results require ${survey.privacyThreshold}+ responses` : "Identified response"}
                  </div>
                </div>
                {survey.alreadyResponded && <span className="status status-verified">Submitted</span>}
              </div>
              {!survey.alreadyResponded && survey.respondable && (
                <div style={{ marginTop: 12 }}>
                  {survey.questions.map((question) => (
                    <label key={question.id} style={{ display: "block", marginBottom: 12 }}>
                      <span style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>{question.prompt}{question.required ? " *" : ""}</span>
                      {question.type === "text" ? (
                        <textarea
                          rows={3}
                          value={answers[survey.id]?.[question.id] ?? ""}
                          onChange={(event) => setAnswer(survey.id, question.id, event.target.value)}
                          placeholder="Optional context helps when the question allows it."
                        />
                      ) : (
                        <select
                          value={answers[survey.id]?.[question.id] ?? ""}
                          onChange={(event) => setAnswer(survey.id, question.id, event.target.value)}
                        >
                          <option value="">Select</option>
                          {Array.from({ length: question.type === "enps_0_10" ? 11 : 5 }, (_, index) => question.type === "enps_0_10" ? index : index + 1)
                            .map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      )}
                    </label>
                  ))}
                  <button className="primary-button" type="button" disabled={busy} onClick={() => void submitSurvey(survey)}>
                    <Send size={13} /> Submit response
                  </button>
                </div>
              )}
              {!survey.anonymityReady && <div className="notice notice-amber" style={{ marginTop: 10 }}>Anonymous survey security is not configured yet. HR has been notified by the disabled response state.</div>}
            </div>
          ))}
        </article>

        <article className="card">
          <div className="card-header"><div><div className="card-kicker">PEER RECOGNITION</div><h3>Recognize a coworker</h3></div></div>
          <form onSubmit={submitRecognition} style={{ padding: "0 16px 16px" }}>
            <div className="setting-form">
              <label>Teammate
                <select required value={recipientEmployeeId} onChange={(event) => setRecipientEmployeeId(event.target.value)}>
                  <option value="">Select employee</option>
                  {recognitionRecipients.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} · {employee.title}</option>)}
                </select>
              </label>
              <label>Why
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option value="appreciation">Appreciation</option>
                  <option value="teamwork">Teamwork</option>
                  <option value="customer">Customer impact</option>
                  <option value="innovation">Innovation</option>
                  <option value="leadership">Leadership</option>
                  <option value="milestone">Milestone</option>
                </select>
              </label>
              <label style={{ gridColumn: "1 / -1" }}>Message
                <textarea required maxLength={800} rows={3} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Describe the contribution you appreciated." />
              </label>
            </div>
            <button className="primary-button" disabled={busy || !recipientEmployeeId || !message.trim()}><Heart size={13} /> Share recognition</button>
          </form>
        </article>
      </div>

      <article className="card" style={{ marginTop: 16 }}>
        <div className="card-header"><div><div className="card-kicker">RECOGNITION FEED</div><h3>Recent appreciation</h3></div></div>
        {recognition.length === 0 && <div className="empty-state">No public recognition yet.</div>}
        {recognition.slice(0, 20).map((item) => (
          <div className="leave-request" key={item.id}>
            <div className="inline-icon pink"><MessageSquare size={16} /></div>
            <div style={{ flex: 1 }}>
              <strong>{item.recipientName}</strong>
              <span>{item.message}</span>
              <small style={{ color: "var(--muted)" }}>{item.senderName} · {item.category} · {new Date(item.createdAt).toLocaleDateString("en-PH")}</small>
            </div>
          </div>
        ))}
      </article>
    </section>
  );
}
