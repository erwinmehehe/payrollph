"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Heart, MessageSquare, Plus, RefreshCw, Send, ShieldCheck, Target, X } from "lucide-react";

type Access = { role: string; companyWide: boolean; orgUnitId: number | null };
type QuestionAnalytics = {
  id: number;
  prompt: string;
  type: string;
  required: boolean;
  responseCount: number | null;
  suppressed: boolean;
  average: number | null;
  enps: { score: number | null; promoters: number; passives: number; detractors: number; responses: number } | null;
  textResponseCount: number | null;
  comments: Array<{ employeeId: number | null; employeeName: string; text: string | null }>;
};
type Survey = {
  id: number;
  name: string;
  kind: string;
  status: string;
  anonymous: boolean;
  privacyThreshold: number;
  audienceOrgUnitId: number | null;
  opensAt: string | null;
  closesAt: string | null;
  responseCount: number | null;
  eligibleCount: number | null;
  responseRate: number | null;
  reportable: boolean;
  suppressionReason: string | null;
  questions: QuestionAnalytics[];
  unitBreakdown: Array<{ orgUnitId: number; orgUnitName: string; responseCount: number | null; reportable: boolean }>;
};
type ActionPlan = { id: number; surveyId: number; questionId: number | null; orgUnitId: number | null; ownerEmployeeId: number | null; title: string; dueDate: string | null; status: string; notes: string | null };
type Employee = { id: number; firstName: string; lastName: string; title: string; orgUnitId: number | null; status: string };
type Unit = { id: number; name: string };
type Recognition = { id: number; senderName: string; recipientName: string; category: string; message: string; createdAt: string };
type Feedback = { id: number; authorName: string; recipientName: string; kind: string; message: string; createdAt: string };
type Payload = {
  anonymityConfigured: boolean;
  access: Access;
  surveys: Survey[];
  actionPlans: ActionPlan[];
  recognition: Recognition[];
  feedback: Feedback[];
  employees: Employee[];
  orgUnits: Unit[];
  privacy: { minimumThreshold: number; anonymousTextPolicy: string };
};

export function EngagementPanel({ organizationId, setNotice }: { organizationId: number; setNotice: (message: string) => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSurveyId, setSelectedSurveyId] = useState<number | null>(null);
  const [showSurvey, setShowSurvey] = useState(false);
  const [showQuestion, setShowQuestion] = useState(false);
  const [showAction, setShowAction] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  const [surveyForm, setSurveyForm] = useState({ name: "", kind: "pulse", anonymous: true, privacyThreshold: "5", audienceOrgUnitId: "", closesAt: "" });
  const [questionForm, setQuestionForm] = useState({ surveyId: "", prompt: "", type: "rating_1_5", required: true });
  const [actionForm, setActionForm] = useState({ surveyId: "", questionId: "", orgUnitId: "", ownerEmployeeId: "", title: "", dueDate: "", notes: "" });
  const [feedbackForm, setFeedbackForm] = useState({ recipientEmployeeId: "", kind: "coaching", message: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/engagement?organizationId=${organizationId}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return setNotice(payload.error ?? "Could not load engagement.");
      setData(payload);
      setSelectedSurveyId((current) => current ?? payload.surveys?.[0]?.id ?? null);
    } finally {
      setLoading(false);
    }
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  const selectedSurvey = useMemo(
    () => data?.surveys.find((survey) => survey.id === selectedSurveyId) ?? data?.surveys[0] ?? null,
    [data, selectedSurveyId],
  );
  const employeeById = useMemo(() => new Map((data?.employees ?? []).map((employee) => [employee.id, employee])), [data]);
  const unitById = useMemo(() => new Map((data?.orgUnits ?? []).map((unit) => [unit.id, unit])), [data]);

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/engagement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, ...body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Engagement change failed.");
    return payload;
  }

  async function patch(body: Record<string, unknown>) {
    const response = await fetch("/api/engagement", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, ...body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Engagement change failed.");
    return payload;
  }

  async function createSurvey(event: React.FormEvent) {
    event.preventDefault();
    try {
      const row = await post({
        entityType: "survey",
        name: surveyForm.name,
        kind: surveyForm.kind,
        anonymous: surveyForm.anonymous,
        privacyThreshold: Number(surveyForm.privacyThreshold),
        audienceOrgUnitId: surveyForm.audienceOrgUnitId ? Number(surveyForm.audienceOrgUnitId) : null,
        closesAt: surveyForm.closesAt ? new Date(surveyForm.closesAt + "T23:59:59+08:00").toISOString() : null,
      });
      setSurveyForm({ name: "", kind: "pulse", anonymous: true, privacyThreshold: "5", audienceOrgUnitId: "", closesAt: "" });
      setShowSurvey(false);
      setSelectedSurveyId(row.id);
      await load();
      setNotice("Survey drafted. Add questions before opening it.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create survey."); }
  }

  async function addQuestion(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "question",
        surveyId: Number(questionForm.surveyId),
        prompt: questionForm.prompt,
        type: questionForm.type,
        required: questionForm.required,
        sortOrder: selectedSurvey?.questions.length ?? 0,
      });
      setQuestionForm({ surveyId: "", prompt: "", type: "rating_1_5", required: true });
      setShowQuestion(false);
      await load();
      setNotice("Survey question added.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not add survey question."); }
  }

  async function changeSurvey(survey: Survey, action: "open_survey" | "close_survey") {
    try {
      await patch({ action, surveyId: survey.id });
      await load();
      setNotice(action === "open_survey" ? "Survey opened." : "Survey closed.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not update survey."); }
  }

  async function createActionPlan(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "action_plan",
        surveyId: Number(actionForm.surveyId),
        questionId: actionForm.questionId ? Number(actionForm.questionId) : null,
        orgUnitId: actionForm.orgUnitId ? Number(actionForm.orgUnitId) : null,
        ownerEmployeeId: actionForm.ownerEmployeeId ? Number(actionForm.ownerEmployeeId) : null,
        title: actionForm.title,
        dueDate: actionForm.dueDate || null,
        notes: actionForm.notes,
      });
      setActionForm({ surveyId: "", questionId: "", orgUnitId: "", ownerEmployeeId: "", title: "", dueDate: "", notes: "" });
      setShowAction(false);
      await load();
      setNotice("Engagement action plan created.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create action plan."); }
  }

  async function updateActionPlan(plan: ActionPlan, status: string) {
    try {
      await patch({ action: "action_plan_status", actionPlanId: plan.id, status });
      await load();
      setNotice("Action plan updated.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not update action plan."); }
  }

  async function createFeedback(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "feedback",
        recipientEmployeeId: Number(feedbackForm.recipientEmployeeId),
        kind: feedbackForm.kind,
        message: feedbackForm.message,
      });
      setFeedbackForm({ recipientEmployeeId: "", kind: "coaching", message: "" });
      setShowFeedback(false);
      await load();
      setNotice("Continuous feedback recorded.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not record feedback."); }
  }

  if (!data) {
    return <article className="card" style={{ padding: 24 }}>{loading ? "Loading engagement…" : "Engagement data unavailable."}</article>;
  }

  const activeSurveys = data.surveys.filter((survey) => survey.status === "open").length;
  const reportableSurveys = data.surveys.filter((survey) => survey.reportable).length;
  const latestEnps = data.surveys
    .flatMap((survey) => survey.questions.filter((question) => question.enps?.score !== null).map((question) => ({ survey, question })))
    .find(Boolean);

  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ENGAGEMENT</div>
          <h1>Listen safely, then turn findings into action.</h1>
          <p>Run pulse, lifecycle and eNPS surveys with privacy thresholds, create team action plans, recognize contributions, and keep continuous feedback separate from formal performance scoring.</p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          <button className="secondary-button" onClick={() => setShowFeedback(!showFeedback)}><MessageSquare size={15} /> Feedback</button>
          <button className="primary-button" onClick={() => setShowSurvey(!showSurvey)}><Plus size={15} /> Survey</button>
        </div>
      </div>

      <section className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="stat-card"><div className="stat-icon purple"><MessageSquare size={19} /></div><p>OPEN SURVEYS</p><h3>{activeSurveys}</h3><span>{data.surveys.length} total listening cycles</span></article>
        <article className="stat-card"><div className="stat-icon blue"><ShieldCheck size={19} /></div><p>REPORTABLE</p><h3>{reportableSurveys}</h3><span>Reached privacy threshold</span></article>
        <article className="stat-card"><div className="stat-icon mint"><BarChart3 size={19} /></div><p>LATEST eNPS</p><h3>{latestEnps?.question.enps?.score ?? "—"}</h3><span>{latestEnps?.survey.name ?? "No reportable eNPS yet"}</span></article>
        <article className="stat-card"><div className="stat-icon orange"><Target size={19} /></div><p>OPEN ACTIONS</p><h3>{data.actionPlans.filter((plan) => !["completed", "cancelled"].includes(plan.status)).length}</h3><span>{data.actionPlans.filter((plan) => plan.status === "completed").length} completed</span></article>
      </section>

      {!data.anonymityConfigured && (
        <div className="notice notice-amber" style={{ marginBottom: 16 }}>
          <ShieldCheck size={15} /><span>Set <code>ENGAGEMENT_ANONYMITY_KEY</code> to at least 32 bytes before anonymous surveys can be opened.</span>
        </div>
      )}

      {showSurvey && (
        <article className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div className="card-header"><div><div className="card-kicker">NEW SURVEY</div><h2>Create a privacy-governed listening cycle</h2></div><button className="icon-button" onClick={() => setShowSurvey(false)}><X size={16} /></button></div>
          <form onSubmit={createSurvey}><div className="setting-form">
            <label>Name<input required value={surveyForm.name} onChange={(event) => setSurveyForm({ ...surveyForm, name: event.target.value })} placeholder="Q4 Employee Pulse" /></label>
            <label>Kind<select value={surveyForm.kind} onChange={(event) => setSurveyForm({ ...surveyForm, kind: event.target.value })}><option value="pulse">Pulse</option><option value="enps">eNPS</option><option value="onboarding">Onboarding</option><option value="exit">Exit</option><option value="lifecycle">Lifecycle</option><option value="custom">Custom</option></select></label>
            <label>Audience<select value={surveyForm.audienceOrgUnitId} onChange={(event) => setSurveyForm({ ...surveyForm, audienceOrgUnitId: event.target.value })}><option value="">Company-wide</option>{data.orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
            <label>Privacy threshold<input type="number" min="5" max="50" value={surveyForm.privacyThreshold} onChange={(event) => setSurveyForm({ ...surveyForm, privacyThreshold: event.target.value })} /></label>
            <label>Close date<input type="date" value={surveyForm.closesAt} onChange={(event) => setSurveyForm({ ...surveyForm, closesAt: event.target.value })} /></label>
            <label><input type="checkbox" checked={surveyForm.anonymous} onChange={(event) => setSurveyForm({ ...surveyForm, anonymous: event.target.checked })} /> Anonymous responses</label>
          </div><div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowSurvey(false)}>Cancel</button><button className="primary-button">Create draft</button></div></form>
        </article>
      )}

      {showQuestion && (
        <article className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div className="card-header"><div><div className="card-kicker">QUESTION</div><h2>Add a question to a draft survey</h2></div><button className="icon-button" onClick={() => setShowQuestion(false)}><X size={16} /></button></div>
          <form onSubmit={addQuestion}><div className="setting-form">
            <label>Survey<select required value={questionForm.surveyId} onChange={(event) => setQuestionForm({ ...questionForm, surveyId: event.target.value })}><option value="">Select draft</option>{data.surveys.filter((survey) => survey.status === "draft").map((survey) => <option key={survey.id} value={survey.id}>{survey.name}</option>)}</select></label>
            <label>Type<select value={questionForm.type} onChange={(event) => setQuestionForm({ ...questionForm, type: event.target.value })}><option value="rating_1_5">Rating 1–5</option><option value="enps_0_10">eNPS 0–10</option><option value="text">Text</option></select></label>
            <label style={{ gridColumn: "1 / -1" }}>Prompt<textarea required maxLength={500} rows={2} value={questionForm.prompt} onChange={(event) => setQuestionForm({ ...questionForm, prompt: event.target.value })} /></label>
            <label><input type="checkbox" checked={questionForm.required} onChange={(event) => setQuestionForm({ ...questionForm, required: event.target.checked })} /> Required</label>
          </div><div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowQuestion(false)}>Cancel</button><button className="primary-button">Add question</button></div></form>
        </article>
      )}

      {showAction && (
        <article className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div className="card-header"><div><div className="card-kicker">ACTION PLAN</div><h2>Turn a finding into accountable follow-through</h2></div><button className="icon-button" onClick={() => setShowAction(false)}><X size={16} /></button></div>
          <form onSubmit={createActionPlan}><div className="setting-form">
            <label>Survey<select required value={actionForm.surveyId} onChange={(event) => setActionForm({ ...actionForm, surveyId: event.target.value, questionId: "" })}><option value="">Select survey</option>{data.surveys.map((survey) => <option key={survey.id} value={survey.id}>{survey.name}</option>)}</select></label>
            <label>Finding / question<select value={actionForm.questionId} onChange={(event) => setActionForm({ ...actionForm, questionId: event.target.value })}><option value="">Survey-wide</option>{data.surveys.find((survey) => survey.id === Number(actionForm.surveyId))?.questions.map((question) => <option key={question.id} value={question.id}>{question.prompt}</option>)}</select></label>
            <label>Org unit<select value={actionForm.orgUnitId} onChange={(event) => setActionForm({ ...actionForm, orgUnitId: event.target.value })}><option value="">Company-wide</option>{data.orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
            <label>Owner<select value={actionForm.ownerEmployeeId} onChange={(event) => setActionForm({ ...actionForm, ownerEmployeeId: event.target.value })}><option value="">Unassigned</option>{data.employees.filter((employee) => !actionForm.orgUnitId || employee.orgUnitId === Number(actionForm.orgUnitId)).map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>
            <label>Title<input required value={actionForm.title} onChange={(event) => setActionForm({ ...actionForm, title: event.target.value })} /></label>
            <label>Due date<input type="date" value={actionForm.dueDate} onChange={(event) => setActionForm({ ...actionForm, dueDate: event.target.value })} /></label>
            <label style={{ gridColumn: "1 / -1" }}>Notes<textarea rows={2} value={actionForm.notes} onChange={(event) => setActionForm({ ...actionForm, notes: event.target.value })} /></label>
          </div><div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowAction(false)}>Cancel</button><button className="primary-button">Create action</button></div></form>
        </article>
      )}

      {showFeedback && (
        <article className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div className="card-header"><div><div className="card-kicker">CONTINUOUS FEEDBACK</div><h2>Record coaching or recognition outside the formal review cycle</h2></div><button className="icon-button" onClick={() => setShowFeedback(false)}><X size={16} /></button></div>
          <form onSubmit={createFeedback}><div className="setting-form">
            <label>Employee<select required value={feedbackForm.recipientEmployeeId} onChange={(event) => setFeedbackForm({ ...feedbackForm, recipientEmployeeId: event.target.value })}><option value="">Select employee</option>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>
            <label>Kind<select value={feedbackForm.kind} onChange={(event) => setFeedbackForm({ ...feedbackForm, kind: event.target.value })}><option value="praise">Praise</option><option value="coaching">Coaching</option><option value="check_in">Check-in</option></select></label>
            <label style={{ gridColumn: "1 / -1" }}>Feedback<textarea required rows={3} value={feedbackForm.message} onChange={(event) => setFeedbackForm({ ...feedbackForm, message: event.target.value })} /></label>
          </div><div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowFeedback(false)}>Cancel</button><button className="primary-button">Record feedback</button></div></form>
        </article>
      )}

      <section className="module-grid two">
        <article className="card">
          <div className="card-header">
            <div><div className="card-kicker">LISTENING CYCLES</div><h2>Surveys</h2></div>
            <button className="secondary-button" onClick={() => setShowQuestion(true)} disabled={!data.surveys.some((survey) => survey.status === "draft")}><Plus size={13} /> Question</button>
          </div>
          {data.surveys.length === 0 && <div className="empty-state">No surveys yet.</div>}
          {data.surveys.map((survey) => (
            <button key={survey.id} type="button" className="leave-request" style={{ width: "100%", textAlign: "left" }} onClick={() => setSelectedSurveyId(survey.id)}>
              <div className="inline-icon purple"><MessageSquare size={16} /></div>
              <div style={{ flex: 1 }}><strong>{survey.name}</strong><span>{survey.kind} · {survey.anonymous ? "anonymous" : "identified"} · {survey.responseCount === null ? "below privacy threshold" : `${survey.responseCount}/${survey.eligibleCount ?? 0} responses`}</span></div>
              <span className={survey.status === "open" ? "status status-verified" : "status"}>{survey.status}</span>
            </button>
          ))}
        </article>

        <article className="card">
          <div className="card-header">
            <div><div className="card-kicker">SELECTED SURVEY</div><h2>{selectedSurvey?.name ?? "No survey selected"}</h2></div>
            {selectedSurvey && <div style={{ display: "flex", gap: 6 }}>
              {selectedSurvey.status === "draft" && <button className="primary-button" onClick={() => void changeSurvey(selectedSurvey, "open_survey")} disabled={selectedSurvey.anonymous && !data.anonymityConfigured}><Send size={12} /> Open</button>}
              {selectedSurvey.status === "open" && <button className="secondary-button" onClick={() => void changeSurvey(selectedSurvey, "close_survey")}>Close</button>}
            </div>}
          </div>
          {selectedSurvey && (
            <div style={{ padding: "0 16px 14px" }}>
              <div className="notice" style={{ marginBottom: 12 }}><ShieldCheck size={14} /><span>{selectedSurvey.reportable ? `Results reportable at ${selectedSurvey.responseCount} responses.` : selectedSurvey.suppressionReason}</span></div>
              {selectedSurvey.questions.length === 0 && <div className="empty-state">Add questions while this survey is in draft.</div>}
              {selectedSurvey.questions.map((question) => (
                <div key={question.id} style={{ padding: "11px 0", borderTop: "1px solid var(--border)" }}>
                  <strong>{question.prompt}</strong>
                  <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
                    {question.suppressed ? "Result suppressed" :
                      question.type === "rating_1_5" ? `Average ${question.average ?? "—"} / 5` :
                      question.type === "enps_0_10" ? `eNPS ${question.enps?.score ?? "—"} · ${question.enps?.responses ?? 0} responses` :
                      `${question.textResponseCount} text responses`}
                  </div>
                  {question.comments.length > 0 && <div style={{ marginTop: 6 }}>{question.comments.slice(0, 5).map((comment, index) => <blockquote key={index} style={{ margin: "6px 0", fontSize: 12 }}><strong>{comment.employeeName}:</strong> {comment.text}</blockquote>)}</div>}
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <article className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div><div className="card-kicker">ACTION PLANS</div><h2>Close the loop after listening</h2></div>
          <button className="primary-button" onClick={() => setShowAction(true)} disabled={!data.surveys.length}><Plus size={13} /> Action</button>
        </div>
        <div className="data-table-wrap"><table className="data-table">
          <thead><tr><th>ACTION</th><th>SURVEY</th><th>OWNER / UNIT</th><th>DUE</th><th>STATUS</th><th>NEXT</th></tr></thead>
          <tbody>
            {data.actionPlans.length === 0 && <tr><td colSpan={6}><div className="empty-state">No engagement action plans yet.</div></td></tr>}
            {data.actionPlans.map((plan) => (
              <tr key={plan.id}>
                <td><strong>{plan.title}</strong></td>
                <td>{data.surveys.find((survey) => survey.id === plan.surveyId)?.name ?? `Survey #${plan.surveyId}`}</td>
                <td>{plan.ownerEmployeeId ? (() => { const employee = employeeById.get(plan.ownerEmployeeId); return employee ? employee.firstName + " " + employee.lastName : "Employee"; })() : "Unassigned"}<small style={{ display: "block", color: "var(--muted)" }}>{plan.orgUnitId ? unitById.get(plan.orgUnitId)?.name ?? "Org unit" : "Company-wide"}</small></td>
                <td>{plan.dueDate ?? "—"}</td>
                <td><span className={plan.status === "completed" ? "status status-verified" : "status"}>{plan.status}</span></td>
                <td>{plan.status === "open" ? <button className="secondary-button" onClick={() => void updateActionPlan(plan, "in_progress")}>Start</button> : plan.status === "in_progress" ? <button className="primary-button" onClick={() => void updateActionPlan(plan, "completed")}>Complete</button> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </article>

      <section className="module-grid two" style={{ marginTop: 16 }}>
        <article className="card">
          <div className="card-header"><div><div className="card-kicker">RECOGNITION</div><h2>Recent peer appreciation</h2></div></div>
          {data.recognition.length === 0 && <div className="empty-state">No public recognition yet.</div>}
          {data.recognition.slice(0, 12).map((item) => <div className="leave-request" key={item.id}><div className="inline-icon pink"><Heart size={16} /></div><div style={{ flex: 1 }}><strong>{item.recipientName}</strong><span>{item.message}</span><small style={{ color: "var(--muted)" }}>{item.senderName} · {item.category}</small></div></div>)}
        </article>
        <article className="card">
          <div className="card-header"><div><div className="card-kicker">CONTINUOUS FEEDBACK</div><h2>Manager coaching stream</h2></div></div>
          {data.feedback.length === 0 && <div className="empty-state">No continuous feedback recorded.</div>}
          {data.feedback.slice(0, 12).map((item) => <div className="leave-request" key={item.id}><div className="inline-icon blue"><MessageSquare size={16} /></div><div style={{ flex: 1 }}><strong>{item.recipientName}</strong><span>{item.message}</span><small style={{ color: "var(--muted)" }}>{item.authorName} · {item.kind}</small></div></div>)}
        </article>
      </section>

      <div className="notice" style={{ marginTop: 16 }}>
        <ShieldCheck size={14} /><span>{data.privacy.anonymousTextPolicy} Small cohorts are suppressed until at least {data.privacy.minimumThreshold} responses are present.</span>
      </div>
    </div>
  );
}
