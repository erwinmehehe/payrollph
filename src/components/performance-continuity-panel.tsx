"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock3,
  MessageSquare,
  Plus,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

type Employee = {
  id: number;
  firstName: string;
  lastName: string;
  title: string;
  orgUnitId: number | null;
};

type AgendaContribution = {
  id: number;
  authorName: string;
  content: string;
  createdAt: string;
};

type OneOnOne = {
  id: number;
  employeeId: number;
  managerUserId: number;
  scheduledFor: string;
  status: string;
  agenda: string | null;
  sharedSummary: string | null;
  privateManagerNotes: string | null;
  completedAt: string | null;
  agendaContributions: AgendaContribution[];
};

type Feedback = {
  id: number;
  employeeId: number;
  goalId: number | null;
  authorUserId: number | null;
  authorName: string;
  feedbackType: string;
  visibility: string;
  content: string;
  occurredAt: string;
};

type Reminder = {
  id: number;
  employeeId: number;
  reminderType: string;
  stage: string;
  dueDate: string;
  status: string;
  ownerName: string | null;
};

type Goal = {
  id: number;
  employeeId: number | null;
  orgUnitId: number | null;
  scope: string;
  title: string;
};

type Analytics = {
  cycle: { id: number; name: string; startDate: string; endDate: string; status: string } | null;
  summary: {
    completionRate: number;
    completedReviews: number;
    totalReviews: number;
    averageFinalScore: number | null;
    goalAttainment: number;
    oneOnOneCoverage: number;
    openReminders: number;
    overdueReminders: number;
    roleCompetencyItems: number;
    belowRoleExpectation: number;
  };
  byManager: Array<{
    managerUserId: number | null;
    managerName: string;
    totalReviews: number;
    completedReviews: number;
    completionRate: number;
    averageFinalScore: number | null;
  }>;
  byOrgUnit: Array<{
    orgUnitId: number | null;
    orgUnitName: string;
    totalReviews: number;
    completedReviews: number;
    completionRate: number;
    averageFinalScore: number | null;
  }>;
  ratingDistribution: Array<{ bucket: string; count: number; percentage: number }>;
  activity: { completedOneOnOnes: number; feedbackEntries: number };
  calibration: null | { status: string; changedRatings: number; totalRatings: number; openFlags: number; acceptedFlags: number; resolvedFlags: number };
};

function localDateTime(value: string) {
  return new Date(value).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function PerformanceContinuityPanel({
  organizationId,
  setNotice,
}: {
  organizationId: number;
  setNotice: (message: string) => void;
}) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [oneOnOnes, setOneOnOnes] = useState<OneOnOne[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [access, setAccess] = useState<{ userId: number; companyPeopleAdmin: boolean } | null>(null);
  const [showMeeting, setShowMeeting] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  const [meetingForm, setMeetingForm] = useState({
    employeeId: "",
    scheduledFor: "",
    agenda: "",
  });
  const [feedbackForm, setFeedbackForm] = useState({
    employeeId: "",
    goalId: "",
    feedbackType: "general",
    visibility: "employee_shared",
    content: "",
  });
  const [summaries, setSummaries] = useState<Record<number, string>>({});
  const [privateNotes, setPrivateNotes] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    const [continuousResponse, analyticsResponse] = await Promise.all([
      fetch("/api/performance/continuous?organizationId=" + organizationId, { cache: "no-store" }),
      fetch("/api/performance/analytics?organizationId=" + organizationId, { cache: "no-store" }),
    ]);
    const [continuousPayload, analyticsPayload] = await Promise.all([
      continuousResponse.json().catch(() => ({})),
      analyticsResponse.json().catch(() => ({})),
    ]);
    if (!continuousResponse.ok) {
      setNotice(continuousPayload.error ?? "Could not load continuous performance data.");
      return;
    }
    if (!analyticsResponse.ok) {
      setNotice(analyticsPayload.error ?? "Could not load performance analytics.");
      return;
    }
    setEmployees(continuousPayload.employees ?? []);
    setOneOnOnes(continuousPayload.oneOnOnes ?? []);
    setFeedback(continuousPayload.feedback ?? []);
    setReminders(continuousPayload.reminders ?? []);
    setGoals(continuousPayload.goals ?? []);
    setAccess(continuousPayload.access ?? null);
    setAnalytics(analyticsPayload);
    setSummaries(Object.fromEntries((continuousPayload.oneOnOnes ?? []).map((meeting: OneOnOne) => [
      meeting.id,
      meeting.sharedSummary ?? "",
    ])));
    setPrivateNotes(Object.fromEntries((continuousPayload.oneOnOnes ?? []).map((meeting: OneOnOne) => [
      meeting.id,
      meeting.privateManagerNotes ?? "",
    ])));
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  const employeeName = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee.firstName + " " + employee.lastName])),
    [employees],
  );

  const feedbackGoalOptions = goals.filter((goal) => {
    const employeeId = Number(feedbackForm.employeeId);
    if (!employeeId) return false;
    const employee = employees.find((item) => item.id === employeeId);
    return goal.scope === "company"
      || (goal.scope === "team" && goal.orgUnitId === employee?.orgUnitId)
      || (goal.scope === "employee" && goal.employeeId === employeeId);
  });

  async function scheduleMeeting(event: React.FormEvent) {
    event.preventDefault();
    const scheduledFor = meetingForm.scheduledFor
      ? new Date(meetingForm.scheduledFor + ":00+08:00").toISOString()
      : "";
    const response = await fetch("/api/performance/continuous", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        entityType: "one_on_one",
        employeeId: Number(meetingForm.employeeId),
        scheduledFor,
        agenda: meetingForm.agenda,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not schedule 1:1.");
      return;
    }
    setMeetingForm({ employeeId: "", scheduledFor: "", agenda: "" });
    setShowMeeting(false);
    await load();
    setNotice("1:1 scheduled and added to the governed performance record.");
  }

  async function addFeedback(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/performance/continuous", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        entityType: "feedback",
        employeeId: Number(feedbackForm.employeeId),
        goalId: feedbackForm.goalId ? Number(feedbackForm.goalId) : null,
        feedbackType: feedbackForm.feedbackType,
        visibility: feedbackForm.visibility,
        content: feedbackForm.content,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not record feedback.");
      return;
    }
    setFeedbackForm({ employeeId: "", goalId: "", feedbackType: "general", visibility: "employee_shared", content: "" });
    setShowFeedback(false);
    await load();
    setNotice("Continuous performance feedback recorded.");
  }

  async function updateMeeting(meeting: OneOnOne, action: "complete" | "cancel") {
    const response = await fetch("/api/performance/continuous", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        oneOnOneId: meeting.id,
        action,
        sharedSummary: summaries[meeting.id] ?? "",
        privateManagerNotes: privateNotes[meeting.id] ?? "",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not update 1:1.");
      return;
    }
    await load();
    setNotice(action === "complete" ? "1:1 completed. Shared and manager-private notes remain separated." : "1:1 cancelled.");
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <article className="card" style={{ padding: 20 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">CONTINUOUS PERFORMANCE</div>
            <h2>1:1s, feedback, reminders, and completion analytics</h2>
            <p>Keep performance evidence current between formal review events without turning informal feedback into compensation actions.</p>
          </div>
          <div className="page-actions">
            <button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
            <button className="secondary-button" type="button" onClick={() => setShowFeedback((value) => !value)}><MessageSquare size={14} /> Feedback</button>
            <button className="primary-button" type="button" onClick={() => setShowMeeting((value) => !value)}><CalendarClock size={14} /> Schedule 1:1</button>
          </div>
        </div>

        {showMeeting && (
          <form onSubmit={scheduleMeeting} style={{ marginTop: 14 }}>
            <div className="setting-form">
              <label>Employee<select required value={meetingForm.employeeId} onChange={(event) => setMeetingForm({ ...meetingForm, employeeId: event.target.value })}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} · {employee.title}</option>)}</select></label>
              <label>Date and time<input required type="datetime-local" value={meetingForm.scheduledFor} onChange={(event) => setMeetingForm({ ...meetingForm, scheduledFor: event.target.value })} /></label>
              <label style={{ gridColumn: "1 / -1" }}>Shared agenda<textarea rows={2} value={meetingForm.agenda} onChange={(event) => setMeetingForm({ ...meetingForm, agenda: event.target.value })} placeholder="Topics, goals, blockers, development priorities." /></label>
            </div>
            <div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowMeeting(false)}>Cancel</button><button className="primary-button"><Plus size={14} /> Schedule</button></div>
          </form>
        )}

        {showFeedback && (
          <form onSubmit={addFeedback} style={{ marginTop: 14 }}>
            <div className="setting-form">
              <label>Employee<select required value={feedbackForm.employeeId} onChange={(event) => setFeedbackForm({ ...feedbackForm, employeeId: event.target.value, goalId: "" })}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>
              <label>Type<select value={feedbackForm.feedbackType} onChange={(event) => setFeedbackForm({ ...feedbackForm, feedbackType: event.target.value })}><option value="general">General</option><option value="praise">Praise</option><option value="coaching">Coaching</option><option value="development">Development</option></select></label>
              <label>Visibility<select value={feedbackForm.visibility} onChange={(event) => setFeedbackForm({ ...feedbackForm, visibility: event.target.value })}><option value="employee_shared">Shared with employee</option><option value="manager_private">Manager private</option></select></label>
              <label>Linked goal<select value={feedbackForm.goalId} onChange={(event) => setFeedbackForm({ ...feedbackForm, goalId: event.target.value })}><option value="">No linked goal</option>{feedbackGoalOptions.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>
              <label style={{ gridColumn: "1 / -1" }}>Feedback<textarea required minLength={5} rows={3} value={feedbackForm.content} onChange={(event) => setFeedbackForm({ ...feedbackForm, content: event.target.value })} /></label>
            </div>
            <div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowFeedback(false)}>Cancel</button><button className="primary-button">Record feedback</button></div>
          </form>
        )}
      </article>

      {analytics?.cycle && (
        <article className="card" style={{ padding: 20 }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">PERFORMANCE ANALYTICS</div>
              <h2>{analytics.cycle.name}</h2>
              <p>Completion and rating distribution for the employees inside your authorized scope.</p>
            </div>
            <BarChart3 size={18} />
          </div>
          <section className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <article className="stat-card"><p>REVIEW COMPLETION</p><h3>{analytics.summary.completionRate}%</h3><span>{analytics.summary.completedReviews}/{analytics.summary.totalReviews} complete</span></article>
            <article className="stat-card"><p>AVG FINAL RATING</p><h3>{analytics.summary.averageFinalScore ?? "—"}</h3><span>Out of 5.00</span></article>
            <article className="stat-card"><p>GOAL ATTAINMENT</p><h3>{analytics.summary.goalAttainment}%</h3><span>Average employee-goal progress</span></article>
            <article className="stat-card"><p>1:1 COVERAGE</p><h3>{analytics.summary.oneOnOneCoverage}%</h3><span>{analytics.activity.completedOneOnOnes} completed check-ins</span></article>
          </section>
          <div className="notice notice-amber" style={{ marginTop: 14 }}>
            <span>Role competency gaps: {analytics.summary.belowRoleExpectation}/{analytics.summary.roleCompetencyItems} scored job-linked competency item(s) are below the frozen role expectation.</span>
          </div>

          <section className="module-grid two" style={{ marginTop: 14 }}>
            <div>
              <div className="card-kicker">BY MANAGER</div>
              {analytics.byManager.length === 0 ? <div className="empty-state">No review assignments.</div> : analytics.byManager.map((row) => (
                <div className="leave-request" key={String(row.managerUserId)}>
                  <div style={{ flex: 1 }}><strong>{row.managerName}</strong><span>{row.completedReviews}/{row.totalReviews} complete · {row.completionRate}% · avg {row.averageFinalScore ?? "—"}</span></div>
                </div>
              ))}
            </div>
            <div>
              <div className="card-kicker">BY ORG UNIT</div>
              {analytics.byOrgUnit.length === 0 ? <div className="empty-state">No org-unit review data.</div> : analytics.byOrgUnit.map((row) => (
                <div className="leave-request" key={String(row.orgUnitId)}>
                  <div style={{ flex: 1 }}><strong>{row.orgUnitName}</strong><span>{row.completedReviews}/{row.totalReviews} complete · {row.completionRate}% · avg {row.averageFinalScore ?? "—"}</span></div>
                </div>
              ))}
            </div>
          </section>

          <div style={{ marginTop: 14 }}>
            <div className="card-kicker">RATING DISTRIBUTION</div>
            {analytics.ratingDistribution.map((bucket) => (
              <div className="leave-request" key={bucket.bucket}>
                <div style={{ flex: 1 }}><strong>{bucket.bucket}</strong><span>{bucket.count} rating(s) · {bucket.percentage}%</span></div>
              </div>
            ))}
          </div>

          {analytics.calibration && (
            <div className="notice notice-amber" style={{ marginTop: 14 }}>
              <span>Calibration {analytics.calibration.status}: {analytics.calibration.changedRatings}/{analytics.calibration.totalRatings} rating(s) changed · {analytics.calibration.openFlags} open flag(s) · {analytics.calibration.acceptedFlags} accepted · {analytics.calibration.resolvedFlags} resolved.</span>
            </div>
          )}
        </article>
      )}

      <section className="module-grid two">
        <article className="card">
          <div className="card-header"><div><div className="card-kicker">1:1 RECORDS</div><h2>Manager check-ins</h2><p>Shared summaries are employee-visible; private manager notes remain restricted.</p></div><CalendarClock size={18} /></div>
          {oneOnOnes.length === 0 && <div className="empty-state">No 1:1 records yet.</div>}
          {oneOnOnes.map((meeting) => {
            const mayEdit = meeting.status === "scheduled" && (access?.companyPeopleAdmin || meeting.managerUserId === access?.userId);
            return (
              <div className="employee-edit-card" key={meeting.id} style={{ marginBottom: 12 }}>
                <div className="employee-list-card-head">
                  <div>
                    <span className="card-kicker">{meeting.status.toUpperCase()}</span>
                    <h3>{employeeName.get(meeting.employeeId) ?? "Employee #" + meeting.employeeId}</h3>
                    <p>{localDateTime(meeting.scheduledFor)}</p>
                  </div>
                  <Clock3 size={17} />
                </div>
                {meeting.agenda && <p><strong>Manager agenda:</strong> {meeting.agenda}</p>}
                {(meeting.agendaContributions ?? []).length > 0 && (
                  <div className="notice notice-green" style={{ marginBottom: 10 }}>
                    <span>
                      <strong>Employee agenda contributions</strong><br />
                      {(meeting.agendaContributions ?? []).map((item) => item.content).join(" · ")}
                    </span>
                  </div>
                )}
                {meeting.status === "completed" && meeting.sharedSummary && <p><strong>Shared summary:</strong> {meeting.sharedSummary}</p>}
                {meeting.status === "completed" && meeting.privateManagerNotes && <p><strong>Manager-private:</strong> {meeting.privateManagerNotes}</p>}
                {mayEdit && (
                  <>
                    <div className="setting-form">
                      <label style={{ gridColumn: "1 / -1" }}>Shared summary<textarea rows={2} value={summaries[meeting.id] ?? ""} onChange={(event) => setSummaries((current) => ({ ...current, [meeting.id]: event.target.value }))} /></label>
                      <label style={{ gridColumn: "1 / -1" }}>Private manager notes<textarea rows={2} value={privateNotes[meeting.id] ?? ""} onChange={(event) => setPrivateNotes((current) => ({ ...current, [meeting.id]: event.target.value }))} /></label>
                    </div>
                    <div className="run-actions"><button className="secondary-button" type="button" onClick={() => void updateMeeting(meeting, "cancel")}>Cancel 1:1</button><button className="primary-button" type="button" onClick={() => void updateMeeting(meeting, "complete")}><CheckCircle2 size={14} /> Complete 1:1</button></div>
                  </>
                )}
              </div>
            );
          })}
        </article>

        <article className="card">
          <div className="card-header"><div><div className="card-kicker">FEEDBACK TIMELINE</div><h2>Continuous evidence</h2><p>Feedback is append-only and can be linked to governed goals.</p></div><MessageSquare size={18} /></div>
          {feedback.length === 0 && <div className="empty-state">No continuous feedback yet.</div>}
          {feedback.map((item) => (
            <div className="leave-request" key={item.id}>
              <div style={{ flex: 1 }}>
                <strong>{employeeName.get(item.employeeId) ?? "Employee #" + item.employeeId}</strong>
                <span>{item.feedbackType} · {item.visibility === "employee_shared" ? "shared" : "manager private"} · {item.authorName}</span>
                <p>{item.content}</p>
              </div>
            </div>
          ))}
        </article>
      </section>

      <article className="card">
        <div className="card-header">
          <div>
            <div className="card-kicker">REVIEW REMINDERS</div>
            <h2>Due-date automation</h2>
            <p>Scheduler-generated reminders resolve automatically when the self-assessment or manager review requirement is completed.</p>
          </div>
          {analytics?.summary.overdueReminders ? <TriangleAlert size={18} /> : <CheckCircle2 size={18} />}
        </div>
        {reminders.filter((task) => task.status === "open").length === 0 ? (
          <div className="empty-state">No open performance reminders in your queue.</div>
        ) : reminders.filter((task) => task.status === "open").map((task) => (
          <div className="leave-request" key={task.id}>
            <div style={{ flex: 1 }}>
              <strong>{employeeName.get(task.employeeId) ?? "Employee #" + task.employeeId}</strong>
              <span>{task.reminderType.replaceAll("_", " ")} · {task.stage.replaceAll("_", " ")} · due {task.dueDate}</span>
            </div>
            <span className={"employee-status-pill " + (task.stage.startsWith("overdue") ? "bad" : task.stage === "due" ? "warn" : "neutral")}>{task.stage.replaceAll("_", " ")}</span>
          </div>
        ))}
      </article>
    </div>
  );
}
