"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CopilotBrief, CopilotSignal } from "@/lib/operations-copilot";
import type { OperationsCopilotNarration } from "@/lib/operations-copilot-ai";

type Payload = { brief: CopilotBrief; aiAvailable: boolean };
type Loaded = { key: string; payload: Payload | null; error: string | null };

export default function OperationsCopilotPanel(props: {
  organizationId: number;
  area: "hr" | "payroll";
  runId: number | null;
  legalEntityId: number | null;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [highOnly, setHighOnly] = useState(false);
  const [narration, setNarration] = useState<{ key: string; value: OperationsCopilotNarration } | null>(null);
  const [narrationError, setNarrationError] = useState<{ key: string; value: string } | null>(null);
  const [narrationBusy, setNarrationBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  const urlParams = new URLSearchParams({
    organizationId: String(props.organizationId),
    area: props.area,
  });
  if (props.runId !== null) urlParams.set("runId", String(props.runId));
  if (props.legalEntityId !== null) urlParams.set("legalEntityId", String(props.legalEntityId));
  const url = "/api/operations-copilot?" + urlParams.toString();
  const scopeKey = url + "|revision=" + revision;

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const data: unknown = await response.json();
        if (!response.ok) throw new Error(
          data && typeof data === "object" && "error" in data
            ? String((data as { error: unknown }).error) : "Unable to load source evidence.",
        );
        if (!data || typeof data !== "object" || !("brief" in data) || !("aiAvailable" in data)) {
          throw new Error("Incomplete operations source.");
        }
        const result = data as Payload;
        const brief = result.brief;
        if (!brief || brief.organizationId !== props.organizationId
          || brief.area !== props.area || brief.runId !== props.runId
          || !Array.isArray(brief.metrics) || !Array.isArray(brief.signals)
          || !["stored-payroll-assurance", "scoped-hr-operational-cases"].includes(brief.source)
          || typeof result.aiAvailable !== "boolean") {
          throw new Error("Scope mismatch or incomplete operations source.");
        }
        if (!controller.signal.aborted) setLoaded({ key: scopeKey, payload: result, error: null });
      } catch (error) {
        if (!controller.signal.aborted) setLoaded({
          key: scopeKey, payload: null,
          error: error instanceof Error ? error.message : "Operations source unavailable.",
        });
      }
    })();
    return () => controller.abort();
  }, [url, scopeKey, props.area, props.organizationId, props.runId]);

  const activeLoaded = loaded?.key === scopeKey ? loaded : null;
  const payload = activeLoaded?.payload;
  const currentNarration = narration?.key === scopeKey ? narration.value : null;
  const currentNarrationError = narrationError?.key === scopeKey ? narrationError.value : "";
  const brief = payload?.brief;
  const signals = (brief?.signals ?? []).filter(signal => !highOnly || signal.priority === "high");

  async function askForNarration() {
    if (!payload?.aiAvailable || narrationBusy) return;
    setNarrationBusy(true);
    setNarration(null);
    setNarrationError(null);
    try {
      const response = await fetch(url, {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data: unknown = await response.json();
      if (!response.ok) throw new Error(
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error) : "Narration unavailable.",
      );
      if (!data || typeof data !== "object" || !("narration" in data)) throw new Error("Narration unavailable.");
      const proposed = (data as { narration: OperationsCopilotNarration }).narration;
      if (!proposed || typeof proposed.overview !== "string" || !Array.isArray(proposed.focusKeys)) {
        throw new Error("Narration unavailable.");
      }
      setNarration({ key: scopeKey, value: proposed });
    } catch (error) {
      setNarrationError({ key: scopeKey, value: error instanceof Error ? error.message : "Narration unavailable." });
    } finally {
      setNarrationBusy(false);
    }
  }

  return <div className="mt-7 space-y-6">
    <div className="flex flex-wrap items-center gap-3">
      <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        Employer #{props.organizationId}
      </span>
      {props.runId !== null && <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        Payroll run #{props.runId}
      </span>}
      <button type="button" className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
        onClick={() => { setHighOnly(false); setRevision(old => old + 1); }} disabled={activeLoaded === null}>
        Refresh source
      </button>
      <Link href={props.area === "hr"
        ? "/hcm/work-items?organizationId=" + props.organizationId
        : "/app?organizationId=" + props.organizationId + "&workspacePage=Payroll"}
        className="inline-flex min-h-11 items-center rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-900">
        Open original workspace
      </Link>
    </div>

    {activeLoaded === null && <p role="status" className="rounded-xl border bg-white p-5 text-slate-700">
      Loading authorized source evidence. Counts are not yet available.
    </p>}
    {activeLoaded?.error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-900">
      <p className="font-semibold">The source could not be verified.</p>
      <p className="mt-1 text-sm">{activeLoaded.error}</p>
      <p className="mt-2 text-sm">No zero counts or approval decisions have been assumed.</p>
    </div>}

    {brief && <>
      <section aria-label="Source counts" className="grid gap-4 sm:grid-cols-3">
        {brief.metrics.map(metric => <article key={metric.key} className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-600">{metric.label}</p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-slate-900">{metric.value}</p>
        </article>)}
      </section>

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-lg font-semibold text-slate-900">Evidence boundary</h2>
        <p className="mt-2 text-sm text-slate-700">{brief.caution}</p>
        <p className="mt-2 text-sm text-slate-700">
          Source: {brief.source === "stored-payroll-assurance" ? "Existing payroll assurance findings" : "Existing HR operational work items"}.
          Showing {brief.signalsShown} of {brief.signalTypesOrCases} {brief.area === "hr" ? "open cases" : "distinct finding codes"}.
          {brief.previewTruncated ? " This is a limited preview; open the source for the remaining records." : ""}
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5" aria-label="Optional AI narration">
        <h2 className="text-lg font-semibold text-slate-900">Optional AI summary</h2>
        <p className="mt-2 text-sm text-slate-600">
          When separately enabled and approved, the model receives only aggregate counts and controlled finding categories.
          No individual payroll, employee, or HR case details are sent.
        </p>
        {payload?.aiAvailable
          ? <button type="button" disabled={narrationBusy} onClick={() => void askForNarration()}
              className="mt-3 min-h-11 rounded-lg bg-emerald-900 px-5 py-2 font-semibold text-white disabled:opacity-50">
              {narrationBusy ? "Preparing summary…" : "Generate AI summary"}
            </button>
          : <p className="mt-3 text-sm font-medium text-slate-700">AI narration is disabled until tenant privacy and model approvals are configured.</p>}
        {currentNarration && <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4" role="status">
          <p className="font-semibold text-emerald-900">AI draft · verify against the evidence below</p>
          <p className="mt-2 text-sm text-slate-800">{currentNarration.overview}</p>
          {currentNarration.focusKeys.length > 0 && <p className="mt-2 text-sm text-slate-700">
            Suggested source categories: {currentNarration.focusKeys.join(", ")}
          </p>}
        </div>}
        {currentNarrationError && <p role="alert" className="mt-3 text-sm text-red-800">{currentNarrationError}</p>}
      </section>

      <section aria-label="Operations triage" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-slate-900">Source-linked review priorities</h2>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={highOnly} onChange={event => setHighOnly(event.target.checked)}/>
            High-priority only
          </label>
        </div>
        {signals.length === 0 && <p className="rounded-xl border bg-white p-5 text-sm text-slate-700">
          {highOnly ? "No high-priority items in this source preview." : "No review items in this source preview."}
          This is not an approval or a statement that all work is complete.
        </p>}
        {signals.map((signal: CopilotSignal) => <article key={signal.key} className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className={"rounded-md px-2 py-1 text-xs font-semibold " +
              (signal.priority === "high" ? "bg-red-50 text-red-800" :
                signal.priority === "medium" ? "bg-amber-50 text-amber-900" : "bg-slate-100 text-slate-700")}>
              {signal.priority === "high" ? "High" : signal.priority === "medium" ? "Medium" : "Information"}
            </span>
            {signal.count > 1 && <span className="text-xs text-slate-600">{signal.count} recorded findings</span>}
            <span className="text-xs text-slate-500">{signal.evidence}</span>
          </div>
          <h3 className="mt-3 text-lg font-semibold text-slate-900">{signal.title}</h3>
          <p className="mt-2 text-sm text-slate-700">{signal.reason}</p>
          <p className="mt-2 text-sm text-slate-800"><strong>Next review:</strong> {signal.nextStep}</p>
          <Link href={signal.sourceUrl} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800 underline underline-offset-4">
            Review original source
          </Link>
        </article>)}
      </section>
    </>}
  </div>;
}
