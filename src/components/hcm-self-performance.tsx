"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, RefreshCw, Target } from "lucide-react";

type Goal = {
  id: number;
  cycleId: number | null;
  title: string;
  description: string | null;
  weight: string;
  progress: number;
  status: string;
  dueDate: string | null;
};

type Cycle = {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  requireSelfAssessment: boolean;
  requireManagerSummary: boolean;
};

type ReviewItem = {
  id: number;
  templateId: number;
  selfScore: string | null;
  managerScore: string | null;
  finalScore: string | null;
  employeeComment: string | null;
  managerComment: string | null;
  template: {
    id: number;
    name: string;
    code: string;
    type: "competency" | "kra";
    description: string | null;
  } | null;
  cycleTemplate: {
    weight: string;
    required: boolean;
  } | null;
};

type Review = {
  id: number;
  cycleId: number;
  status: string;
  selfScore: string | null;
  employeeReflection: string | null;
  managerScore: string | null;
  finalScore: string | null;
  managerSummary: string | null;
  completedAt: string | null;
  cycle: Cycle | null;
  items: ReviewItem[];
};

export function HcmSelfPerformance() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedReviewId, setSelectedReviewId] = useState<number | null>(null);
  const [selfScore, setSelfScore] = useState("3");
  const [reflection, setReflection] = useState("");
  const [itemScores, setItemScores] = useState<Record<number, string>>({});
  const [itemComments, setItemComments] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  function loadDraft(review: Review | undefined) {
    setSelfScore(review?.selfScore ? String(Number(review.selfScore)) : "3");
    setReflection(review?.employeeReflection ?? "");
    setItemScores(Object.fromEntries((review?.items ?? []).map((item) => [
      item.id,
      item.selfScore ? String(Number(item.selfScore)) : "3",
    ])));
    setItemComments(Object.fromEntries((review?.items ?? []).map((item) => [
      item.id,
      item.employeeComment ?? "",
    ])));
  }

  const load = useCallback(async () => {
    setLoading(true);
    setNotice("");
    try {
      const response = await fetch("/api/self/performance", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error ?? "Could not load performance reviews.");
        return;
      }
      const nextReviews: Review[] = payload.reviews ?? [];
      setReviews(nextReviews);
      setGoals(payload.goals ?? []);
      const editable = nextReviews.find((review) => review.status !== "completed") ?? nextReviews[0];
      if (editable) {
        setSelectedReviewId(editable.id);
        loadDraft(editable);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeReview = useMemo(
    () => reviews.find((review) => review.id === selectedReviewId) ?? null,
    [reviews, selectedReviewId],
  );

  const cycleGoals = useMemo(
    () => activeReview
      ? goals.filter((goal) => goal.cycleId === activeReview.cycleId || goal.cycleId === null)
      : goals,
    [activeReview, goals],
  );

  function chooseReview(id: number) {
    const review = reviews.find((item) => item.id === id);
    setSelectedReviewId(id);
    loadDraft(review);
    setNotice("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!activeReview) return;
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/self/performance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId: activeReview.id,
          selfScore: Number(selfScore),
          employeeReflection: reflection,
          items: activeReview.items.map((item) => ({
            id: item.id,
            selfScore: Number(itemScores[item.id] ?? 3),
            employeeComment: itemComments[item.id] ?? "",
          })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error ?? "Could not submit your self-assessment.");
        return;
      }
      setNotice("Self-assessment saved. Your manager will see it as evidence, while the final rating remains a separate manager decision.");
      await load();
    } catch {
      setNotice("Could not submit your self-assessment because the server could not be reached.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="employee-empty-row">Loading performance reviews…</div>;
  }

  return (
    <section className="employee-section">
      <div className="employee-list-card-head">
        <div>
          <span className="card-kicker">PERFORMANCE</span>
          <h3>My goals and self-assessments</h3>
          <p>Reflect on outcomes and structured competencies/KRAs before your manager completes the formal review.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void load()}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {notice && <div className="notice notice-amber"><span>{notice}</span></div>}

      {reviews.length === 0 ? (
        <div className="employee-empty-row">
          No performance review has been opened for you yet. Your assigned goals will appear here when available.
        </div>
      ) : (
        <div className="employee-profile-grid" style={{ marginBottom: 16 }}>
          {reviews.map((review) => (
            <button
              type="button"
              key={review.id}
              className="employee-edit-card"
              style={{ textAlign: "left", cursor: "pointer" }}
              onClick={() => chooseReview(review.id)}
            >
              <span className="card-kicker">{review.cycle?.name ?? `Review #${review.id}`}</span>
              <strong>{review.status === "completed" ? "Completed review" : "Self-assessment open"}</strong>
              <span>
                {review.selfScore ? `My score: ${Number(review.selfScore).toFixed(1)}/5` : "Self-assessment not submitted"}
                {review.finalScore ? ` · Final: ${Number(review.finalScore).toFixed(1)}/5` : ""}
              </span>
            </button>
          ))}
        </div>
      )}

      {activeReview && (
        <article className="employee-edit-card">
          <div className="employee-list-card-head">
            <div>
              <span className="card-kicker">{activeReview.cycle?.name ?? "CURRENT REVIEW"}</span>
              <h3>{activeReview.status === "completed" ? "Review completed" : "Your self-assessment"}</h3>
              {activeReview.cycle?.requireSelfAssessment && activeReview.status !== "completed" && (
                <p>This cycle requires your self-assessment before the manager can complete the review.</p>
              )}
            </div>
            <BadgeCheck size={18} />
          </div>

          {cycleGoals.length > 0 && (
            <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
              {cycleGoals.map((goal) => (
                <div className="employee-leave-row" key={goal.id}>
                  <div>
                    <strong><Target size={13} style={{ verticalAlign: "middle", marginRight: 6 }} />{goal.title}</strong>
                    <span>{goal.weight}% weight · {goal.progress}% complete · {goal.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeReview.status === "completed" ? (
            <div style={{ display: "grid", gap: 14 }}>
              <div><strong>Your reflection</strong><p>{activeReview.employeeReflection ?? "No reflection submitted."}</p></div>
              <div><strong>Your overall score</strong><p>{activeReview.selfScore ? `${Number(activeReview.selfScore).toFixed(1)}/5` : "—"}</p></div>
              {activeReview.items.map((item) => (
                <div className="employee-leave-row" key={item.id}>
                  <div>
                    <strong>{item.template?.name ?? `Review item #${item.id}`}</strong>
                    <span>{item.template?.type?.toUpperCase() ?? "ITEM"} · {item.cycleTemplate?.weight ?? "0"}% weight</span>
                    {item.employeeComment && <span>Your note: {item.employeeComment}</span>}
                    {item.managerComment && <span>Manager note: {item.managerComment}</span>}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <strong>{item.selfScore ? `Self ${Number(item.selfScore).toFixed(1)}` : "Self —"}</strong>
                    <span>{item.finalScore ? `Final ${Number(item.finalScore).toFixed(1)}` : "Final —"}</span>
                  </div>
                </div>
              ))}
              <div><strong>Manager assessment</strong><p>{activeReview.managerSummary ?? "No manager summary recorded."}</p></div>
              <div><strong>Final rating</strong><p>{activeReview.finalScore ? `${Number(activeReview.finalScore).toFixed(1)}/5` : "—"}</p></div>
            </div>
          ) : (
            <form onSubmit={submit}>
              {activeReview.items.length > 0 && (
                <div style={{ display: "grid", gap: 12, marginBottom: 18 }}>
                  {activeReview.items.map((item) => (
                    <div className="employee-edit-card" key={item.id}>
                      <div className="employee-list-card-head">
                        <div>
                          <span className="card-kicker">{item.template?.type?.toUpperCase() ?? "REVIEW ITEM"} · {item.cycleTemplate?.weight ?? "0"}% WEIGHT</span>
                          <h3>{item.template?.name ?? `Review item #${item.id}`}</h3>
                          {item.template?.description && <p>{item.template.description}</p>}
                        </div>
                        {item.cycleTemplate?.required && <span className="employee-status-pill warn">Required</span>}
                      </div>
                      <div className="employee-edit-fields">
                        <label>
                          Your rating
                          <input
                            required={Boolean(item.cycleTemplate?.required)}
                            type="number"
                            min="1"
                            max="5"
                            step="0.1"
                            value={itemScores[item.id] ?? "3"}
                            onChange={(event) => setItemScores((current) => ({ ...current, [item.id]: event.target.value }))}
                          />
                        </label>
                        <label style={{ gridColumn: "1 / -1" }}>
                          Evidence / comment
                          <textarea
                            rows={2}
                            maxLength={4000}
                            value={itemComments[item.id] ?? ""}
                            onChange={(event) => setItemComments((current) => ({ ...current, [item.id]: event.target.value }))}
                            placeholder="Add examples or evidence that support your rating."
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="employee-edit-fields">
                <label>
                  Overall self-assessment score
                  <input
                    required
                    type="number"
                    min="1"
                    max="5"
                    step="0.1"
                    value={selfScore}
                    onChange={(event) => setSelfScore(event.target.value)}
                  />
                </label>
                <label style={{ gridColumn: "1 / -1" }}>
                  Overall reflection
                  <textarea
                    required
                    rows={5}
                    maxLength={8000}
                    value={reflection}
                    onChange={(event) => setReflection(event.target.value)}
                    placeholder="Summarize outcomes, evidence, challenges, and development priorities."
                  />
                </label>
              </div>
              <div className="employee-edit-actions">
                <button className="primary-button brand" disabled={saving || !reflection.trim()}>
                  <BadgeCheck size={14} /> {saving ? "Saving…" : activeReview.selfScore ? "Update self-assessment" : "Submit self-assessment"}
                </button>
              </div>
            </form>
          )}
        </article>
      )}

      {!activeReview && goals.length > 0 && (
        <article className="employee-list-card">
          <div className="employee-list-card-head"><div><span className="card-kicker">GOALS</span><h3>Assigned goals</h3></div></div>
          {goals.map((goal) => (
            <div className="employee-leave-row" key={goal.id}>
              <div><strong>{goal.title}</strong><span>{goal.weight}% weight · {goal.progress}% complete · {goal.status}</span></div>
            </div>
          ))}
        </article>
      )}
    </section>
  );
}
