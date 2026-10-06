"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  RefreshCw,
  Save,
  Send,
  UserCheck,
} from "lucide-react";

type ProbationReview = {
  id: number;
  status: "draft" | "submitted";
  recommendation: "confirm_regular" | "non_renew" | "needs_hr_review" | null;
  overallRating: number | null;
  roleExpectationsRating: number | null;
  workQualityRating: number | null;
  reliabilityRating: number | null;
  conductCollaborationRating: number | null;
  summary: string | null;
  strengths: string | null;
  developmentAreas: string | null;
  reviewerName: string;
  submittedAt: string | null;
};

type Acknowledgment = {
  id: number;
  response: string;
  employeeComment: string | null;
  acknowledgedByName: string;
  createdAt: string;
};

type Payload = {
  review: ProbationReview | null;
  acknowledgment: Acknowledgment | null;
  canManage: boolean;
  mutable: boolean;
  guardrail: string;
};

const RATINGS = [1, 2, 3, 4, 5];

function readable(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function HcmProbationReviewPanel({
  organizationId,
  employeeId,
  employmentTermId,
  probationReviewDate,
  onChanged,
}: {
  organizationId: number;
  employeeId: number;
  employmentTermId: number;
  probationReviewDate: string | null;
  onChanged?: () => Promise<unknown> | unknown;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({
    recommendation: "",
    overallRating: "",
    roleExpectationsRating: "",
    workQualityRating: "",
    reliabilityRating: "",
    conductCollaborationRating: "",
    summary: "",
    strengths: "",
    developmentAreas: "",
  });

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(
        "/api/hcm/probation-reviews?organizationId=" + organizationId
          + "&employeeId=" + employeeId
          + "&employmentTermId=" + employmentTermId,
        { cache: "no-store" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not load probation review.");
      const next = data as Payload;
      setPayload(next);
      if (next.review) {
        setForm({
          recommendation: next.review.recommendation ?? "",
          overallRating: next.review.overallRating == null ? "" : String(next.review.overallRating),
          roleExpectationsRating: next.review.roleExpectationsRating == null ? "" : String(next.review.roleExpectationsRating),
          workQualityRating: next.review.workQualityRating == null ? "" : String(next.review.workQualityRating),
          reliabilityRating: next.review.reliabilityRating == null ? "" : String(next.review.reliabilityRating),
          conductCollaborationRating: next.review.conductCollaborationRating == null ? "" : String(next.review.conductCollaborationRating),
          summary: next.review.summary ?? "",
          strengths: next.review.strengths ?? "",
          developmentAreas: next.review.developmentAreas ?? "",
        });
      }
    } catch (loadError) {
      setPayload(null);
      setError(loadError instanceof Error ? loadError.message : "Could not load probation review.");
    }
  }, [employeeId, employmentTermId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createDraft() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/hcm/probation-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, employeeId, employmentTermId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not open probation review.");
      setNotice("Probation review draft opened.");
      await load();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Could not open probation review.");
    } finally {
      setBusy(false);
    }
  }

  async function save(action: "save" | "submit") {
    if (!payload?.review) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/hcm/probation-reviews", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          id: payload.review.id,
          action,
          recommendation: form.recommendation || null,
          overallRating: form.overallRating || null,
          roleExpectationsRating: form.roleExpectationsRating || null,
          workQualityRating: form.workQualityRating || null,
          reliabilityRating: form.reliabilityRating || null,
          conductCollaborationRating: form.conductCollaborationRating || null,
          summary: form.summary,
          strengths: form.strengths,
          developmentAreas: form.developmentAreas,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not update probation review.");
      setNotice(action === "submit"
        ? "Probation review submitted and locked as lifecycle evidence."
        : "Probation review draft saved.");
      await load();
      await onChanged?.();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Could not update probation review.");
    } finally {
      setBusy(false);
    }
  }

  const review = payload?.review ?? null;
  const submitted = review?.status === "submitted";

  return (
    <section className="card" style={{ margin: "12px 0 0", boxShadow: "none" }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">HCM CORE 3.9 · PROBATION REVIEW</div>
          <h2 style={{ fontSize: 14 }}>Structured manager review</h2>
          <p>
            Capture a manager assessment tied to this probationary employment term. The recommendation is evidence only;
            a separate governed employment decision is still required.
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void load()} disabled={busy}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {error && (
        <div className="notice notice-amber" style={{ marginBottom: 12 }}>
          <AlertTriangle size={15} /><span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="notice notice-green" style={{ marginBottom: 12 }}>
          <CheckCircle2 size={15} /><span>{notice}</span>
        </div>
      )}

      <div className="notice notice-blue" style={{ marginBottom: 12 }}>
        <ClipboardCheck size={15} />
        <span>
          {probationReviewDate ? "Governed review date: " + probationReviewDate + ". " : ""}
          Ratings use a 1–5 internal scale. PayrollPH does not interpret a score as automatic regularization,
          non-renewal, or any legal conclusion.
        </span>
      </div>

      {!review && (
        <button className="primary-button" type="button" onClick={() => void createDraft()} disabled={busy}>
          <ClipboardCheck size={14} /> Open probation review
        </button>
      )}

      {review && !submitted && (
        <div style={{ display: "grid", gap: 12 }}>
          <div className="setting-form">
            <label>
              Manager recommendation
              <select
                value={form.recommendation}
                onChange={(event) => setForm({ ...form, recommendation: event.target.value })}
              >
                <option value="">Select recommendation…</option>
                <option value="confirm_regular">Recommend confirm regular</option>
                <option value="non_renew">Recommend non-renewal / end-of-probation review</option>
                <option value="needs_hr_review">Needs HR review before recommendation</option>
              </select>
            </label>
            <RatingField label="Overall" value={form.overallRating} onChange={(value) => setForm({ ...form, overallRating: value })} />
            <RatingField label="Role expectations" value={form.roleExpectationsRating} onChange={(value) => setForm({ ...form, roleExpectationsRating: value })} />
            <RatingField label="Work quality" value={form.workQualityRating} onChange={(value) => setForm({ ...form, workQualityRating: value })} />
            <RatingField label="Reliability" value={form.reliabilityRating} onChange={(value) => setForm({ ...form, reliabilityRating: value })} />
            <RatingField label="Conduct & collaboration" value={form.conductCollaborationRating} onChange={(value) => setForm({ ...form, conductCollaborationRating: value })} />
          </div>

          <label>
            Review summary
            <textarea
              minLength={10}
              maxLength={8000}
              value={form.summary}
              onChange={(event) => setForm({ ...form, summary: event.target.value })}
              placeholder="Summarize the manager's observations and facts reviewed."
            />
          </label>
          <label>
            Strengths
            <textarea
              maxLength={8000}
              value={form.strengths}
              onChange={(event) => setForm({ ...form, strengths: event.target.value })}
              placeholder="Optional strengths observed during probation."
            />
          </label>
          <label>
            Development areas
            <textarea
              maxLength={8000}
              value={form.developmentAreas}
              onChange={(event) => setForm({ ...form, developmentAreas: event.target.value })}
              placeholder="Optional development areas or follow-up points."
            />
          </label>

          <div className="run-actions">
            <button className="secondary-button" type="button" onClick={() => void save("save")} disabled={busy}>
              <Save size={13} /> Save draft
            </button>
            <button className="primary-button" type="button" onClick={() => void save("submit")} disabled={busy}>
              <Send size={13} /> Submit & lock review
            </button>
          </div>
          <div className="modal-note">
            Submission is immutable. If the employment decision is still pending, this submitted review becomes part of
            the evidence sealed at approval.
          </div>
        </div>
      )}

      {review && submitted && (
        <div style={{ display: "grid", gap: 12 }}>
          <div className="run-stats" style={{ margin: 0 }}>
            <div>
              <span>Recommendation</span>
              <strong style={{ fontSize: 13 }}>{readable(review.recommendation ?? "none")}</strong>
              <small>manager evidence only</small>
            </div>
            <div>
              <span>Overall rating</span>
              <strong>{review.overallRating ?? "—"} / 5</strong>
              <small>internal assessment</small>
            </div>
            <div>
              <span>Reviewer</span>
              <strong style={{ fontSize: 13 }}>{review.reviewerName}</strong>
              <small>{review.submittedAt ? new Date(review.submittedAt).toLocaleString("en-PH") : "submitted"}</small>
            </div>
            <div>
              <span>Employee receipt</span>
              <strong style={{ fontSize: 13 }}>{payload?.acknowledgment ? "Acknowledged" : "Pending"}</strong>
              <small>does not mean agreement</small>
            </div>
          </div>

          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>ASSESSMENT</th><th>RATING</th></tr></thead>
              <tbody>
                <tr><td>Role expectations</td><td>{review.roleExpectationsRating ?? "—"} / 5</td></tr>
                <tr><td>Work quality</td><td>{review.workQualityRating ?? "—"} / 5</td></tr>
                <tr><td>Reliability</td><td>{review.reliabilityRating ?? "—"} / 5</td></tr>
                <tr><td>Conduct & collaboration</td><td>{review.conductCollaborationRating ?? "—"} / 5</td></tr>
              </tbody>
            </table>
          </div>

          <div>
            <strong>Summary</strong>
            <p style={{ whiteSpace: "pre-wrap" }}>{review.summary}</p>
            {review.strengths && <><strong>Strengths</strong><p style={{ whiteSpace: "pre-wrap" }}>{review.strengths}</p></>}
            {review.developmentAreas && <><strong>Development areas</strong><p style={{ whiteSpace: "pre-wrap" }}>{review.developmentAreas}</p></>}
          </div>

          {payload?.acknowledgment && (
            <div className="notice notice-green">
              <UserCheck size={15} />
              <span>
                Receipt acknowledged by {payload.acknowledgment.acknowledgedByName} on{" "}
                {new Date(payload.acknowledgment.createdAt).toLocaleString("en-PH")}.
                {payload.acknowledgment.employeeComment ? " Employee comment: " + payload.acknowledgment.employeeComment : ""}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RatingField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label} rating
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select…</option>
        {RATINGS.map((rating) => (
          <option key={rating} value={rating}>{rating} / 5</option>
        ))}
      </select>
    </label>
  );
}
