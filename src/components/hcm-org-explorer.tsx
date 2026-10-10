"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, ChevronRight, Network, RefreshCw } from "lucide-react";
import type { HcmOrgExplorerResponse, HcmPositionHistoryResponse } from "@/lib/hcm-org-explorer-contract";

type Load<T> = {
  scope: string;
  status: "loading" | "ready" | "unavailable";
  data: T | null;
};

function phDate(value: string | null) {
  if (!value) return "No end date recorded";
  const date = new Date(value + "T12:00:00+08:00");
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric",
  }).format(date);
}

function integrityLabel(value: string) {
  if (value === "cycle") return "Reporting cycle requires source review";
  if (value === "missing_parent") return "Parent not present in active source";
  return "";
}

export function HcmOrgExplorerClient({ organizationId }: { organizationId: number }) {
  const [revision, setRevision] = useState(0);
  const [graph, setGraph] = useState<Load<HcmOrgExplorerResponse> | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [selectedPositionId, setSelectedPositionId] = useState<number | null>(null);
  const [history, setHistory] = useState<Load<HcmPositionHistoryResponse> | null>(null);
  const graphScope = organizationId + ":" + revision;

  useEffect(() => {
    const controller = new AbortController();
    setGraph({ scope: graphScope, status: "loading", data: null });
    setSelectedUnitId(null);
    setSelectedPositionId(null);
    setHistory(null);
    void fetch("/api/hcm/org-explorer?organizationId=" + organizationId, {
      cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("Organization source unavailable");
      const data = await response.json() as HcmOrgExplorerResponse;
      if (controller.signal.aborted) return;
      if (data.tenantId !== organizationId || !Array.isArray(data.units) ||
          !Array.isArray(data.positions)) throw new Error("Unexpected employer data");
      setGraph({ scope: graphScope, status: "ready", data });
      setSelectedUnitId(data.units[0]?.id ?? null);
    }).catch(() => {
      if (!controller.signal.aborted) {
        setGraph({ scope: graphScope, status: "unavailable", data: null });
      }
    });
    return () => controller.abort();
  }, [organizationId, graphScope]);

  const current = graph?.scope === graphScope && graph.status === "ready" ? graph.data : null;
  const status = graph?.scope === graphScope ? graph.status : "loading";
  const selectedUnit = current?.units.find((unit) => unit.id === selectedUnitId) ?? null;
  const visiblePositions = current?.positions.filter((position) =>
    selectedUnit !== null && position.reportingUnitId === selectedUnit.id) ?? [];
  const selectedPosition = visiblePositions.find((position) => position.id === selectedPositionId) ?? null;
  const positionScope = graphScope + ":" + selectedPositionId;

  useEffect(() => {
    if (selectedPositionId === null || !current || !selectedPosition) return;
    const controller = new AbortController();
    setHistory({ scope: positionScope, status: "loading", data: null });
    const params = new URLSearchParams({
      organizationId: String(organizationId), positionId: String(selectedPositionId),
    });
    void fetch("/api/hcm/position-history?" + params.toString(), {
      cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("Position source unavailable");
      const data = await response.json() as HcmPositionHistoryResponse;
      if (controller.signal.aborted) return;
      if (data.tenantId !== organizationId || data.positionId !== selectedPositionId ||
          !Array.isArray(data.history?.preview?.items)) throw new Error("Unexpected position scope");
      setHistory({ scope: positionScope, status: "ready", data });
    }).catch(() => {
      if (!controller.signal.aborted) {
        setHistory({ scope: positionScope, status: "unavailable", data: null });
      }
    });
    return () => controller.abort();
  }, [organizationId, selectedPositionId, positionScope, current, selectedPosition]);

  const activeHistory = history?.scope === positionScope ? history : null;
  const positionHistory = selectedPosition && activeHistory?.status === "ready" ? activeHistory.data : null;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <Link href="/app" className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800 hover:underline">
          <ArrowLeft size={16} aria-hidden="true" /> Return to People workspace
        </Link>
        <header className="mt-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Linaw HCM · Read-only</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Organizations & Positions</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Navigate current reporting units and recorded position history. This view cannot change workers, positions, payroll or approvals.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRevision((value) => value + 1)}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
          >
            <RefreshCw size={15} aria-hidden="true" /> Refresh sources
          </button>
        </header>

        {status === "loading" &&
          <p role="status" aria-live="polite" className="mt-6 rounded-xl border bg-white p-5 text-slate-600">Loading authorized organization sources…</p>}
        {status === "unavailable" &&
          <div role="alert" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
            <strong>Organization data unavailable</strong>
            <p className="mt-1 text-sm">A source may be unavailable or exceed this bounded pilot view. No incomplete hierarchy is presented as complete.</p>
          </div>}

        {current && (
          <>
            <section aria-label="Organization source summary" className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                { label: "Active org-unit records", value: current.units.length },
                { label: "Position records", value: current.positions.length },
                { label: "Position records without a mapped active unit", value: current.unlinkedPositionRecords },
              ].map((metric) => (
                <div key={metric.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs text-slate-500">{metric.label}</p>
                  <p className="mt-2 text-2xl font-semibold">{metric.value}</p>
                </div>
              ))}
            </section>
            {current.integrity === "needs_review" && (
              <p role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                Some parent links or position-unit mappings are not present in the current active snapshot. Affected records are marked; no reporting relationship is guessed.
              </p>
            )}
            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
              <section aria-labelledby="hcm-org-tree-heading" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-emerald-800">
                  <Network aria-hidden="true" size={18} />
                  <h2 id="hcm-org-tree-heading" className="text-lg font-semibold text-slate-900">Current reporting hierarchy</h2>
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  Source: org_units. Parent-child links are current source records, not historical org snapshots.
                  Philippine business date: {phDate(current.currentBusinessDate)}.
                </p>
                {current.units.length === 0 && <p className="mt-5 text-sm text-slate-600">No active organizational units were returned.</p>}
                <ul className="mt-4 space-y-2" aria-label="Organizational units">
                  {current.units.map((unit) => (
                    <li key={unit.id} style={{ paddingLeft: Math.min(unit.depth, 8) * 14 }}>
                      <button
                        type="button"
                        aria-pressed={unit.id === selectedUnitId}
                        aria-label={unit.name + ", level " + (unit.depth + 1) + ", " + unit.positionRecordCount + " mapped position records. " + integrityLabel(unit.relationship)}
                        onClick={() => { setSelectedUnitId(unit.id); setSelectedPositionId(null); }}
                        className={"flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left text-sm " +
                          (unit.id === selectedUnitId ? "border-emerald-600 bg-emerald-50" : "border-slate-200 hover:bg-slate-50")}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Building2 aria-hidden="true" size={16} className="shrink-0 text-slate-500" />
                          <span className="min-w-0">
                            <strong className="block break-words">{unit.name}</strong>
                            <span className="block text-xs text-slate-500">{unit.code} · {unit.type} · {unit.positionRecordCount} positions</span>
                            {integrityLabel(unit.relationship) &&
                              <span className="block text-xs font-semibold text-amber-800">{integrityLabel(unit.relationship)}</span>}
                          </span>
                        </span>
                        <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-slate-500" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-labelledby="hcm-positions-heading" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 id="hcm-positions-heading" className="text-lg font-semibold">Position records</h2>
                <p className="mt-1 text-xs text-slate-600">
                  {selectedUnit ? selectedUnit.name + " · current recorded reporting unit" : "Select a unit to see position records."}
                </p>
                {selectedUnit && visiblePositions.length === 0 &&
                  <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                    No positions are mapped to this unit in the current source. This does not confirm a vacancy or staffing total.
                  </p>}
                <ul className="mt-4 space-y-2">
                  {visiblePositions.map((position) => (
                    <li key={position.id}>
                      <button
                        type="button"
                        aria-pressed={position.id === selectedPositionId}
                        onClick={() => setSelectedPositionId(position.id)}
                        className={"w-full rounded-lg border p-3 text-left text-sm " +
                          (position.id === selectedPositionId ? "border-emerald-600 bg-emerald-50" : "border-slate-200 hover:bg-slate-50")}
                      >
                        <strong className="block">{position.code}</strong>
                        <span className="mt-1 block text-xs text-slate-600">
                          {position.jobTitle ?? "Job title not recorded"} · Current status: {position.status}
                        </span>
                        {position.supervisoryOrgUnitId !== null && position.orgUnitId !== position.supervisoryOrgUnitId &&
                          <span className="mt-1 block text-xs text-slate-500">
                            Administrative unit #{position.orgUnitId ?? "unassigned"} · Supervisory unit #{position.supervisoryOrgUnitId}
                          </span>}
                      </button>
                    </li>
                  ))}
                </ul>

                {selectedPosition && (
                  <section className="mt-6 border-t border-slate-200 pt-5" aria-labelledby="hcm-position-history-heading">
                    <h3 id="hcm-position-history-heading" className="text-base font-semibold">Position assignment history</h3>
                    <p className="mt-1 text-xs text-slate-600">
                      Position #{selectedPosition.id}. Current title and unit are not reconstructed historical snapshots.
                    </p>
                    {(!activeHistory || activeHistory.status === "loading") &&
                      <p role="status" className="mt-4 text-sm text-slate-600">Loading position history…</p>}
                    {activeHistory?.status === "unavailable" &&
                      <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">Position history unavailable; it has not been verified as empty.</p>}
                    {positionHistory && (
                      <>
                        {positionHistory.history.preview.items.length === 0 &&
                          <p className="mt-4 text-sm text-slate-600">No assignment records returned. Historical links may be in other or legacy sources.</p>}
                        <ol className="mt-4 divide-y divide-slate-100">
                          {positionHistory.history.preview.items.map((assignment) => (
                            <li key={assignment.id} className="py-3">
                              <p className="text-sm font-medium">{assignment.employeeId === null ? "Worker reference unverified in this employer" : "Recorded worker reference #" + assignment.employeeId}</p>
                              <p className="mt-1 text-xs text-slate-600">
                                {assignment.assignmentType} assignment · {phDate(assignment.effectiveFrom)} — {phDate(assignment.effectiveUntil)}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">Source: position_assignments #{assignment.id}</p>
                            </li>
                          ))}
                        </ol>
                        {positionHistory.history.preview.hasMore &&
                          <p role="status" className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-950">
                            Showing only the first 50 assignment history records.
                          </p>}
                      </>
                    )}
                  </section>
                )}
              </section>
            </div>
            <p className="mt-6 text-xs text-slate-500">
              A position record is not a confirmed vacancy or occupied headcount. Assignment intervals do not establish historical manager, department, payroll settlement or statutory compliance.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
