"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck, GitBranch, MessagesSquare, Plus, RefreshCw, Send, Target, UserRoundCheck, UsersRound } from "lucide-react";

type Employee = { id: number; firstName: string; lastName: string; title: string; orgUnitId: number | null; status?: string };
type Unit = { id: number; name: string };
type StrategicGoal = { id: number; scope: string; orgUnitId: number | null; ownerEmployeeId: number | null; title: string; description: string | null; progress: number; status: string; dueDate: string | null };
type EmployeeGoal = { id: number; employeeId: number; title: string; progress: number; status: string; cycleId: number | null };
type Alignment = { id: number; performanceGoalId: number; strategicGoalId: number; contributionWeight: number };
type OneOnOneSeries = { id: number; managerEmployeeId: number | null; employeeId: number; cadence: string; agendaTemplate: string | null; active: boolean };
type OneOnOneMeeting = { id: number; seriesId: number; scheduledDate: string; status: string; employeeUpdate: string | null; managerUpdate: string | null; sharedNotes: string | null; managerPrivateNotes: string | null };
type ActionItem = { id: number; meetingId: number; ownerEmployeeId: number | null; title: string; dueDate: string | null; status: string };
type FeedbackRound = { id: number; subjectEmployeeId: number; title: string; prompt: string; dueDate: string | null; status: string };
type FeedbackRequest = { id: number; roundId: number; reviewerEmployeeId: number; relationship: string; status: string; responseText: string | null; submittedAt: string | null };
type Mentorship = { id: number; mentorEmployeeId: number; menteeEmployeeId: number; goal: string; cadence: string; status: string; startDate: string | null; endDate: string | null };
type Payload = {
  access: { role: string; companyWide: boolean; orgUnitId: number | null };
  currentEmployeeId: number | null;
  orgUnits: Unit[];
  employees: Employee[];
  allActiveEmployees: Employee[];
  strategicGoals: StrategicGoal[];
  employeeGoals: EmployeeGoal[];
  alignments: Alignment[];
  oneOnOneSeries: OneOnOneSeries[];
  oneOnOneMeetings: OneOnOneMeeting[];
  oneOnOneActionItems: ActionItem[];
  feedbackRounds: FeedbackRound[];
  feedbackRequests: FeedbackRequest[];
  mentorships: Mentorship[];
  employeeNames: Record<string, string>;
};

const cadenceOptions = ["weekly", "biweekly", "monthly", "quarterly"];

export function ManagerExperiencePanel({ organizationId, setNotice }: { organizationId: number; setNotice: (message: string) => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [showGoal, setShowGoal] = useState(false);
  const [showOneOnOne, setShowOneOnOne] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showMentorship, setShowMentorship] = useState(false);
  const [goalForm, setGoalForm] = useState({ scope: "team", orgUnitId: "", ownerEmployeeId: "", title: "", description: "", dueDate: "" });
  const [alignmentForm, setAlignmentForm] = useState({ performanceGoalId: "", strategicGoalId: "", contributionWeight: "100" });
  const [oneOnOneForm, setOneOnOneForm] = useState({ employeeId: "", managerEmployeeId: "", cadence: "biweekly", firstMeetingDate: "", agendaTemplate: "" });
  const [meetingDrafts, setMeetingDrafts] = useState<Record<number, { managerUpdate: string; sharedNotes: string; managerPrivateNotes: string }>>({});
  const [feedbackForm, setFeedbackForm] = useState({ subjectEmployeeId: "", title: "", prompt: "", dueDate: "", reviewerIds: [] as string[] });
  const [mentorshipForm, setMentorshipForm] = useState({ mentorEmployeeId: "", menteeEmployeeId: "", goal: "", cadence: "monthly" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/experience?organizationId=${organizationId}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error ?? "Could not load manager experience.");
        return;
      }
      setData(payload);
      setOneOnOneForm((current) => ({
        ...current,
        managerEmployeeId: current.managerEmployeeId || String(payload.currentEmployeeId ?? ""),
      }));
    } finally {
      setLoading(false);
    }
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  const employeeName = useMemo(
    () => new Map((data?.allActiveEmployees ?? []).map((employee) => [employee.id, employee.firstName + " " + employee.lastName])),
    [data],
  );
  const seriesById = useMemo(() => new Map((data?.oneOnOneSeries ?? []).map((series) => [series.id, series])), [data]);

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/experience", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, ...body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Experience change failed.");
    return payload;
  }

  async function patch(body: Record<string, unknown>) {
    const response = await fetch("/api/experience", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, ...body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Experience change failed.");
    return payload;
  }

  async function createStrategicGoal(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "strategic_goal",
        scope: goalForm.scope,
        orgUnitId: goalForm.orgUnitId ? Number(goalForm.orgUnitId) : null,
        ownerEmployeeId: goalForm.ownerEmployeeId ? Number(goalForm.ownerEmployeeId) : null,
        title: goalForm.title,
        description: goalForm.description,
        dueDate: goalForm.dueDate || null,
      });
      setGoalForm({ scope: "team", orgUnitId: "", ownerEmployeeId: "", title: "", description: "", dueDate: "" });
      setShowGoal(false);
      await load();
      setNotice("Strategic goal created.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create strategic goal."); }
  }

  async function alignGoal(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "goal_alignment",
        performanceGoalId: Number(alignmentForm.performanceGoalId),
        strategicGoalId: Number(alignmentForm.strategicGoalId),
        contributionWeight: Number(alignmentForm.contributionWeight),
      });
      setAlignmentForm({ performanceGoalId: "", strategicGoalId: "", contributionWeight: "100" });
      await load();
      setNotice("Employee goal aligned to the strategic objective.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not align goal."); }
  }

  async function createOneOnOne(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "one_on_one_series",
        employeeId: Number(oneOnOneForm.employeeId),
        managerEmployeeId: oneOnOneForm.managerEmployeeId ? Number(oneOnOneForm.managerEmployeeId) : null,
        cadence: oneOnOneForm.cadence,
        firstMeetingDate: oneOnOneForm.firstMeetingDate,
        agendaTemplate: oneOnOneForm.agendaTemplate,
      });
      setOneOnOneForm((current) => ({ employeeId: "", managerEmployeeId: current.managerEmployeeId, cadence: "biweekly", firstMeetingDate: "", agendaTemplate: "" }));
      setShowOneOnOne(false);
      await load();
      setNotice("Recurring one-on-one created.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create one-on-one."); }
  }

  async function completeMeeting(meeting: OneOnOneMeeting) {
    const draft = meetingDrafts[meeting.id] ?? { managerUpdate: meeting.managerUpdate ?? "", sharedNotes: meeting.sharedNotes ?? "", managerPrivateNotes: meeting.managerPrivateNotes ?? "" };
    try {
      await patch({
        action: "one_on_one_meeting",
        meetingId: meeting.id,
        status: "completed",
        ...draft,
      });
      await load();
      setNotice("One-on-one completed and the next recurring meeting was scheduled.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not complete one-on-one."); }
  }

  async function addAction(meetingId: number) {
    const title = window.prompt("Action item");
    if (!title?.trim()) return;
    try {
      await post({ entityType: "one_on_one_action", meetingId, title: title.trim() });
      await load();
      setNotice("One-on-one action item added.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not add action item."); }
  }

  async function createFeedbackRound(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "feedback_round",
        subjectEmployeeId: Number(feedbackForm.subjectEmployeeId),
        title: feedbackForm.title,
        prompt: feedbackForm.prompt,
        dueDate: feedbackForm.dueDate || null,
        reviewers: feedbackForm.reviewerIds.map((employeeId) => ({ employeeId: Number(employeeId), relationship: "peer" })),
      });
      setFeedbackForm({ subjectEmployeeId: "", title: "", prompt: "", dueDate: "", reviewerIds: [] });
      setShowFeedback(false);
      await load();
      setNotice("Named 360 feedback round opened.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not open feedback round."); }
  }

  async function createMentorship(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "mentorship",
        mentorEmployeeId: Number(mentorshipForm.mentorEmployeeId),
        menteeEmployeeId: Number(mentorshipForm.menteeEmployeeId),
        goal: mentorshipForm.goal,
        cadence: mentorshipForm.cadence,
      });
      setMentorshipForm({ mentorEmployeeId: "", menteeEmployeeId: "", goal: "", cadence: "monthly" });
      setShowMentorship(false);
      await load();
      setNotice("Mentorship activated.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create mentorship."); }
  }

  if (!data) {
    return <article className="card" style={{ padding: 20, marginBottom: 16 }}>{loading ? "Loading continuous performance…" : "Manager experience data unavailable."}</article>;
  }

  const upcomingMeetings = data.oneOnOneMeetings.filter((meeting) => meeting.status === "scheduled").slice(0, 10);
  const openFeedback = data.feedbackRounds.filter((round) => round.status === "open");
  const activeMentorships = data.mentorships.filter((row) => ["requested", "active"].includes(row.status));

  return (
    <section style={{ marginBottom: 18 }}>
      <div className="card-header" style={{ marginBottom: 12 }}>
        <div>
          <div className="card-kicker">CONTINUOUS PERFORMANCE</div>
          <h2>Manager and employee experience</h2>
          <p>Connect strategic goals to employee outcomes, run recurring 1:1s, request named 360 feedback, and support mentorship without changing formal review scores.</p>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> Refresh</button>
      </div>

      <section className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="stat-card"><div className="stat-icon blue"><GitBranch size={18} /></div><p>STRATEGIC GOALS</p><h3>{data.strategicGoals.filter((goal) => goal.status === "active").length}</h3><span>{data.alignments.length} employee goal links</span></article>
        <article className="stat-card"><div className="stat-icon mint"><CalendarCheck size={18} /></div><p>UPCOMING 1:1s</p><h3>{upcomingMeetings.length}</h3><span>{data.oneOnOneSeries.filter((row) => row.active).length} recurring series</span></article>
        <article className="stat-card"><div className="stat-icon purple"><MessagesSquare size={18} /></div><p>OPEN 360 ROUNDS</p><h3>{openFeedback.length}</h3><span>Named feedback workflow</span></article>
        <article className="stat-card"><div className="stat-icon orange"><UserRoundCheck size={18} /></div><p>MENTORSHIPS</p><h3>{activeMentorships.length}</h3><span>Requested or active</span></article>
      </section>

      <div className="page-actions" style={{ justifyContent: "flex-start", marginBottom: 16 }}>
        <button className="secondary-button" onClick={() => setShowGoal((value) => !value)}><Target size={14} /> Strategic goal</button>
        <button className="secondary-button" onClick={() => setShowOneOnOne((value) => !value)}><CalendarCheck size={14} /> Recurring 1:1</button>
        <button className="secondary-button" onClick={() => setShowFeedback((value) => !value)}><MessagesSquare size={14} /> 360 request</button>
        <button className="secondary-button" onClick={() => setShowMentorship((value) => !value)}><UsersRound size={14} /> Mentorship</button>
      </div>

      {showGoal && (
        <article className="card" style={{ padding: 18, marginBottom: 14 }}>
          <div className="card-kicker">GOAL CASCADE</div><h3>Create a company or team objective</h3>
          <form onSubmit={createStrategicGoal}>
            <div className="setting-form">
              <label>Scope<select value={goalForm.scope} onChange={(event) => setGoalForm({ ...goalForm, scope: event.target.value })}><option value="team">Team</option>{data.access.companyWide && <option value="company">Company</option>}</select></label>
              {goalForm.scope === "team" && <label>Team<select required value={goalForm.orgUnitId || String(data.access.orgUnitId ?? "")} onChange={(event) => setGoalForm({ ...goalForm, orgUnitId: event.target.value })}><option value="">Select team</option>{data.orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>}
              <label>Owner<select value={goalForm.ownerEmployeeId} onChange={(event) => setGoalForm({ ...goalForm, ownerEmployeeId: event.target.value })}><option value="">Unassigned</option>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>
              <label>Due date<input type="date" value={goalForm.dueDate} onChange={(event) => setGoalForm({ ...goalForm, dueDate: event.target.value })} /></label>
              <label style={{ gridColumn: "1 / -1" }}>Objective<input required value={goalForm.title} onChange={(event) => setGoalForm({ ...goalForm, title: event.target.value })} placeholder="Improve customer onboarding reliability" /></label>
              <label style={{ gridColumn: "1 / -1" }}>Description<textarea rows={2} value={goalForm.description} onChange={(event) => setGoalForm({ ...goalForm, description: event.target.value })} /></label>
            </div>
            <div className="run-actions"><button className="primary-button">Create objective</button></div>
          </form>
        </article>
      )}

      {showOneOnOne && (
        <article className="card" style={{ padding: 18, marginBottom: 14 }}>
          <div className="card-kicker">RECURRING 1:1</div><h3>Start a recurring manager conversation</h3>
          <form onSubmit={createOneOnOne}>
            <div className="setting-form">
              <label>Employee<select required value={oneOnOneForm.employeeId} onChange={(event) => setOneOnOneForm({ ...oneOnOneForm, employeeId: event.target.value })}><option value="">Select employee</option>{data.employees.filter((employee) => employee.id !== Number(oneOnOneForm.managerEmployeeId)).map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>
              {data.access.role !== "manager" && <label>Manager<select required value={oneOnOneForm.managerEmployeeId} onChange={(event) => setOneOnOneForm({ ...oneOnOneForm, managerEmployeeId: event.target.value })}><option value="">Select manager</option>{data.allActiveEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>}
              <label>Cadence<select value={oneOnOneForm.cadence} onChange={(event) => setOneOnOneForm({ ...oneOnOneForm, cadence: event.target.value })}>{cadenceOptions.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
              <label>First meeting<input required type="date" value={oneOnOneForm.firstMeetingDate} onChange={(event) => setOneOnOneForm({ ...oneOnOneForm, firstMeetingDate: event.target.value })} /></label>
              <label style={{ gridColumn: "1 / -1" }}>Agenda template<textarea rows={2} value={oneOnOneForm.agendaTemplate} onChange={(event) => setOneOnOneForm({ ...oneOnOneForm, agendaTemplate: event.target.value })} placeholder="Wins · priorities · blockers · growth · support needed" /></label>
            </div>
            <div className="run-actions"><button className="primary-button">Create recurring 1:1</button></div>
          </form>
        </article>
      )}

      {showFeedback && (
        <article className="card" style={{ padding: 18, marginBottom: 14 }}>
          <div className="card-kicker">NAMED 360 FEEDBACK</div><h3>Ask several colleagues for structured feedback</h3>
          <div className="notice" style={{ margin: "10px 0" }}><span>This workflow is named, not anonymous. Reviewers know their feedback is attributable.</span></div>
          <form onSubmit={createFeedbackRound}>
            <div className="setting-form">
              <label>Subject<select required value={feedbackForm.subjectEmployeeId} onChange={(event) => setFeedbackForm({ ...feedbackForm, subjectEmployeeId: event.target.value, reviewerIds: feedbackForm.reviewerIds.filter((id) => id !== event.target.value) })}><option value="">Select employee</option>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>
              <label>Due date<input type="date" value={feedbackForm.dueDate} onChange={(event) => setFeedbackForm({ ...feedbackForm, dueDate: event.target.value })} /></label>
              <label style={{ gridColumn: "1 / -1" }}>Round title<input required value={feedbackForm.title} onChange={(event) => setFeedbackForm({ ...feedbackForm, title: event.target.value })} placeholder="Q4 growth feedback" /></label>
              <label style={{ gridColumn: "1 / -1" }}>Prompt<textarea required rows={2} value={feedbackForm.prompt} onChange={(event) => setFeedbackForm({ ...feedbackForm, prompt: event.target.value })} placeholder="What should this person continue, start, or change?" /></label>
              <label style={{ gridColumn: "1 / -1" }}>Reviewers<select multiple required value={feedbackForm.reviewerIds} onChange={(event) => setFeedbackForm({ ...feedbackForm, reviewerIds: Array.from(event.currentTarget.selectedOptions).map((option) => option.value) })} style={{ minHeight: 110 }}>{data.allActiveEmployees.filter((employee) => employee.id !== Number(feedbackForm.subjectEmployeeId)).map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} · {employee.title}</option>)}</select><small>Ctrl/Cmd-click to choose multiple reviewers. Relationship defaults to peer in this first UI.</small></label>
            </div>
            <div className="run-actions"><button className="primary-button">Open feedback round</button></div>
          </form>
        </article>
      )}

      {showMentorship && (
        <article className="card" style={{ padding: 18, marginBottom: 14 }}>
          <div className="card-kicker">MENTORSHIP</div><h3>Connect development with a recurring mentor relationship</h3>
          <form onSubmit={createMentorship}>
            <div className="setting-form">
              <label>Mentee<select required value={mentorshipForm.menteeEmployeeId} onChange={(event) => setMentorshipForm({ ...mentorshipForm, menteeEmployeeId: event.target.value })}><option value="">Select mentee</option>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>
              <label>Mentor<select required value={mentorshipForm.mentorEmployeeId} onChange={(event) => setMentorshipForm({ ...mentorshipForm, mentorEmployeeId: event.target.value })}><option value="">Select mentor</option>{data.allActiveEmployees.filter((employee) => employee.id !== Number(mentorshipForm.menteeEmployeeId)).map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>
              <label>Cadence<select value={mentorshipForm.cadence} onChange={(event) => setMentorshipForm({ ...mentorshipForm, cadence: event.target.value })}>{cadenceOptions.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
              <label style={{ gridColumn: "1 / -1" }}>Development goal<textarea required rows={2} value={mentorshipForm.goal} onChange={(event) => setMentorshipForm({ ...mentorshipForm, goal: event.target.value })} /></label>
            </div>
            <div className="run-actions"><button className="primary-button">Activate mentorship</button></div>
          </form>
        </article>
      )}

      <section className="module-grid two">
        <article className="card">
          <div className="card-header"><div><div className="card-kicker">GOAL CASCADE</div><h3>Strategic objectives and employee alignment</h3></div></div>
          {data.strategicGoals.length === 0 && <div className="empty-state">No strategic goals yet.</div>}
          {data.strategicGoals.map((goal) => (
            <div className="leave-request" key={goal.id}>
              <div className="inline-icon blue"><GitBranch size={15} /></div>
              <div style={{ flex: 1 }}>
                <strong>{goal.title}</strong>
                <span>{goal.scope} · {goal.progress}% · {goal.status}{goal.dueDate ? " · due " + goal.dueDate : ""}</span>
                <small>{data.alignments.filter((row) => row.strategicGoalId === goal.id).length} aligned employee goal(s)</small>
              </div>
            </div>
          ))}
          {data.strategicGoals.length > 0 && data.employeeGoals.length > 0 && (
            <form onSubmit={alignGoal} style={{ padding: 16, borderTop: "1px solid var(--border)" }}>
              <div className="setting-form">
                <label>Employee goal<select required value={alignmentForm.performanceGoalId} onChange={(event) => setAlignmentForm({ ...alignmentForm, performanceGoalId: event.target.value })}><option value="">Select goal</option>{data.employeeGoals.map((goal) => <option key={goal.id} value={goal.id}>{employeeName.get(goal.employeeId)} · {goal.title}</option>)}</select></label>
                <label>Strategic goal<select required value={alignmentForm.strategicGoalId} onChange={(event) => setAlignmentForm({ ...alignmentForm, strategicGoalId: event.target.value })}><option value="">Select objective</option>{data.strategicGoals.filter((goal) => goal.status === "active").map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>
                <label>Contribution %<input type="number" min="1" max="100" value={alignmentForm.contributionWeight} onChange={(event) => setAlignmentForm({ ...alignmentForm, contributionWeight: event.target.value })} /></label>
              </div>
              <button className="secondary-button"><GitBranch size={13} /> Align goal</button>
            </form>
          )}
        </article>

        <article className="card">
          <div className="card-header"><div><div className="card-kicker">RECURRING 1:1s</div><h3>Upcoming manager conversations</h3></div></div>
          {upcomingMeetings.length === 0 && <div className="empty-state">No scheduled one-on-ones.</div>}
          {upcomingMeetings.map((meeting) => {
            const series = seriesById.get(meeting.seriesId);
            const mayComplete = Boolean(data.currentEmployeeId && series?.managerEmployeeId === data.currentEmployeeId);
            const draft = meetingDrafts[meeting.id] ?? { managerUpdate: meeting.managerUpdate ?? "", sharedNotes: meeting.sharedNotes ?? "", managerPrivateNotes: meeting.managerPrivateNotes ?? "" };
            return (
              <div key={meeting.id} style={{ padding: 16, borderTop: "1px solid var(--border)" }}>
                <strong>{series ? employeeName.get(series.employeeId) ?? "Employee" : "Employee"} · {meeting.scheduledDate}</strong>
                <div style={{ color: "var(--muted)", fontSize: 12, margin: "4px 0 10px" }}>{series?.cadence ?? "recurring"}{meeting.employeeUpdate ? " · employee prep submitted" : ""}</div>
                {meeting.employeeUpdate && <div className="notice" style={{ marginBottom: 8 }}><span><strong>Employee update:</strong> {meeting.employeeUpdate}</span></div>}
                {mayComplete && (
                  <div className="setting-form">
                    <label>Manager update<textarea rows={2} value={draft.managerUpdate} onChange={(event) => setMeetingDrafts({ ...meetingDrafts, [meeting.id]: { ...draft, managerUpdate: event.target.value } })} /></label>
                    <label>Shared notes<textarea rows={2} value={draft.sharedNotes} onChange={(event) => setMeetingDrafts({ ...meetingDrafts, [meeting.id]: { ...draft, sharedNotes: event.target.value } })} /></label>
                    <label>Private manager notes<textarea rows={2} value={draft.managerPrivateNotes} onChange={(event) => setMeetingDrafts({ ...meetingDrafts, [meeting.id]: { ...draft, managerPrivateNotes: event.target.value } })} /></label>
                  </div>
                )}
                {mayComplete && <div className="run-actions">
                  <button type="button" className="secondary-button" onClick={() => void addAction(meeting.id)}><Plus size={13} /> Action item</button>
                  <button type="button" className="primary-button" onClick={() => void completeMeeting(meeting)}><CalendarCheck size={13} /> Complete & schedule next</button>
                </div>}
                {data.oneOnOneActionItems.filter((item) => item.meetingId === meeting.id).map((item) => <small key={item.id} style={{ display: "block", marginTop: 5 }}>{item.status === "completed" ? "✓" : "○"} {item.title}</small>)}
              </div>
            );
          })}
        </article>
      </section>

      <section className="module-grid two" style={{ marginTop: 16 }}>
        <article className="card">
          <div className="card-header"><div><div className="card-kicker">360 FEEDBACK</div><h3>Requested perspectives</h3><p>Response text is visible here only when the signed-in manager is the subject, reviewer, or current manager of the subject.</p></div></div>
          {data.feedbackRounds.length === 0 && <div className="empty-state">No feedback rounds yet.</div>}
          {data.feedbackRounds.slice(0, 10).map((round) => {
            const requests = data.feedbackRequests.filter((request) => request.roundId === round.id);
            const submitted = requests.filter((request) => request.status === "submitted").length;
            return (
              <div className="leave-request" key={round.id}>
                <div className="inline-icon purple"><MessagesSquare size={15} /></div>
                <div style={{ flex: 1 }}>
                  <strong>{round.title}</strong>
                  <span>{employeeName.get(round.subjectEmployeeId) ?? "Employee"} · {submitted}/{requests.length} submitted · {round.status}</span>
                  {requests.filter((request) => request.responseText).slice(0, 3).map((request) => <small key={request.id} style={{ display: "block", marginTop: 4 }}>{employeeName.get(request.reviewerEmployeeId) ?? "Reviewer"}: {request.responseText}</small>)}
                </div>
              </div>
            );
          })}
        </article>

        <article className="card">
          <div className="card-header"><div><div className="card-kicker">MENTORSHIP</div><h3>Development relationships</h3></div></div>
          {data.mentorships.length === 0 && <div className="empty-state">No mentorships yet.</div>}
          {data.mentorships.slice(0, 12).map((row) => (
            <div className="leave-request" key={row.id}>
              <div className="inline-icon orange"><UserRoundCheck size={15} /></div>
              <div style={{ flex: 1 }}>
                <strong>{employeeName.get(row.menteeEmployeeId) ?? "Mentee"} → {employeeName.get(row.mentorEmployeeId) ?? "Mentor"}</strong>
                <span>{row.goal}</span>
                <small>{row.cadence} · {row.status}</small>
              </div>
            </div>
          ))}
        </article>
      </section>
    </section>
  );
}
