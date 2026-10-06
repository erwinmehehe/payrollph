"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, RefreshCw } from "lucide-react";

type ReviewRow = {
  review: {
    id: number;
    employmentTermId: number;
    status: string;
    recommendation: string | null;
    ratings: {
      overall: number | null;
      roleExpectations: number | null;
      workQuality: number | null;
      reliability: number | null;
      conductCollaboration: number | null;
    };
    summary: string | null;
    strengths: string | null;
    developmentAreas: string | null;
    reviewerName: string;
    submittedAt: string | null;
  };
  term: {
    probationReviewDate?: string | null;
    effectiveFrom?: string | null;
  } | null;
  acknowledgment: {
    id: number;
    employeeComment: string | null;
    acknowledgedByName: string;
    createdAt: string;
  } | null;
};

type Payload = {
  reviews: ReviewRow[];
  acknowledgmentStatement: string;
};

function readable(value: string | null) {
  if (!value) return "No recommendation";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(value: string | null) {
  if (!value) return "Submitted";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

export function HcmSelfProbationReviews() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyReviewId, setBusyReviewId] = useState<number | null>(null);
  const [comments, setComments] = useState<Record<number, string>>({});
  const [confirmed, setConfirmed] = useState<Record<number, boolean>>({});

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/self/probation-reviews", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not load probation reviews.");
      setPayload(data as Payload);
    } catch (loadError) {
      setPayload(null);
      setError(loadError instanceof Error ? loadError.message : "Could not load probation reviews.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function acknowledge(reviewId: number) {
    if (!confirmed[reviewId]) return;
    setBusyReviewId(reviewId);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/self/probation-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId,
          employeeComment: comments[reviewId] ?? "",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not record receipt acknowledgment.");
      setNotice("Receipt acknowledgment recorded. This does not mean you agreed with the review.");
      await load();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Could not record receipt acknowledgment.");
    } finally {
      setBusyReviewId(null);
    }
  }

  if (!payload && !error) return null;
  if (payload && payload.reviews.length === 0) return null;

  return (
    <section className="employee-list-card" data-hcm-probation-review-receipt>
      <div className="employee-list-card-head">
        <div>
          <span className="card-kicker">EMPLOYMENT REVIEW</span>
          <h3>Probation review receipt</h3>
          <p>Review submitted manager feedback and acknowledge only that you received it.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void load()} disabled={busyReviewId !== null}>
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

      {payload?.reviews.map(({ review, term, acknowledgment }) => (
        <article className="card" key={review.id} style={{ boxShadow: "none", marginTop: 10 }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">PROBATION REVIEW</div>
              <h3 style={{ fontSize: 15 }}>{readable(review.recommendation)}</h3>
              <p>
                Submitted by {review.reviewerName} · {dateTime(review.submittedAt)}
                {term?.probationReviewDate ? ` · review date ${term.probationReviewDate}` : ""}
              </p>
            </div>
            <span className={`status-badge ${acknowledgment ? "good" : "warn"}`}>
              {acknowledgment ? "Receipt acknowledged" : "Acknowledgment requested"}
            </span>
          </div>

          <div className="run-stats" style={{ margin: "0 0 12px" }}>
            <div>
              <span>Overall rating</span>
              <strong>{review.ratings.overall ?? "—"} / 5</strong>
              <small>internal manager assessment</small>
            </div>
            <div>
              <span>Role expectations</span>
              <strong>{review.ratings.roleExpectations ?? "—"} / 5</strong>
              <small>internal manager assessment</small>
            </div>
            <div>
              <span>Work quality</span>
              <strong>{review.ratings.workQuality ?? "—"} / 5</strong>
              <small>internal manager assessment</small>
            </div>
          </div>

          {review.summary && (
            <div style={{ marginBottom: 10 }}>
              <strong>Review summary</strong>
              <p style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{review.summary}</p>
            </div>
          )}
          {review.strengths && (
            <div style={{ marginBottom: 10 }}>
              <strong>Strengths</strong>
              <p style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{review.strengths}</p>
            </div>
          )}
          {review.developmentAreas && (
            <div style={{ marginBottom: 10 }}>
              <strong>Development areas</strong>
              <p style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{review.developmentAreas}</p>
            </div>
          )}

          {acknowledgment ? (
            <div className="notice notice-green">
              <CheckCircle2 size={15} />
              <span>
                Receipt acknowledged {dateTime(acknowledgment.createdAt)}.
                {acknowledgment.employeeComment ? ` Your comment: ${acknowledgment.employeeComment}` : ""}
              </span>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              <div className="notice notice-blue">
                <ClipboardCheck size={15} />
                <span>{payload.acknowledgmentStatement}</span>
              </div>
              <label>
                Optional employee comment
                <textarea
                  maxLength={4000}
                  value={comments[review.id] ?? ""}
                  onChange={(event) => setComments((current) => ({ ...current, [review.id]: event.target.value }))}
                  placeholder="Optional comment about the review or receipt."
                />
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={Boolean(confirmed[review.id])}
                  onChange={(event) => setConfirmed((current) => ({ ...current, [review.id]: event.target.checked }))}
                />
                <span>I understand this records receipt only. It does not mean I agree with the review or approve an employment decision.</span>
              </label>
              <div className="run-actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={!confirmed[review.id] || busyReviewId !== null}
                  onClick={() => void acknowledge(review.id)}
                >
                  <ClipboardCheck size={14} />
                  {busyReviewId === review.id ? "Recording…" : "Acknowledge receipt"}
                </button>
              </div>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
