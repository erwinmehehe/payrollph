"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarDays, Download, RefreshCcw, ShieldCheck } from "lucide-react";
import { rosterDateOffset, type TeamRosterRow } from "@/lib/workforce-team-roster";
import { phWorkDateAt } from "@/lib/workforce-manager-actions";
import {
  bulkRosterPreviewCsv,
  previewBulkRosterDay,
  type BulkPreviewShift,
} from "@/lib/workforce-bulk-roster-preview";
import { Metric, Status } from "./ui";

type RosterPage = {
  startDate: string;
  endDate: string;
  weekDates: string[];
  page: number;
  pageSize: number;
  totalEmployees: number;
  totalPages: number;
  rows: TeamRosterRow[];
  shifts: BulkPreviewShift[];
};

function mondayInManila(): string {
  const today = phWorkDateAt();
  const weekdayFromMonday = (new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7;
  return rosterDateOffset(today, -weekdayFromMonday);
}

export function WorkforceBulkRosterPreview({
  organizationId,
  enabled,
  onOpenTeamRoster,
  onStageCompleted,
}: {
  organizationId: number;
  enabled: boolean;
  onOpenTeamRoster: () => void;
  onStageCompleted?: () => void;
}) {
  const [weekStart, setWeekStart] = useState(mondayInManila);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [selection, setSelection] = useState<{ scope: string; ids: number[] } | null>(null);
  const [workDate, setWorkDate] = useState(() => rosterDateOffset(phWorkDateAt(), 1));
  const [shiftSelection, setShiftSelection] = useState<{ scope: string; value: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [snapshot, setSnapshot] = useState<{ scope: string; data: RosterPage } | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const pendingStageKey = useRef<{ signature: string; key: string } | null>(null);
  const activeScope = useRef("");
  const [stageIntent, setStageIntent] = useState<{ scope: string; reason: string; acknowledged: boolean } | null>(null);
  const [staging, setStaging] = useState(false);
  const [stageMessage, setStageMessage] = useState<{ scope: string; text: string; error: boolean } | null>(null);
  const stageFeatureVisible = process.env.NEXT_PUBLIC_WFM_BULK_PUBLISH_UI_ENABLED === "true";
  const scope = JSON.stringify([organizationId, weekStart, page, appliedSearch]);
  const stageReason = stageIntent?.scope === scope ? stageIntent.reason : "";
  const stageAcknowledged = stageIntent?.scope === scope && stageIntent.acknowledged;
  useEffect(() => { activeScope.current = scope; }, [scope]);
  // A prior employer/week/page can never contribute selected worker IDs or shift IDs.
  const selectedIds = selection?.scope === scope ? selection.ids : [];
  const shiftChoice = shiftSelection?.scope === scope ? shiftSelection.value : "";

  const load = useCallback(async () => {
    if (!enabled) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setFailure(null);
    try {
      const params = new URLSearchParams({
        organizationId: String(organizationId), startDate: weekStart,
        page: String(page), search: appliedSearch,
      });
      const response = await fetch("/api/workforce/team-roster?" + params, {
        signal: controller.signal, cache: "no-store",
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(response.status === 403
        ? "Your account is not authorized for the team roster."
        : "The authorized roster source could not be loaded.");
      if (!body || typeof body !== "object") throw new Error("Invalid roster source.");
      const value = body as RosterPage;
      if (value.page !== page || value.startDate !== weekStart ||
        !Array.isArray(value.weekDates) || value.weekDates.length !== 7 ||
        !Array.isArray(value.rows) || value.rows.length > 20 ||
        !Array.isArray(value.shifts)) {
        throw new Error("Roster response does not match the requested scope.");
      }
      if (pending.current === controller && !controller.signal.aborted) {
        setSnapshot({ scope, data: value });
        setFailure(null);
      }
    } catch (error) {
      if (pending.current === controller && !controller.signal.aborted) {
        setFailure({ scope, message: error instanceof Error ? error.message : "Roster unavailable." });
        setSnapshot(null);
      }
    } finally {
      if (pending.current === controller && !controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [enabled, organizationId, weekStart, page, appliedSearch, scope]);

  useEffect(() => {
    void load();
    return () => pending.current?.abort();
  }, [load, reloadKey]);


  const visible = enabled && snapshot?.scope === scope ? snapshot.data : null;
  const currentFailure = enabled && failure?.scope === scope ? failure.message : null;
  const today = phWorkDateAt();
  const futureDates = visible?.weekDates.filter(date => date > today) ?? [];
  const chosenDate = futureDates.includes(workDate) ? workDate : futureDates[0] ?? "";
  const chosenShift = visible?.shifts.find(s => String(s.id) === shiftChoice) ?? null;

  const preview = useMemo(() => {
    if (!visible || !chosenDate || !chosenShift || selectedIds.length === 0) {
      return { rows: [], error: "" };
    }
    try {
      return {
        rows: previewBulkRosterDay({
          weekDates: visible.weekDates, rows: visible.rows,
          selectedEmployeeIds: selectedIds, workDate: chosenDate,
          today, shift: chosenShift,
        }),
        error: "",
      };
    } catch (error) {
      return { rows: [], error: error instanceof Error ? error.message : "Preview unavailable." };
    }
  }, [visible, chosenDate, chosenShift, selectedIds, today]);

  async function stageBatch() {
    if (!stageFeatureVisible || staging || !enabled || !visible || !chosenShift || !chosenDate ||
      !stageAcknowledged || stageReason.trim().length < 12 || preview.rows.length === 0 ||
      preview.error || preview.rows.some(row => row.status !== "review")) return;
    const signature = JSON.stringify([scope, chosenDate, chosenShift.id, selectedIds, stageReason.trim()]);
    const existing = pendingStageKey.current;
    const idempotencyKey = existing?.signature === signature ? existing.key : crypto.randomUUID();
    pendingStageKey.current = { signature, key: idempotencyKey };
    setStaging(true);
    setStageMessage(null);
    try {
      const response = await fetch("/api/workforce/roster-batches", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "stage", organizationId, workDate: chosenDate,
          shiftDefinitionId: chosenShift.id, employeeIds: selectedIds,
          reason: stageReason.trim(), idempotencyKey, acknowledged: true,
        }),
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error : "The governed batch was not staged.";
        throw new Error(message);
      }
      if (activeScope.current === scope) {
        setStageMessage({ scope, text: "Batch staged for another authorized checker. No shifts published.", error: false });
        onStageCompleted?.();
      }
    } catch (err) {
      if (activeScope.current === scope) setStageMessage({ scope,
        text: err instanceof Error ? err.message : "Could not stage batch.", error: true });
    } finally {
      setStaging(false);
    }
  }

  function findEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(search.trim().slice(0, 70));
  }

  function downloadPreview() {
    if (!visible || preview.error || !preview.rows.length) return;
    const blob = new Blob([bulkRosterPreviewCsv(preview.rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "payrollph-roster-proposal-" + chosenDate + "-page-" + page + ".csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const blocked = preview.rows.filter(row => row.status === "blocked").length;
  const unchanged = preview.rows.filter(row => row.status === "unchanged").length;

  return (
    <article className="card" data-wfm-bulk-roster-preview>
      <div className="card-header">
        <div>
          <div className="card-kicker">Bulk roster preparation · proposal only</div>
          <h2>Review a shift change for multiple workers.</h2>
          <p>Choose authorized workers from one 20-person roster page, pick a future date and shift, and preview obvious overlap and source-evidence problems. No changes are saved or published here.</p>
        </div>
        <button type="button" className="secondary-button" disabled={!enabled || loading}
          onClick={() => setReloadKey(n => n + 1)}>
          <RefreshCcw size={15} aria-hidden="true"/> Refresh
        </button>
      </div>

      <div className="notice notice-slate" style={{ margin: "0 18px 16px" }}>
        <ShieldCheck size={16} aria-hidden="true"/>
        <span>Proposals require individual verification of approved leave, site and role authorization, labor policy, overtime, payroll treatment, and live source changes. This is not a compliance certificate or bulk-publish action.</span>
      </div>

      <div className="setting-form" style={{ padding: "0 18px 16px" }}>
        <label>Week beginning
          <input type="date" value={weekStart} aria-label="Bulk draft week beginning"
            onChange={e => { if (e.target.value) { setWeekStart(e.target.value); setPage(1); } }} />
        </label>
        <form onSubmit={findEmployee} style={{ display: "flex", alignItems: "end", gap: 8 }}>
          <label>Search authorized employees
            <input value={search} onChange={e => setSearch(e.target.value)} maxLength={70}
              placeholder="Name or employee number" aria-label="Bulk draft employee search"/>
          </label>
          <button type="submit" className="secondary-button">Find</button>
        </form>
      </div>
      {currentFailure && <div className="notice notice-amber" role="alert" style={{ margin: "0 18px 16px" }}>{currentFailure}</div>}
      {!visible && !currentFailure && enabled && <div className="notice notice-slate" role="status" style={{ margin: "0 18px 16px" }}>Loading authorized roster page…</div>}
      {visible && (
        <>
          <p className="id" style={{ padding: "0 18px 12px" }}>Page {visible.page} of {visible.totalPages} · {visible.totalEmployees} matching employees. Selections never carry across pages or employers.</p>
          <div className="run-actions" style={{ padding: "0 18px 16px", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="secondary-button" disabled={page <= 1 || loading}
              onClick={() => setPage(p => Math.max(1, p - 1))}>Previous page</button>
            <button type="button" className="secondary-button" disabled={page >= visible.totalPages || loading}
              onClick={() => setPage(p => p + 1)}>Next page</button>
            <label>
              Proposal work date
              <select value={chosenDate} disabled={!futureDates.length} onChange={e => setWorkDate(e.target.value)}
                aria-label="Bulk draft work date">
                {futureDates.length === 0 && <option value="">Select a future roster week</option>}
                {futureDates.map(date => <option key={date} value={date}>{date}</option>)}
              </select>
            </label>
            <label>
              Proposed shift
              <select value={shiftChoice} onChange={e => setShiftSelection({ scope, value: e.target.value })}
                aria-label="Bulk draft shift">
                <option value="">Select shift</option>
                {visible.shifts.map(shift => <option key={shift.id} value={String(shift.id)}>
                  {shift.code} · {shift.name} · {shift.startTime}–{shift.endTime}
                </option>)}
              </select>
            </label>
          </div>
          <div className="data-table-wrap slim-scroll">
            <table className="data-table" aria-label="Choose workers for a roster proposal">
              <thead><tr>
                <th><input type="checkbox" aria-label="Select all workers on this roster page"
                  checked={visible.rows.length > 0 && selectedIds.length === visible.rows.length}
                  onChange={e => setSelection({ scope, ids: e.target.checked ? visible.rows.map(row => row.employee.id) : [] })}/></th>
                <th>Worker</th><th>Employment state</th><th>Existing schedule</th>
              </tr></thead>
              <tbody>{visible.rows.map(row => {
                const day = row.days.find(d => d.date === chosenDate);
                return <tr key={row.employee.id}>
                  <td><input type="checkbox" checked={selectedIds.includes(row.employee.id)}
                    aria-label={"Select " + row.employee.name}
                    onChange={e => {
                      const checked = e.target.checked;
                      setSelection(current => {
                        const ids = current?.scope === scope ? current.ids : [];
                        return { scope, ids: checked
                          ? ids.includes(row.employee.id) ? ids : [...ids, row.employee.id]
                          : ids.filter(id => id !== row.employee.id) };
                      });
                    }}/></td>
                  <td><strong>{row.employee.name}</strong><div className="id">{row.employee.employeeNo}</div></td>
                  <td><Status value={row.employee.status}/></td>
                  <td>{row.error ? "Needs source review" : day
                    ? day.isRestDay ? "Recorded rest day" :
                      day.segments.length ? day.segments.map(s => s.shiftCode + " " + s.startTime + "–" + s.endTime).join(" / ") : "Unassigned/no shift"
                    : "Missing source day"}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <section className="stats-grid" style={{ padding: "14px 18px" }}>
            <Metric label="Selected workers" value={String(selectedIds.length)} hint="this source page" icon={<CalendarDays size={15}/>} tone="blue"/>
            <Metric label="Known blockers" value={String(blocked)} hint="not eligible for current proposal" icon={<ShieldCheck size={15}/>} tone={blocked ? "amber" : "slate"}/>
            <Metric label="Already assigned" value={String(unchanged)} hint="unchanged, no action needed" icon={<CalendarDays size={15}/>} tone="slate"/>
          </section>
          {preview.error && <div className="notice notice-red" role="alert" style={{ margin: "0 18px 16px" }}>{preview.error}</div>}
          {preview.rows.length > 0 && (
            <>
              <div className="data-table-wrap slim-scroll">
                <table className="data-table" aria-label="Draft roster checks by employee">
                  <thead><tr><th>Employee</th><th>Current → proposed</th><th>Review state</th><th>Source checks</th></tr></thead>
                  <tbody>{preview.rows.map(row => <tr key={row.employeeId}>
                    <td><strong>{row.employeeName}</strong><div className="id">{row.employeeNo}</div></td>
                    <td>{row.existing}<div className="id">→ {row.proposed}</div></td>
                    <td><Status value={row.status === "blocked" ? "Blocked" : row.status === "unchanged" ? "Unchanged" : "Review required"}/></td>
                    <td><small>{row.reasons.join(" ")}</small></td>
                  </tr>)}</tbody>
                </table>
              </div>
              <div className="run-actions" style={{ padding: "16px 18px", gap: 10 }}>
                <button type="button" className="secondary-button" onClick={downloadPreview}>
                  <Download size={15} aria-hidden="true"/> Export this preview CSV
                </button>
                <button type="button" className="primary-button brand" onClick={onOpenTeamRoster}>
                  Open governed Team Roster →
                </button>
              </div>
            </>
          )}
          {stageFeatureVisible && preview.rows.length > 0 && (
            <div className="setting-form" style={{ padding: "0 18px 18px" }}>
              <div className="notice notice-amber">This optional governed staging lane is separate from the read-only preview. Server checks are stricter and may decline the proposal; staged shifts are never published automatically.</div>
              <label>Why is this batch schedule change needed?
                <input maxLength={240} value={stageReason} onChange={e => setStageIntent(current => ({ scope, reason: e.target.value,
                  acknowledged: current?.scope === scope ? current.acknowledged : false }))}
                  placeholder="Document the roster impact and authorization" aria-label="Bulk shift staging reason"/>
              </label>
              <label style={{ display: "flex", alignItems: "start", gap: 10 }}>
                <input type="checkbox" checked={stageAcknowledged}
                  onChange={e => setStageIntent(current => ({ scope,
                    reason: current?.scope === scope ? current.reason : "", acknowledged: e.target.checked }))}/>
                <span>I understand this batch may change future payroll treatment and requires a second authorized reviewer.</span>
              </label>
              {stageMessage?.scope === scope && <div role="status"
                className={stageMessage.error ? "notice notice-amber" : "notice notice-slate"}>
                {stageMessage.text}
              </div>}
              <button type="button" className="primary-button brand"
                disabled={staging || !stageAcknowledged || stageReason.trim().length < 12 ||
                  preview.rows.some(row => row.status !== "review")}
                onClick={() => void stageBatch()}>
                {staging ? "Staging…" : "Stage for independent approval"}
              </button>
            </div>
          )}
          {selectedIds.length > 0 && (!chosenShift || !chosenDate) && (
            <div className="notice notice-slate" style={{ margin: "0 18px 16px" }}>
              Select a future roster date and one shift to see a draft.
            </div>
          )}
        </>
      )}
    </article>
  );
}
