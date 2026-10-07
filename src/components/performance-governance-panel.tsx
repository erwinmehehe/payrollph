"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Flag, Plus, Target, Trophy } from "lucide-react";
import { PerformanceCalibrationPanel } from "@/components/performance-calibration-panel";

type Employee = { id: number; firstName: string; lastName: string; title: string; orgUnitId: number | null };
type OrgUnit = { id: number; name: string; type: string };
type Cycle = {
  id: number;
  name: string;
  status: string;
  requireSelfAssessment: boolean;
  requireManagerSummary: boolean;
  requireCalibration: boolean;
};
type Goal = {
  id: number;
  employeeId: number | null;
  orgUnitId: number | null;
  parentGoalId: number | null;
  scope: "company" | "team" | "employee";
  cycleId: number | null;
  title: string;
  weight: string;
  progress: number;
  status: string;
};
type Template = {
  id: number;
  code: string;
  name: string;
  type: "competency" | "kra";
  description: string | null;
  defaultWeight: string;
  active: boolean;
};
type CycleTemplate = { id: number; cycleId: number; templateId: number; weight: string; required: boolean };
type Review = {
  id: number;
  employeeId: number;
  cycleId: number;
  status: string;
  selfScore: string | null;
  employeeReflection: string | null;
  managerScore: string | null;
  finalScore: string | null;
  managerSummary: string | null;
};
type ReviewItem = {
  id: number;
  reviewId: number;
  templateId: number;
  selfScore: string | null;
  managerScore: string | null;
  finalScore: string | null;
  employeeComment: string | null;
  managerComment: string | null;
};
type Readiness = {
  totalReviews: number;
  completedReviews: number;
  openReviews: number;
  missingFinalRatings: number;
  missingRequiredItems: number;
  ready: boolean;
};

export function PerformanceGovernancePanel({
  organizationId,
  setNotice,
}: {
  organizationId: number;
  setNotice: (message: string) => void;
}) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [cycleTemplates, setCycleTemplates] = useState<CycleTemplate[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [readiness, setReadiness] = useState<Record<string, Readiness>>({});
  const [canCalibrate, setCanCalibrate] = useState(false);

  const [showGoal, setShowGoal] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [showReview, setShowReview] = useState(false);

  const [goalForm, setGoalForm] = useState({
    scope: "company" as "company" | "team" | "employee",
    employeeId: "",
    orgUnitId: "",
    parentGoalId: "",
    cycleId: "",
    title: "",
    description: "",
    weight: "25",
    dueDate: "",
  });
  const [templateForm, setTemplateForm] = useState({
    code: "",
    name: "",
    type: "competency" as "competency" | "kra",
    description: "",
    defaultWeight: "20",
  });
  const [attachForm, setAttachForm] = useState({
    cycleId: "",
    templateId: "",
    weight: "20",
    required: true,
  });
  const [reviewForm, setReviewForm] = useState({ employeeId: "", cycleId: "" });
  const [managerScores, setManagerScores] = useState<Record<number, string>>({});
  const [managerSummaries, setManagerSummaries] = useState<Record<number, string>>({});
  const [itemScores, setItemScores] = useState<Record<number, string>>({});
  const [itemComments, setItemComments] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    const response = await fetch("/api/performance?organizationId=" + organizationId, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not load performance governance.");
      return;
    }
    setEmployees(payload.employees ?? []);
    setOrgUnits(payload.orgUnits ?? []);
    setCycles(payload.cycles ?? []);
    setGoals(payload.goals ?? []);
    setTemplates(payload.templates ?? []);
    setCycleTemplates(payload.cycleTemplates ?? []);
    setReviews(payload.reviews ?? []);
    setReviewItems(payload.reviewItems ?? []);
    setReadiness(payload.cycleReadiness ?? {});
    setCanCalibrate(Boolean(payload.access?.companyWide && ["owner", "admin", "bookkeeper", "hr"].includes(payload.access?.role)));
    setManagerScores(Object.fromEntries((payload.reviews ?? []).map((review: Review) => [
      review.id,
      review.managerScore ? String(Number(review.managerScore)) : "3",
    ])));
    setManagerSummaries(Object.fromEntries((payload.reviews ?? []).map((review: Review) => [
      review.id,
      review.managerSummary ?? "",
    ])));
    setItemScores(Object.fromEntries((payload.reviewItems ?? []).map((item: ReviewItem) => [
      item.id,
      item.managerScore ? String(Number(item.managerScore)) : "3",
    ])));
    setItemComments(Object.fromEntries((payload.reviewItems ?? []).map((item: ReviewItem) => [
      item.id,
      item.managerComment ?? "",
    ])));
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  const employeeName = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee.firstName + " " + employee.lastName])),
    [employees],
  );
  const unitName = useMemo(() => new Map(orgUnits.map((unit) => [unit.id, unit.name])), [orgUnits]);
  const goalName = useMemo(() => new Map(goals.map((goal) => [goal.id, goal.title])), [goals]);
  const templateById = useMemo(() => new Map(templates.map((template) => [template.id, template])), [templates]);

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/performance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, organizationId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Could not save performance governance.");
    return payload;
  }

  async function patch(body: Record<string, unknown>) {
    const response = await fetch("/api/performance", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Could not update performance governance.");
    return payload;
  }

  async function createGoal(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "goal",
        ...goalForm,
        employeeId: goalForm.scope === "employee" ? Number(goalForm.employeeId) : null,
        orgUnitId: goalForm.scope === "team" ? Number(goalForm.orgUnitId) : null,
        parentGoalId: goalForm.parentGoalId ? Number(goalForm.parentGoalId) : null,
        cycleId: goalForm.cycleId ? Number(goalForm.cycleId) : null,
        weight: Number(goalForm.weight),
      });
      setGoalForm({ scope: "company", employeeId: "", orgUnitId: "", parentGoalId: "", cycleId: "", title: "", description: "", weight: "25", dueDate: "" });
      setShowGoal(false);
      await load();
      setNotice("Cascaded goal created.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create goal.");
    }
  }

  async function createTemplate(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "template",
        ...templateForm,
        defaultWeight: Number(templateForm.defaultWeight),
      });
      setTemplateForm({ code: "", name: "", type: "competency", description: "", defaultWeight: "20" });
      setShowTemplate(false);
      await load();
      setNotice("Competency/KRA template created.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create template.");
    }
  }

  async function attachTemplate(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "cycle_template",
        cycleId: Number(attachForm.cycleId),
        templateId: Number(attachForm.templateId),
        weight: Number(attachForm.weight),
        required: attachForm.required,
      });
      setAttachForm({ cycleId: "", templateId: "", weight: "20", required: true });
      setShowAttach(false);
      await load();
      setNotice("Review template attached to cycle.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not attach template.");
    }
  }

  async function openReview(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "review",
        employeeId: Number(reviewForm.employeeId),
        cycleId: Number(reviewForm.cycleId),
      });
      setReviewForm({ employeeId: "", cycleId: "" });
      setShowReview(false);
      await load();
      setNotice("Structured performance review opened.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not open review.");
    }
  }

  async function saveItem(item: ReviewItem) {
    try {
      await patch({
        entityType: "review_item",
        id: item.id,
        managerScore: Number(itemScores[item.id] ?? 3),
        managerComment: itemComments[item.id] ?? "",
      });
      await load();
      setNotice("Structured review item saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save review item.");
    }
  }

  async function saveReview(review: Review, status: "in_progress" | "completed") {
    try {
      await patch({
        entityType: "review",
        id: review.id,
        managerScore: Number(managerScores[review.id] ?? 3),
        managerSummary: managerSummaries[review.id] ?? "",
        status,
      });
      await load();
      setNotice(status === "completed" ? "Review completed." : "Manager draft saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save review.");
    }
  }

  async function closeCycle(cycle: Cycle) {
    try {
      await patch({ entityType: "cycle", id: cycle.id });
      await load();
      setNotice("Performance cycle completed and locked.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not complete cycle.");
    }
  }

  const parentGoals = goals.filter((goal) => {
    if (goalForm.scope === "company") return false;
    if (goalForm.scope === "team") return goal.scope === "company";
    return goal.scope === "company" || goal.scope === "team";
  });

  return (
    <div style={{ display: "grid", gap: 16, marginBottom: 16 }}>
      <article className="card" style={{ padding: 20 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">PERFORMANCE GOVERNANCE</div>
            <h2>Goal hierarchy, structured reviews, and cycle closure</h2>
            <p>Company goals cascade to teams and employees. Competencies/KRAs become scored review evidence, and cycles close only when required evidence is complete.</p>
          </div>
          <div className="page-actions">
            <button className="secondary-button" onClick={() => setShowGoal((value) => !value)}><Target size={14} /> Hierarchy goal</button>
            <button className="secondary-button" onClick={() => setShowTemplate((value) => !value)}><Flag size={14} /> Template</button>
            <button className="secondary-button" onClick={() => setShowAttach((value) => !value)}><Plus size={14} /> Attach</button>
            <button className="primary-button" onClick={() => setShowReview((value) => !value)}><Trophy size={14} /> Open review</button>
          </div>
        </div>
      </article>

      {showGoal && (
        <article className="card" style={{ padding: 20 }}>
          <div className="card-header"><div><div className="card-kicker">GOAL CASCADE</div><h2>Create an aligned goal</h2></div></div>
          <form onSubmit={createGoal}>
            <div className="setting-form">
              <label>Scope<select value={goalForm.scope} onChange={(event) => setGoalForm({ ...goalForm, scope: event.target.value as typeof goalForm.scope, employeeId: "", orgUnitId: "", parentGoalId: "" })}><option value="company">Company</option><option value="team">Team</option><option value="employee">Employee</option></select></label>
              {goalForm.scope === "team" && <label>Team<select required value={goalForm.orgUnitId} onChange={(event) => setGoalForm({ ...goalForm, orgUnitId: event.target.value })}><option value="">Select org unit</option>{orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>}
              {goalForm.scope === "employee" && <label>Employee<select required value={goalForm.employeeId} onChange={(event) => setGoalForm({ ...goalForm, employeeId: event.target.value })}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} · {employee.title}</option>)}</select></label>}
              <label>Cycle<select value={goalForm.cycleId} onChange={(event) => setGoalForm({ ...goalForm, cycleId: event.target.value })}><option value="">No cycle</option>{cycles.filter((cycle) => cycle.status !== "completed").map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}</select></label>
              {goalForm.scope !== "company" && <label>Parent goal<select value={goalForm.parentGoalId} onChange={(event) => setGoalForm({ ...goalForm, parentGoalId: event.target.value })}><option value="">No parent</option>{parentGoals.map((goal) => <option key={goal.id} value={goal.id}>{goal.scope + ": " + goal.title}</option>)}</select></label>}
              <label>Title<input required value={goalForm.title} onChange={(event) => setGoalForm({ ...goalForm, title: event.target.value })} /></label>
              <label>Weight %<input type="number" min="0" max="100" value={goalForm.weight} onChange={(event) => setGoalForm({ ...goalForm, weight: event.target.value })} /></label>
              <label>Due date<input type="date" value={goalForm.dueDate} onChange={(event) => setGoalForm({ ...goalForm, dueDate: event.target.value })} /></label>
              <label style={{ gridColumn: "1 / -1" }}>Description<textarea rows={2} value={goalForm.description} onChange={(event) => setGoalForm({ ...goalForm, description: event.target.value })} /></label>
            </div>
            <div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowGoal(false)}>Cancel</button><button className="primary-button">Create aligned goal</button></div>
          </form>
        </article>
      )}

      {showTemplate && (
        <article className="card" style={{ padding: 20 }}>
          <div className="card-header"><div><div className="card-kicker">COMPETENCY / KRA LIBRARY</div><h2>Create reusable review criteria</h2></div></div>
          <form onSubmit={createTemplate}>
            <div className="setting-form">
              <label>Code<input required value={templateForm.code} onChange={(event) => setTemplateForm({ ...templateForm, code: event.target.value })} /></label>
              <label>Type<select value={templateForm.type} onChange={(event) => setTemplateForm({ ...templateForm, type: event.target.value as "competency" | "kra" })}><option value="competency">Competency</option><option value="kra">KRA</option></select></label>
              <label>Name<input required value={templateForm.name} onChange={(event) => setTemplateForm({ ...templateForm, name: event.target.value })} /></label>
              <label>Default weight %<input type="number" min="0" max="100" value={templateForm.defaultWeight} onChange={(event) => setTemplateForm({ ...templateForm, defaultWeight: event.target.value })} /></label>
              <label style={{ gridColumn: "1 / -1" }}>Description<textarea rows={2} value={templateForm.description} onChange={(event) => setTemplateForm({ ...templateForm, description: event.target.value })} /></label>
            </div>
            <div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowTemplate(false)}>Cancel</button><button className="primary-button">Create template</button></div>
          </form>
        </article>
      )}

      {showAttach && (
        <article className="card" style={{ padding: 20 }}>
          <div className="card-header"><div><div className="card-kicker">REVIEW STRUCTURE</div><h2>Attach a template to a cycle</h2></div></div>
          <form onSubmit={attachTemplate}>
            <div className="setting-form">
              <label>Cycle<select required value={attachForm.cycleId} onChange={(event) => setAttachForm({ ...attachForm, cycleId: event.target.value })}><option value="">Select cycle</option>{cycles.filter((cycle) => cycle.status !== "completed").map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}</select></label>
              <label>Template<select required value={attachForm.templateId} onChange={(event) => { const id = Number(event.target.value); setAttachForm({ ...attachForm, templateId: event.target.value, weight: templates.find((template) => template.id === id)?.defaultWeight ?? "20" }); }}><option value="">Select template</option>{templates.filter((template) => template.active).map((template) => <option key={template.id} value={template.id}>{template.type + ": " + template.name}</option>)}</select></label>
              <label>Weight %<input type="number" min="0" max="100" value={attachForm.weight} onChange={(event) => setAttachForm({ ...attachForm, weight: event.target.value })} /></label>
              <label><input type="checkbox" checked={attachForm.required} onChange={(event) => setAttachForm({ ...attachForm, required: event.target.checked })} /> Required for review completion</label>
            </div>
            <div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowAttach(false)}>Cancel</button><button className="primary-button">Attach template</button></div>
          </form>
        </article>
      )}

      {showReview && (
        <article className="card" style={{ padding: 20 }}>
          <div className="card-header"><div><div className="card-kicker">STRUCTURED REVIEW</div><h2>Open an employee review</h2></div></div>
          <form onSubmit={openReview}>
            <div className="setting-form">
              <label>Employee<select required value={reviewForm.employeeId} onChange={(event) => setReviewForm({ ...reviewForm, employeeId: event.target.value })}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>
              <label>Cycle<select required value={reviewForm.cycleId} onChange={(event) => setReviewForm({ ...reviewForm, cycleId: event.target.value })}><option value="">Select cycle</option>{cycles.filter((cycle) => cycle.status !== "completed").map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}</select></label>
            </div>
            <div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowReview(false)}>Cancel</button><button className="primary-button">Open review</button></div>
          </form>
        </article>
      )}

      <section className="module-grid two">
        <article className="card">
          <div className="card-header"><div><div className="card-kicker">GOAL HIERARCHY</div><h2>Company → team → employee</h2></div></div>
          {goals.length === 0 && <div className="empty-state">No hierarchy goals yet.</div>}
          {goals.map((goal) => (
            <div className="leave-request" key={goal.id} style={{ marginLeft: goal.scope === "team" ? 14 : goal.scope === "employee" ? 28 : 0 }}>
              <div className="inline-icon mint"><Target size={15} /></div>
              <div style={{ flex: 1 }}>
                <strong>{goal.title}</strong>
                <span>
                  {goal.scope === "company" ? "Company" : goal.scope === "team" ? unitName.get(goal.orgUnitId ?? -1) ?? "Team" : employeeName.get(goal.employeeId ?? -1) ?? "Employee"}
                  {goal.parentGoalId ? " · aligned to " + (goalName.get(goal.parentGoalId) ?? "goal #" + goal.parentGoalId) : ""}
                  {" · " + goal.progress + "% complete"}
                </span>
              </div>
            </div>
          ))}
        </article>

        <article className="card">
          <div className="card-header"><div><div className="card-kicker">TEMPLATE LIBRARY</div><h2>Competencies and KRAs</h2></div></div>
          {templates.length === 0 && <div className="empty-state">No structured templates yet.</div>}
          {templates.map((template) => {
            const links = cycleTemplates.filter((link) => link.templateId === template.id);
            return (
              <div className="leave-request" key={template.id}>
                <div className="inline-icon blue"><Flag size={15} /></div>
                <div style={{ flex: 1 }}>
                  <strong>{template.name}</strong>
                  <span>{template.code + " · " + template.type.toUpperCase() + " · default " + template.defaultWeight + "%"}</span>
                  {template.description && <span>{template.description}</span>}
                  {links.length > 0 && <span>{"Attached to " + links.length + " cycle(s)"}</span>}
                </div>
              </div>
            );
          })}
        </article>
      </section>

      <article className="card">
        <div className="card-header"><div><div className="card-kicker">MANAGER REVIEWS</div><h2>Structured review evidence</h2><p>Employee evidence is visible, but manager and final ratings remain separate governed decisions.</p></div></div>
        {reviews.length === 0 && <div className="empty-state">No reviews opened yet.</div>}
        {reviews.map((review) => {
          const cycle = cycles.find((item) => item.id === review.cycleId);
          const items = reviewItems.filter((item) => item.reviewId === review.id);
          return (
            <div className="employee-edit-card" key={review.id} style={{ marginBottom: 14 }}>
              <div className="employee-list-card-head">
                <div>
                  <span className="card-kicker">{cycle?.name ?? "Review cycle"}</span>
                  <h3>{employeeName.get(review.employeeId) ?? "Employee #" + review.employeeId}</h3>
                  <p>{review.status === "completed" ? "Completed and locked" : "Open manager review"}</p>
                </div>
                <strong>{review.finalScore ? Number(review.finalScore).toFixed(1) + "/5" : "Open"}</strong>
              </div>
              {review.selfScore && <div className="notice notice-green"><span>{"Employee self-assessment: " + Number(review.selfScore).toFixed(1) + "/5 · " + (review.employeeReflection ?? "No reflection")}</span></div>}
              {items.map((item) => {
                const template = templateById.get(item.templateId);
                const link = cycleTemplates.find((row) => row.cycleId === review.cycleId && row.templateId === item.templateId);
                return (
                  <div className="leave-request" key={item.id}>
                    <div style={{ flex: 1 }}>
                      <strong>{template?.name ?? "Review item #" + item.id}</strong>
                      <span>{(template?.type?.toUpperCase() ?? "ITEM") + " · " + (link?.weight ?? "0") + "% weight" + (link?.required ? " · required" : "")}</span>
                      {item.selfScore && <span>{"Employee: " + Number(item.selfScore).toFixed(1) + "/5" + (item.employeeComment ? " · " + item.employeeComment : "")}</span>}
                      {review.status !== "completed" && (
                        <div className="setting-form" style={{ marginTop: 8 }}>
                          <label>Manager score<input type="number" min="1" max="5" step="0.1" value={itemScores[item.id] ?? "3"} onChange={(event) => setItemScores((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
                          <label>Manager note<input value={itemComments[item.id] ?? ""} onChange={(event) => setItemComments((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
                          <button type="button" className="secondary-button" onClick={() => void saveItem(item)}>Save item</button>
                        </div>
                      )}
                    </div>
                    {item.finalScore && <strong>{Number(item.finalScore).toFixed(1) + "/5"}</strong>}
                  </div>
                );
              })}
              {review.status !== "completed" && (
                <>
                  <div className="setting-form" style={{ marginTop: 12 }}>
                    <label>Overall manager score<input type="number" min="1" max="5" step="0.1" value={managerScores[review.id] ?? "3"} onChange={(event) => setManagerScores((current) => ({ ...current, [review.id]: event.target.value }))} /></label>
                    <label style={{ gridColumn: "1 / -1" }}>Manager summary<textarea rows={3} value={managerSummaries[review.id] ?? ""} onChange={(event) => setManagerSummaries((current) => ({ ...current, [review.id]: event.target.value }))} /></label>
                  </div>
                  <div className="run-actions">
                    <button type="button" className="secondary-button" onClick={() => void saveReview(review, "in_progress")}>Save draft</button>
                    <button type="button" className="primary-button" onClick={() => void saveReview(review, "completed")}>Complete review</button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </article>

      <article className="card">
        <div className="card-header"><div><div className="card-kicker">CYCLE COMPLETION</div><h2>Close only when evidence is complete</h2></div></div>
        {cycles.map((cycle) => {
          const state = readiness[String(cycle.id)];
          return (
            <div className="leave-request" key={cycle.id}>
              <div className="inline-icon purple"><CheckCircle2 size={15} /></div>
              <div style={{ flex: 1 }}>
                <strong>{cycle.name}</strong>
                <span>{cycle.status + " · self-assessment " + (cycle.requireSelfAssessment ? "required" : "optional") + " · manager narrative " + (cycle.requireManagerSummary ? "required" : "optional") + " · calibration " + (cycle.requireCalibration ? "required" : "optional")}</span>
                {state && <span>{state.completedReviews + "/" + state.totalReviews + " reviews complete · " + state.missingRequiredItems + " missing structured evidence"}</span>}
              </div>
              {cycle.status !== "completed" && <button className={state?.ready ? "primary-button" : "secondary-button"} disabled={!state?.ready} onClick={() => void closeCycle(cycle)}>{state?.ready ? "Complete cycle" : "Not ready"}</button>}
              {cycle.status === "completed" && <span className="employee-status-pill good">Locked</span>}
            </div>
          );
        })}
      </article>

      {canCalibrate && <PerformanceCalibrationPanel organizationId={organizationId} setNotice={setNotice} />}
    </div>
  );
}
