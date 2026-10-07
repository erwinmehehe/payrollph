"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CheckCircle2, Flag, Plus, RefreshCw, Target, Trophy } from "lucide-react";

type Employee = { id: number; firstName: string; lastName: string; title: string; orgUnitId: number | null; status: string };
type Cycle = { id: number; name: string; startDate: string; endDate: string; status: string };
type Goal = { id: number; employeeId: number; cycleId: number | null; title: string; description: string | null; weight: string; progress: number; status: string; dueDate: string | null };
type Review = { id: number; employeeId: number; cycleId: number; status: string; selfScore: string | null; employeeReflection: string | null; managerScore: string | null; finalScore: string | null; managerSummary: string | null };

export function PerformancePanel({ organizationId, setNotice }: { organizationId: number; setNotice: (message: string) => void }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCycle, setShowCycle] = useState(false);
  const [showGoal, setShowGoal] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [cycleForm, setCycleForm] = useState({ name: "", startDate: "", endDate: "" });
  const [goalForm, setGoalForm] = useState({ employeeId: "", cycleId: "", title: "", description: "", weight: "25", dueDate: "" });
  const [reviewForm, setReviewForm] = useState({ employeeId: "", cycleId: "", managerScore: "3", managerSummary: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/performance?organizationId=${organizationId}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error ?? "Could not load performance management.");
        return;
      }
      setEmployees(payload.employees ?? []);
      setCycles(payload.cycles ?? []);
      setGoals(payload.goals ?? []);
      setReviews(payload.reviews ?? []);
    } finally {
      setLoading(false);
    }
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  const activeCycle = cycles.find((cycle) => cycle.status === "active") ?? cycles[0];
  const averageProgress = goals.length ? Math.round(goals.reduce((sum, goal) => sum + goal.progress, 0) / goals.length) : 0;
  const completedReviews = reviews.filter((review) => review.status === "completed");
  const averageScore = completedReviews.length
    ? (completedReviews.reduce((sum, review) => sum + Number(review.finalScore ?? 0), 0) / completedReviews.length).toFixed(2)
    : "—";

  const employeeName = useMemo(
    () => new Map(employees.map((employee) => [employee.id, `${employee.firstName} ${employee.lastName}`])),
    [employees],
  );

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/performance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, organizationId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Could not save performance data.");
    return payload;
  }

  async function createCycle(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({ entityType: "cycle", ...cycleForm });
      setShowCycle(false);
      setCycleForm({ name: "", startDate: "", endDate: "" });
      await load();
      setNotice("Performance cycle created.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create cycle."); }
  }

  async function createGoal(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "goal",
        ...goalForm,
        employeeId: Number(goalForm.employeeId),
        cycleId: goalForm.cycleId ? Number(goalForm.cycleId) : null,
        weight: Number(goalForm.weight),
      });
      setShowGoal(false);
      setGoalForm({ employeeId: "", cycleId: "", title: "", description: "", weight: "25", dueDate: "" });
      await load();
      setNotice("Employee goal created.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create goal."); }
  }

  async function createReview(event: React.FormEvent) {
    event.preventDefault();
    try {
      const review = await post({
        entityType: "review",
        employeeId: Number(reviewForm.employeeId),
        cycleId: Number(reviewForm.cycleId),
      });
      const response = await fetch("/api/performance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: "review",
          id: review.id,
          managerScore: Number(reviewForm.managerScore),
          managerSummary: reviewForm.managerSummary,
          status: "completed",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not complete review.");
      setShowReview(false);
      setReviewForm({ employeeId: "", cycleId: "", managerScore: "3", managerSummary: "" });
      await load();
      setNotice("Performance review completed.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save review."); }
  }

  async function updateGoal(goal: Goal, progress: number) {
    const response = await fetch("/api/performance", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType: "goal", id: goal.id, progress }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setNotice(payload.error ?? "Could not update goal.");
    await load();
    setNotice("Goal progress updated.");
  }

  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">TALENT &amp; PERFORMANCE</div>
          <h1>Performance</h1>
          <p>Run review cycles, connect measurable goals to each employee, and keep performance decisions in the same governed employee record.</p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          <button className="secondary-button" onClick={() => setShowGoal(!showGoal)}><Target size={15} /> Add goal</button>
          <button className="primary-button" onClick={() => setShowCycle(!showCycle)}><Plus size={15} /> New cycle</button>
        </div>
      </div>

      <section className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="stat-card"><div className="stat-icon mint"><Trophy size={19} /></div><p>ACTIVE CYCLE</p><h3>{activeCycle?.name ?? "None"}</h3><span>{activeCycle ? `${activeCycle.startDate} – ${activeCycle.endDate}` : "Create a review period"}</span></article>
        <article className="stat-card"><div className="stat-icon blue"><Target size={19} /></div><p>EMPLOYEE GOALS</p><h3>{goals.length}</h3><span>{averageProgress}% average progress</span></article>
        <article className="stat-card"><div className="stat-icon purple"><CheckCircle2 size={19} /></div><p>COMPLETED REVIEWS</p><h3>{completedReviews.length}</h3><span>{reviews.length - completedReviews.length} still open</span></article>
        <article className="stat-card"><div className="stat-icon orange"><BarChart3 size={19} /></div><p>AVERAGE SCORE</p><h3>{averageScore}</h3><span>{completedReviews.length ? "Out of 5.00" : "No completed reviews"}</span></article>
      </section>

      {showCycle && (
        <article className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div className="card-header"><div><div className="card-kicker">PERFORMANCE CYCLE</div><h2>Open a governed review period</h2></div></div>
          <form onSubmit={createCycle}>
            <div className="setting-form">
              <label>Cycle name<input required value={cycleForm.name} onChange={(e) => setCycleForm({ ...cycleForm, name: e.target.value })} placeholder="2026 Annual Review" /></label>
              <label>Start date<input required type="date" value={cycleForm.startDate} onChange={(e) => setCycleForm({ ...cycleForm, startDate: e.target.value })} /></label>
              <label>End date<input required type="date" value={cycleForm.endDate} onChange={(e) => setCycleForm({ ...cycleForm, endDate: e.target.value })} /></label>
            </div>
            <div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowCycle(false)}>Cancel</button><button className="primary-button">Create cycle</button></div>
          </form>
        </article>
      )}

      {showGoal && (
        <article className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div className="card-header"><div><div className="card-kicker">GOAL</div><h2>Add a measurable employee goal</h2></div></div>
          <form onSubmit={createGoal}>
            <div className="setting-form">
              <label>Employee<select required value={goalForm.employeeId} onChange={(e) => setGoalForm({ ...goalForm, employeeId: e.target.value })}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} · {employee.title}</option>)}</select></label>
              <label>Cycle<select value={goalForm.cycleId} onChange={(e) => setGoalForm({ ...goalForm, cycleId: e.target.value })}><option value="">No cycle</option>{cycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}</select></label>
              <label>Goal title<input required value={goalForm.title} onChange={(e) => setGoalForm({ ...goalForm, title: e.target.value })} placeholder="Reduce payroll corrections below 1%" /></label>
              <label>Weight %<input type="number" min="0" max="100" step="1" value={goalForm.weight} onChange={(e) => setGoalForm({ ...goalForm, weight: e.target.value })} /></label>
              <label>Due date<input type="date" value={goalForm.dueDate} onChange={(e) => setGoalForm({ ...goalForm, dueDate: e.target.value })} /></label>
              <label style={{ gridColumn: "1 / -1" }}>Description<textarea rows={2} value={goalForm.description} onChange={(e) => setGoalForm({ ...goalForm, description: e.target.value })} /></label>
            </div>
            <div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowGoal(false)}>Cancel</button><button className="primary-button">Create goal</button></div>
          </form>
        </article>
      )}

      {showReview && (
        <article className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div className="card-header"><div><div className="card-kicker">MANAGER REVIEW</div><h2>Complete a structured review</h2></div></div>
          <form onSubmit={createReview}>
            <div className="setting-form">
              <label>Employee<select required value={reviewForm.employeeId} onChange={(e) => setReviewForm({ ...reviewForm, employeeId: e.target.value })}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>
              <label>Cycle<select required value={reviewForm.cycleId} onChange={(e) => setReviewForm({ ...reviewForm, cycleId: e.target.value })}><option value="">Select cycle</option>{cycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}</select></label>
              <label>Manager score (1–5)<input required type="number" min="1" max="5" step="0.1" value={reviewForm.managerScore} onChange={(e) => setReviewForm({ ...reviewForm, managerScore: e.target.value })} /></label>
              <label style={{ gridColumn: "1 / -1" }}>Summary<textarea required rows={3} value={reviewForm.managerSummary} onChange={(e) => setReviewForm({ ...reviewForm, managerSummary: e.target.value })} placeholder="Evidence, outcomes, strengths, and development priorities." /></label>
            </div>
            <div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowReview(false)}>Cancel</button><button className="primary-button">Complete review</button></div>
          </form>
        </article>
      )}

      <section className="module-grid two">
        <article className="card">
          <div className="card-header">
            <div><div className="card-kicker">GOALS</div><h2>Progress against outcomes</h2><p>Goal changes are tenant-scoped and audit logged.</p></div>
          </div>
          {goals.length === 0 && <div className="empty-state">No performance goals yet.</div>}
          {goals.map((goal) => (
            <div className="leave-request" key={goal.id}>
              <div className="inline-icon mint"><Flag size={16} /></div>
              <div style={{ flex: 1 }}>
                <strong>{goal.title}</strong>
                <span>{employeeName.get(goal.employeeId) ?? `Employee #${goal.employeeId}`} · {goal.weight}% weight · {goal.progress}% complete</span>
                <div style={{ marginTop: 8, height: 6, background: "var(--canvas-subtle)", borderRadius: 99, overflow: "hidden" }}><div style={{ width: `${goal.progress}%`, height: "100%", background: "var(--brand)" }} /></div>
              </div>
              <select value={goal.progress} onChange={(e) => void updateGoal(goal, Number(e.target.value))} style={{ width: 86 }}>
                {[0, 25, 50, 75, 100].map((value) => <option key={value} value={value}>{value}%</option>)}
              </select>
            </div>
          ))}
        </article>

        <article className="card">
          <div className="card-header">
            <div><div className="card-kicker">REVIEWS</div><h2>Formal manager assessments</h2><p>Scores stay separated from payroll until a future compensation cycle explicitly consumes them.</p></div>
            <button className="secondary-button" onClick={() => setShowReview(!showReview)} disabled={!cycles.length || !employees.length}><Plus size={14} /> Review</button>
          </div>
          {reviews.length === 0 && <div className="empty-state">No formal reviews yet.</div>}
          {reviews.map((review) => (
            <div className="leave-request" key={review.id}>
              <div className="inline-icon purple"><Trophy size={16} /></div>
              <div style={{ flex: 1 }}>
                <strong>{employeeName.get(review.employeeId) ?? `Employee #${review.employeeId}`}</strong>
                <span>{cycles.find((cycle) => cycle.id === review.cycleId)?.name ?? `Cycle #${review.cycleId}`} · {review.status}</span>
                {review.selfScore && <span>Employee self-assessment: {Number(review.selfScore).toFixed(1)}/5</span>}
                {review.employeeReflection && <span>Employee reflection: {review.employeeReflection}</span>}
                {review.managerSummary && <span>Manager summary: {review.managerSummary}</span>}
              </div>
              <strong>{review.finalScore ? `${Number(review.finalScore).toFixed(1)}/5` : "Open"}</strong>
            </div>
          ))}
        </article>
      </section>
    </div>
  );
}
