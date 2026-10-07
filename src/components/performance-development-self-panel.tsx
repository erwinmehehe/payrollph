"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpenCheck, CheckCircle2, RefreshCw } from "lucide-react";

type Milestone = {
  id: number;
  title: string;
  detail: string | null;
  dueDate: string;
  status: "open" | "in_progress" | "completed" | "cancelled";
};

type Progress = {
  id: number;
  authorName: string;
  progressPercent: number | null;
  content: string;
  createdAt: string;
};

type Plan = {
  id: number;
  title: string;
  objective: string;
  currentProficiency: string | null;
  targetProficiency: string;
  status: "planned" | "in_progress" | "completed" | "cancelled";
  targetDate: string;
  skill: { id: number; code: string; name: string; category: string } | null;
  milestones: Milestone[];
  progress: Progress[];
};

export function PerformanceDevelopmentSelfPanel({
  setNotice,
}: {
  setNotice: (message: string) => void;
}) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [drafts, setDrafts] = useState<Record<number, { content: string; progressPercent: string }>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/self/performance/development-plans", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not load your skill development plans.");
      return;
    }
    setPlans(payload.plans ?? []);
  }, [setNotice]);

  useEffect(() => { void load(); }, [load]);

  async function addProgress(plan: Plan) {
    const draft = drafts[plan.id] ?? { content: "", progressPercent: "" };
    setSavingId(plan.id);
    try {
      const response = await fetch("/api/self/performance/development-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: plan.id,
          content: draft.content,
          progressPercent: draft.progressPercent === "" ? null : Number(draft.progressPercent),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error ?? "Could not add development progress.");
        return;
      }
      setDrafts((current) => ({ ...current, [plan.id]: { content: "", progressPercent: "" } }));
      await load();
      setNotice("Development progress added.");
    } finally {
      setSavingId(null);
    }
  }

  async function updateMilestone(milestone: Milestone, status: "in_progress" | "completed") {
    setSavingId(milestone.id);
    try {
      const response = await fetch("/api/self/performance/development-plans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ milestoneId: milestone.id, status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error ?? "Could not update development milestone.");
        return;
      }
      await load();
      setNotice(status === "completed" ? "Development milestone completed." : "Development milestone started.");
    } finally {
      setSavingId(null);
    }
  }

  if (plans.length === 0) return null;

  return (
    <article className="employee-edit-card" style={{ marginTop: 16 }}>
      <div className="employee-list-card-head">
        <div>
          <span className="card-kicker">SKILL DEVELOPMENT</span>
          <h3>My development plans</h3>
          <p>These plans are linked to persistent competency gaps found in completed performance evidence. Progress updates do not change compensation or payroll.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {plans.map((plan) => {
          const overdue = !["completed", "cancelled"].includes(plan.status)
            && plan.targetDate < new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
          const draft = drafts[plan.id] ?? { content: "", progressPercent: "" };
          return (
            <div className="employee-edit-card" key={plan.id}>
              <div className="employee-list-card-head">
                <div>
                  <strong>{plan.title}</strong>
                  <span>{plan.skill?.name ?? "Skill"} · {plan.currentProficiency ?? "—"} → {plan.targetProficiency}/5 · target {plan.targetDate}{overdue ? " · overdue" : ""}</span>
                  <p>{plan.objective}</p>
                </div>
                <span className={"employee-status-pill " + (plan.status === "completed" ? "good" : overdue ? "bad" : "warn")}>{plan.status.replaceAll("_", " ")}</span>
              </div>

              {plan.milestones.length > 0 && (
                <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
                  {plan.milestones.map((milestone) => (
                    <div className="leave-request" key={milestone.id}>
                      <BookOpenCheck size={15} />
                      <div style={{ flex: 1 }}>
                        <strong>{milestone.title}</strong>
                        <span>Due {milestone.dueDate}</span>
                        {milestone.detail && <p>{milestone.detail}</p>}
                      </div>
                      <span className={"employee-status-pill " + (milestone.status === "completed" ? "good" : "neutral")}>{milestone.status.replaceAll("_", " ")}</span>
                      {!["completed", "cancelled"].includes(milestone.status) && !["completed", "cancelled"].includes(plan.status) && (
                        <div className="run-actions">
                          {milestone.status === "open" && <button className="secondary-button" type="button" disabled={savingId === milestone.id} onClick={() => void updateMilestone(milestone, "in_progress")}>Start</button>}
                          <button className="primary-button" type="button" disabled={savingId === milestone.id} onClick={() => void updateMilestone(milestone, "completed")}><CheckCircle2 size={14} /> Complete</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {plan.progress.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <span className="card-kicker">PROGRESS HISTORY</span>
                  {plan.progress.map((item) => (
                    <p key={item.id}><strong>{item.authorName}</strong>{item.progressPercent == null ? "" : " · " + item.progressPercent + "%"}: {item.content}</p>
                  ))}
                </div>
              )}

              {!["completed", "cancelled"].includes(plan.status) && (
                <div className="setting-form">
                  <label>Progress %<input type="number" min="0" max="100" step="1" value={draft.progressPercent} onChange={(event) => setDrafts((current) => ({ ...current, [plan.id]: { ...draft, progressPercent: event.target.value } }))} /></label>
                  <label style={{ gridColumn: "1 / -1" }}>Progress update<textarea rows={2} value={draft.content} onChange={(event) => setDrafts((current) => ({ ...current, [plan.id]: { ...draft, content: event.target.value } }))} placeholder="What did you practice, complete, or learn?" /></label>
                  <button className="secondary-button" type="button" disabled={savingId === plan.id} onClick={() => void addProgress(plan)}>Add progress</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </article>
  );
}
