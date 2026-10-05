"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, GitBranch, MessagesSquare, RefreshCw, Send, Target, UserRoundCheck, UsersRound } from "lucide-react";

type Employee = { id: number; firstName: string; lastName: string; title: string };
type StrategicGoal = { id: number; title: string; scope: string; progress: number; status: string };
type Goal = {
  id: number;
  employeeId: number;
  title: string;
  description: string | null;
  progress: number;
  status: string;
  dueDate: string | null;
  alignments: Array<{ strategicGoalId: number; contributionWeight: number; strategicGoal: StrategicGoal | null }>;
};
type Review = { id: number; cycleId: number; status: string; selfScore: string | null; employeeReflection: string | null; selfSubmittedAt: string | null; managerScore: string | null; finalScore: string | null; managerSummary: string | null };
type Series = { id: number; managerEmployeeId: number | null; employeeId: number; cadence: string; agendaTemplate: string | null; active: boolean };
type Meeting = { id: number; seriesId: number; scheduledDate: string; status: string; employeeUpdate: string | null; managerUpdate: string | null; sharedNotes: string | null; completedAt: string | null };
type ActionItem = { id: number; meetingId: number; ownerEmployeeId: number | null; title: string; dueDate: string | null; status: string };
type FeedbackRound = { id: number; title: string; prompt: string; dueDate: string | null; status: string; requestedCount: number; submittedCount: number; responses: Array<{ id: number; relationship: string; responseText: string | null; submittedAt: string | null; reviewerName: string }> };
type IncomingFeedback = { id: number; relationship: string; subjectName: string; round: { id: number; title: string; prompt: string; dueDate: string | null } };
type Mentorship = { id: number; mentorEmployeeId: number; menteeEmployeeId: number; goal: string; cadence: string; status: string; startDate: string | null; endDate: string | null };
type ContinuousFeedback = { id: number; kind: string; message: string; createdAt: string; authorName: string };
type Payload = {
  employee: Employee;
  employees: Employee[];
  goals: Goal[];
  reviews: Review[];
  oneOnOneSeries: Series[];
  oneOnOneMeetings: Meeting[];
  oneOnOneActionItems: ActionItem[];
  feedbackRounds: FeedbackRound[];
  incomingFeedbackRequests: IncomingFeedback[];
  mentorships: Mentorship[];
  continuousFeedback: ContinuousFeedback[];
  employeeNames: Record<string, string>;
  feedbackPolicy: string;
};

const cadenceOptions = ["weekly", "biweekly", "monthly", "quarterly"];

export function EmployeeGrowthPanel({ organizationId }: { organizationId: number }) {
  const [data, setData] = useState<Payload | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selfDrafts, setSelfDrafts] = useState<Record<number, { selfScore: string; employeeReflection: string }>>({});
  const [meetingDrafts, setMeetingDrafts] = useState<Record<number, string>>({});
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<number, string>>({});
  const [showFeedbackRequest, setShowFeedbackRequest] = useState(false);
  const [showMentorRequest, setShowMentorRequest] = useState(false);
  const [feedbackForm, setFeedbackForm] = useState({ title: "", prompt: "", dueDate: "", reviewerIds: [] as string[] });
  const [mentorForm, setMentorForm] = useState({ mentorEmployeeId: "", goal: "", cadence: "monthly" });

  const load = useCallback(async () => {
    const response = await fetch(`/api/self/experience?organizationId=${organizationId}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not load your growth workspace.");
      return;
    }
    setData(payload);
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  const seriesById = useMemo(() => new Map((data?.oneOnOneSeries ?? []).map((row) => [row.id, row])), [data]);

  async function patch(body: Record<string, unknown>) {
    const response = await fetch("/api/self/experience", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, ...body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Could not save your update.");
    return payload;
  }

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/self/experience", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, ...body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Could not submit your request.");
    return payload;
  }

  async function updateGoal(goalId: number, progress: number) {
    try {
      await patch({ action: "goal_progress", goalId, progress });
      await load();
      setNotice("Goal progress updated.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not update goal."); }
  }

  async function submitSelfAssessment(review: Review) {
    const draft = selfDrafts[review.id] ?? { selfScore: review.selfScore ?? "3", employeeReflection: review.employeeReflection ?? "" };
    setBusy(true);
    try {
      await patch({ action: "self_assessment", reviewId: review.id, selfScore: Number(draft.selfScore), employeeReflection: draft.employeeReflection });
      await load();
      setNotice("Self-assessment submitted. Your manager can now review it alongside their assessment.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not submit self-assessment."); }
    finally { setBusy(false); }
  }

  async function saveOneOnOneUpdate(meetingId: number) {
    const employeeUpdate = meetingDrafts[meetingId] ?? "";
    setBusy(true);
    try {
      await patch({ action: "one_on_one_update", meetingId, employeeUpdate });
      await load();
      setNotice("Your one-on-one update is ready for the conversation.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save one-on-one prep."); }
    finally { setBusy(false); }
  }

  async function submitFeedback(requestId: number) {
    const responseText = feedbackDrafts[requestId] ?? "";
    setBusy(true);
    try {
      await patch({ action: "feedback_response", requestId, responseText });
      setFeedbackDrafts((current) => ({ ...current, [requestId]: "" }));
      await load();
      setNotice("Named feedback submitted.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not submit feedback."); }
    finally { setBusy(false); }
  }

  async function requestFeedback(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await post({
        entityType: "feedback_round",
        title: feedbackForm.title,
        prompt: feedbackForm.prompt,
        dueDate: feedbackForm.dueDate || null,
        reviewers: feedbackForm.reviewerIds.map((employeeId) => ({ employeeId: Number(employeeId), relationship: "peer" })),
      });
      setFeedbackForm({ title: "", prompt: "", dueDate: "", reviewerIds: [] });
      setShowFeedbackRequest(false);
      await load();
      setNotice("Feedback requests sent.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not request feedback."); }
    finally { setBusy(false); }
  }

  async function requestMentor(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await post({ entityType: "mentorship_request", mentorEmployeeId: Number(mentorForm.mentorEmployeeId), goal: mentorForm.goal, cadence: mentorForm.cadence });
      setMentorForm({ mentorEmployeeId: "", goal: "", cadence: "monthly" });
      setShowMentorRequest(false);
      await load();
      setNotice("Mentorship request sent.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not request mentorship."); }
    finally { setBusy(false); }
  }

  async function updateMentorship(mentorshipId: number, status: string) {
    try {
      await patch({ action: "mentorship_status", mentorshipId, status });
      await load();
      setNotice("Mentorship updated.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not update mentorship."); }
  }

  async function updateAction(actionItemId: number, status: string) {
    try {
      await patch({ action: "one_on_one_action_status", actionItemId, status });
      await load();
      setNotice("Action item updated.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not update action item."); }
  }

  if (!data) {
    return <section className="employee-section"><div className="employee-empty-row">Loading your growth workspace…</div>{notice && <div className="notice notice-amber"><span>{notice}</span></div>}</section>;
  }

  const mySeries = data.oneOnOneSeries.filter((series) => series.employeeId === data.employee.id);
  const mySeriesIds = new Set(mySeries.map((series) => series.id));
  const myMeetings = data.oneOnOneMeetings.filter((meeting) => mySeriesIds.has(meeting.seriesId));
  const upcomingMeetings = myMeetings.filter((meeting) => meeting.status === "scheduled");
  const openReviews = data.reviews.filter((review) => review.status !== "completed");
  const mentorRequests = data.mentorships.filter((row) => row.mentorEmployeeId === data.employee.id && row.status === "requested");

  return (
    <section className="employee-section">
      <div className="employee-section-heading">
        <div>
          <span className="card-kicker">MY GROWTH</span>
          <h2>Goals, 1:1s, feedback &amp; mentoring</h2>
          <p>Prepare for conversations, own your goal progress, complete self-assessments, and ask for development support.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
      </div>

      {notice && <div className="notice notice-green" style={{ marginBottom: 14 }}><span>{notice}</span></div>}

      <section className="employee-quick-grid" style={{ marginBottom: 16 }}>
        <article className="card" style={{ padding: 16 }}><Target size={16} /><span className="card-kicker">GOALS</span><h3>{data.goals.filter((goal) => goal.status === "active").length} active</h3><p>{Math.round(data.goals.length ? data.goals.reduce((sum, goal) => sum + goal.progress, 0) / data.goals.length : 0)}% average progress</p></article>
        <article className="card" style={{ padding: 16 }}><CheckCircle2 size={16} /><span className="card-kicker">SELF-ASSESSMENTS</span><h3>{openReviews.length}</h3><p>open formal review(s)</p></article>
        <article className="card" style={{ padding: 16 }}><MessagesSquare size={16} /><span className="card-kicker">FEEDBACK INBOX</span><h3>{data.incomingFeedbackRequests.length}</h3><p>named request(s) waiting</p></article>
      </section>

      <div className="module-grid two">
        <article className="card">
          <div className="card-header"><div><div className="card-kicker">MY GOALS</div><h3>Progress and strategic alignment</h3></div></div>
          {data.goals.length === 0 && <div className="empty-state">No goals are assigned to you yet.</div>}
          {data.goals.map((goal) => (
            <div className="leave-request" key={goal.id}>
              <div className="inline-icon blue"><Target size={15} /></div>
              <div style={{ flex: 1 }}>
                <strong>{goal.title}</strong>
                <span>{goal.progress}% complete · {goal.status}{goal.dueDate ? " · due " + goal.dueDate : ""}</span>
                {goal.alignments.map((alignment) => alignment.strategicGoal && (
                  <small key={alignment.id} style={{ display: "block", marginTop: 4 }}><GitBranch size={11} /> Aligned to {alignment.strategicGoal.title} · {alignment.contributionWeight}% contribution</small>
                ))}
              </div>
              {goal.status !== "cancelled" && <select value={goal.progress} onChange={(event) => void updateGoal(goal.id, Number(event.target.value))} style={{ width: 86 }}>{[0, 25, 50, 75, 100].map((value) => <option key={value} value={value}>{value}%</option>)}</select>}
            </div>
          ))}
        </article>

        <article className="card">
          <div className="card-header"><div><div className="card-kicker">SELF-ASSESSMENT</div><h3>Your voice in the formal review</h3></div></div>
          {openReviews.length === 0 && <div className="empty-state">No open formal review needs a self-assessment.</div>}
          {openReviews.map((review) => {
            const draft = selfDrafts[review.id] ?? { selfScore: review.selfScore ?? "3", employeeReflection: review.employeeReflection ?? "" };
            return (
              <div key={review.id} style={{ padding: 16, borderTop: "1px solid var(--border)" }}>
                <strong>Review #{review.id}</strong>
                {review.selfSubmittedAt && <div className="notice" style={{ marginTop: 8 }}><span>Last submitted {new Date(review.selfSubmittedAt).toLocaleDateString("en-PH")}.</span></div>}
                <div className="setting-form" style={{ marginTop: 10 }}>
                  <label>Self score (1–5)<input type="number" min="1" max="5" step="0.1" value={draft.selfScore} onChange={(event) => setSelfDrafts({ ...selfDrafts, [review.id]: { ...draft, selfScore: event.target.value } })} /></label>
                  <label style={{ gridColumn: "1 / -1" }}>Reflection<textarea rows={3} maxLength={8000} value={draft.employeeReflection} onChange={(event) => setSelfDrafts({ ...selfDrafts, [review.id]: { ...draft, employeeReflection: event.target.value } })} placeholder="Outcomes, evidence, challenges, and where you want support." /></label>
                </div>
                <button className="primary-button" disabled={busy || !draft.employeeReflection.trim()} onClick={() => void submitSelfAssessment(review)}><Send size={13} /> Submit self-assessment</button>
              </div>
            );
          })}
        </article>
      </div>

      <div className="module-grid two" style={{ marginTop: 16 }}>
        <article className="card">
          <div className="card-header"><div><div className="card-kicker">MY 1:1s</div><h3>Prepare before the conversation</h3></div></div>
          {upcomingMeetings.length === 0 && <div className="empty-state">No recurring one-on-one is scheduled.</div>}
          {upcomingMeetings.slice(0, 6).map((meeting) => {
            const series = seriesById.get(meeting.seriesId);
            const draft = meetingDrafts[meeting.id] ?? meeting.employeeUpdate ?? "";
            return (
              <div key={meeting.id} style={{ padding: 16, borderTop: "1px solid var(--border)" }}>
                <strong>{meeting.scheduledDate} · {series?.cadence ?? "recurring"}</strong>
                <small style={{ display: "block", color: "var(--muted)", margin: "4px 0 8px" }}>{series?.agendaTemplate || "Wins · priorities · blockers · growth · support needed"}</small>
                <textarea rows={3} maxLength={8000} value={draft} onChange={(event) => setMeetingDrafts({ ...meetingDrafts, [meeting.id]: event.target.value })} placeholder="What went well? What is blocked? What support do you need?" />
                <button className="secondary-button" disabled={busy || !draft.trim()} onClick={() => void saveOneOnOneUpdate(meeting.id)}>Save prep</button>
                {data.oneOnOneActionItems.filter((item) => item.meetingId === meeting.id && item.ownerEmployeeId === data.employee.id).map((item) => (
                  <div key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
                    <span>{item.title}{item.dueDate ? " · due " + item.dueDate : ""}</span>
                    <button className="secondary-button" type="button" onClick={() => void updateAction(item.id, item.status === "completed" ? "open" : "completed")}>{item.status === "completed" ? "Reopen" : "Done"}</button>
                  </div>
                ))}
              </div>
            );
          })}
          {myMeetings.filter((meeting) => meeting.status === "completed").slice(0, 4).map((meeting) => (
            <div className="leave-request" key={meeting.id}>
              <div className="inline-icon mint"><CheckCircle2 size={14} /></div>
              <div><strong>{meeting.scheduledDate}</strong><span>{meeting.sharedNotes || meeting.managerUpdate || "Completed one-on-one"}</span></div>
            </div>
          ))}
        </article>

        <article className="card">
          <div className="card-header">
            <div><div className="card-kicker">FEEDBACK</div><h3>Give and request named 360 feedback</h3></div>
            <button className="secondary-button" onClick={() => setShowFeedbackRequest((value) => !value)}><Plus size={13} /> Request</button>
          </div>
          <div className="notice" style={{ margin: "0 16px 12px" }}><span>{data.feedbackPolicy}</span></div>
          {showFeedbackRequest && (
            <form onSubmit={requestFeedback} style={{ padding: "0 16px 16px" }}>
              <div className="setting-form">
                <label>Title<input required value={feedbackForm.title} onChange={(event) => setFeedbackForm({ ...feedbackForm, title: event.target.value })} placeholder="Growth feedback" /></label>
                <label>Due date<input type="date" value={feedbackForm.dueDate} onChange={(event) => setFeedbackForm({ ...feedbackForm, dueDate: event.target.value })} /></label>
                <label style={{ gridColumn: "1 / -1" }}>Prompt<textarea required rows={2} value={feedbackForm.prompt} onChange={(event) => setFeedbackForm({ ...feedbackForm, prompt: event.target.value })} placeholder="What should I continue, start, or change?" /></label>
                <label style={{ gridColumn: "1 / -1" }}>Reviewers<select multiple required value={feedbackForm.reviewerIds} onChange={(event) => setFeedbackForm({ ...feedbackForm, reviewerIds: Array.from(event.currentTarget.selectedOptions).map((option) => option.value) })} style={{ minHeight: 100 }}>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} · {employee.title}</option>)}</select></label>
              </div>
              <button className="primary-button" disabled={busy || !feedbackForm.reviewerIds.length}>Send feedback requests</button>
            </form>
          )}
          {data.incomingFeedbackRequests.map((request) => (
            <div key={request.id} style={{ padding: 16, borderTop: "1px solid var(--border)" }}>
              <strong>{request.subjectName} · {request.round.title}</strong>
              <span style={{ display: "block", color: "var(--muted)", margin: "4px 0 8px" }}>{request.round.prompt}</span>
              <textarea rows={3} maxLength={8000} value={feedbackDrafts[request.id] ?? ""} onChange={(event) => setFeedbackDrafts({ ...feedbackDrafts, [request.id]: event.target.value })} placeholder="Specific behavior, impact, and useful next step." />
              <button className="primary-button" disabled={busy || !(feedbackDrafts[request.id] ?? "").trim()} onClick={() => void submitFeedback(request.id)}><Send size={13} /> Submit named feedback</button>
            </div>
          ))}
          {data.feedbackRounds.slice(0, 6).map((round) => (
            <div className="leave-request" key={round.id}>
              <div className="inline-icon purple"><MessagesSquare size={14} /></div>
              <div style={{ flex: 1 }}><strong>{round.title}</strong><span>{round.submittedCount}/{round.requestedCount} submitted · {round.status}</span>{round.responses.slice(0, 3).map((response) => <small key={response.id} style={{ display: "block", marginTop: 4 }}>{response.reviewerName}: {response.responseText}</small>)}</div>
            </div>
          ))}
        </article>
      </div>

      <div className="module-grid two" style={{ marginTop: 16 }}>
        <article className="card">
          <div className="card-header">
            <div><div className="card-kicker">MENTORSHIP</div><h3>Ask for development support</h3></div>
            <button className="secondary-button" onClick={() => setShowMentorRequest((value) => !value)}><UsersRound size={13} /> Request mentor</button>
          </div>
          {showMentorRequest && (
            <form onSubmit={requestMentor} style={{ padding: "0 16px 16px" }}>
              <div className="setting-form">
                <label>Mentor<select required value={mentorForm.mentorEmployeeId} onChange={(event) => setMentorForm({ ...mentorForm, mentorEmployeeId: event.target.value })}><option value="">Select employee</option>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} · {employee.title}</option>)}</select></label>
                <label>Cadence<select value={mentorForm.cadence} onChange={(event) => setMentorForm({ ...mentorForm, cadence: event.target.value })}>{cadenceOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                <label style={{ gridColumn: "1 / -1" }}>Development goal<textarea required rows={2} maxLength={500} value={mentorForm.goal} onChange={(event) => setMentorForm({ ...mentorForm, goal: event.target.value })} /></label>
              </div>
              <button className="primary-button" disabled={busy}>Send mentorship request</button>
            </form>
          )}
          {mentorRequests.map((row) => (
            <div key={row.id} style={{ padding: 16, borderTop: "1px solid var(--border)" }}>
              <strong>{data.employeeNames[String(row.menteeEmployeeId)] ?? "Employee"} asked you to mentor them</strong>
              <span style={{ display: "block", margin: "4px 0 8px" }}>{row.goal} · {row.cadence}</span>
              <div className="run-actions"><button className="primary-button" onClick={() => void updateMentorship(row.id, "active")}>Accept</button><button className="secondary-button" onClick={() => void updateMentorship(row.id, "declined")}>Decline</button></div>
            </div>
          ))}
          {data.mentorships.filter((row) => row.status === "active").map((row) => (
            <div className="leave-request" key={row.id}>
              <div className="inline-icon orange"><UserRoundCheck size={14} /></div>
              <div style={{ flex: 1 }}><strong>{data.employeeNames[String(row.menteeEmployeeId)] ?? "Mentee"} ↔ {data.employeeNames[String(row.mentorEmployeeId)] ?? "Mentor"}</strong><span>{row.goal}</span><small>{row.cadence} · active</small></div>
              {(row.menteeEmployeeId === data.employee.id || row.mentorEmployeeId === data.employee.id) && <button className="secondary-button" onClick={() => void updateMentorship(row.id, "completed")}>Complete</button>}
            </div>
          ))}
        </article>

        <article className="card">
          <div className="card-header"><div><div className="card-kicker">ONGOING FEEDBACK</div><h3>Coaching and praise shared with you</h3><p>These notes stay separate from your formal review score.</p></div></div>
          {data.continuousFeedback.length === 0 && <div className="empty-state">No manager feedback has been shared with you yet.</div>}
          {data.continuousFeedback.slice(0, 12).map((row) => (
            <div className="leave-request" key={row.id}>
              <div className="inline-icon mint"><UserRoundCheck size={14} /></div>
              <div><strong>{row.kind}</strong><span>{row.message}</span><small>{row.authorName} · {new Date(row.createdAt).toLocaleDateString("en-PH")}</small></div>
            </div>
          ))}
        </article>
      </div>
    </section>
  );
}
