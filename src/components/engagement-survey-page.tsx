"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Survey = {
  id: number;
  question: string;
  status: string;
  disclosure: "available" | "suppressed";
  responses?: number;
  average?: number;
  submitted?: boolean;
};
type ResponseShape = { admin: boolean; surveys: Survey[] };

export function EngagementSurveyPage({ organizationId }: { organizationId: number }) {
  const [data, setData] = useState<ResponseShape | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("How would you rate your overall work experience?");
  const [scores, setScores] = useState<Record<number, number>>({});
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/hcm/engagement-surveys?organizationId=${organizationId}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(String(payload.error ?? "Survey unavailable."));
      setData(payload as ResponseShape);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cannot load survey.");
    } finally { setLoading(false); }
  }, [organizationId]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const act = async (action: "create" | "close" | "answer", input: { surveyId?: number; score?: number } = {}) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/hcm/engagement-surveys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, action, question, ...input }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(String(payload.error ?? "Survey action failed."));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Survey action failed.");
    } finally { setBusy(false); }
  };
  return <main className="mx-auto max-w-3xl space-y-5 p-5 sm:p-8">
    <div><Link href={`/app?organizationId=${organizationId}`} className="text-sm underline">Back to workspace</Link>
      <h1 className="mt-3 text-2xl font-semibold">Engagement survey</h1>
      <p className="mt-2 text-sm">One private 1–5 question. Ratings are stored only as cumulative totals, not individual responses. Results appear only after closure with at least five responses.</p>
    </div>
    {loading && <p role="status">Loading surveys…</p>}
    {error && <p role="alert" className="rounded-md border border-red-300 p-3 text-red-700">{error}</p>}
    {data?.admin && <section className="rounded-lg border p-4">
      <h2 className="font-semibold">Open a survey</h2>
      <label className="mt-3 block text-sm">Survey question
        <input className="mt-1 block w-full rounded-md border p-2" value={question} maxLength={240}
          onChange={e => setQuestion(e.target.value)} />
      </label>
      <button type="button" disabled={busy || data.surveys.some(s => s.status === "open")}
        className="mt-3 rounded-md border px-4 py-2" onClick={() => void act("create")}>Open survey</button>
      <p className="mt-2 text-xs">Only one survey can be open. Live response counts and individual ratings are never shown.</p>
    </section>}
    {data && data.surveys.length === 0 && <p>No surveys yet.</p>}
    {data?.surveys.map(survey => <section key={survey.id} className="rounded-lg border p-4">
      <p className="text-xs uppercase tracking-wide">{survey.status === "open" ? "Open" : "Closed"} survey #{survey.id}</p>
      <h2 className="mt-1 font-semibold">{survey.question}</h2>
      {survey.status === "closed" && survey.disclosure === "available" && (
        <p className="mt-2">Average response: <strong>{survey.average?.toFixed(2)} / 5</strong> across {survey.responses} responses.</p>
      )}
      {survey.status === "closed" && survey.disclosure !== "available" && (
        <p className="mt-2 text-sm">Results suppressed: minimum five participants required.</p>
      )}
      {survey.status === "open" && !data.admin && (
        survey.submitted ? <p className="mt-3 text-sm">Your response has been recorded anonymously. Thank you.</p> :
        <div className="mt-3">
          <fieldset><legend className="mb-2 text-sm">Select one rating</legend>
            <div className="flex flex-wrap gap-3">{[1,2,3,4,5].map(score =>
              <label key={score} className="inline-flex items-center gap-1">
                <input type="radio" name={`survey-${survey.id}`} value={score} checked={scores[survey.id] === score}
                  onChange={() => setScores(current => ({ ...current, [survey.id]: score }))} />
                {score}
              </label>)}</div>
          </fieldset>
          <button type="button" disabled={busy || !scores[survey.id]} className="mt-3 rounded-md border px-4 py-2"
            onClick={() => void act("answer", { surveyId: survey.id, score: scores[survey.id] })}>Submit rating</button>
        </div>
      )}
      {survey.status === "open" && data.admin && (
        <button type="button" disabled={busy} className="mt-3 rounded-md border px-4 py-2"
          onClick={() => void act("close", { surveyId: survey.id })}>Close survey and apply privacy threshold</button>
      )}
    </section>)}
  </main>;
}
