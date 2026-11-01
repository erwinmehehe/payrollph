"use client";

import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { Status } from "@/components/workspace/ui";
import { readVerifiedComplianceCalendar, type CalendarPayload as Payload, type CalendarStatus, type RuleWatchItem } from "@/lib/compliance-calendar-read";
import { useScopedAsyncResource } from "@/components/workspace/use-scoped-async-resource";
import {
  countComplianceAgencies, needsComplianceAttention, selectComplianceCalendarItems,
  type ComplianceAgencyFilter, type ComplianceDateSort,
} from "@/lib/compliance-calendar-planner";

// This flag controls explanatory UI only. Employer authorization and
// fail-closed source checks run even when the optional notice is OFF.
const complianceReadStateUiEnabled =
  process.env.NEXT_PUBLIC_COMPLIANCE_READ_STATE_UI_ENABLED === "true";

const RULE_WATCH_LABEL: Record<RuleWatchItem["status"], string> = {
  current: "Current",
  "review-due": "Review due",
  "verification-unrecorded": "Verification not recorded",
  "change-upcoming": "Change upcoming",
  "update-overdue": "Update overdue",
  "coverage-ending": "Coverage ending",
  "no-coverage": "No coverage",
};
const RULE_WATCH_URGENT = new Set<RuleWatchItem["status"]>(["update-overdue", "no-coverage", "coverage-ending", "change-upcoming"]);

function statusLabel(status: CalendarStatus) {
  if (status === "complete") return "Reconciled";
  if (status === "due-soon") return "Due soon";
  if (status === "posting-pending") return "Posting pending";
  if (status === "verification-required") return "Verify filing";
  if (status === "configuration-required") return "Needs employer data";
  if (status === "exception") return "Exception";
  if (status === "overdue") return "Overdue";
  return "Upcoming";
}

function prettyDate(value: string | null) {
  if (!value) return "Deadline unresolved";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  }).format(new Date(`${value}T00:00:00+08:00`));
}

export function ComplianceCalendarPanel({ organizationId }: { organizationId: number }) {
  const [attentionOnly, setAttentionOnly] = useState(true);
  const [agencyFilter, setAgencyFilter] = useState<ComplianceAgencyFilter>("all");
  const [dateSort, setDateSort] = useState<ComplianceDateSort>("earliest");
  const fetchCalendar = useCallback((signal: AbortSignal): Promise<Payload> =>
    readVerifiedComplianceCalendar(organizationId, fetch, signal), [organizationId]);

  // Discard previous-employer data before paint and abort retired responses,
  // including errors that arrive after a fast A-to-B employer switch.
  const { data: payload, loading, error: loadError, reload } = useScopedAsyncResource(
    "compliance-calendar:" + organizationId,
    fetchCalendar,
  );
  const error = loadError?.message ?? "";

  const items = useMemo(
    () => selectComplianceCalendarItems(payload?.items ?? [], attentionOnly, agencyFilter, dateSort),
    [payload, attentionOnly, agencyFilter, dateSort],
  );
  const agencyCounts = useMemo(() => countComplianceAgencies(payload?.items ?? []), [payload]);
  const attentionCount = (payload?.items ?? []).filter((item) => needsComplianceAttention(item.status)).length;
  const reconciledCount = (payload?.items ?? []).filter((item) => item.status === "complete").length;
  const upcomingCount = (payload?.items ?? []).filter((item) => item.status === "upcoming").length;

  return (
    <article className="card" data-compliance-calendar style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">COMPLIANCE CALENDAR</div>
          <h2>What is due, what is proven, what still needs evidence.</h2>
          <p>
            BIR withholding and mandatory contribution deadlines are shown beside the remittance evidence PayrollPH actually holds.
          </p>
        </div>
        <button className="secondary-button" type="button" disabled={loading} onClick={() => void reload()}>
          <RefreshCw size={14} /> {loading ? "Checking…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <div className="card-body" style={{ paddingTop: 0 }}>
          <div className="notice notice-red" style={{ margin: 0 }}>
            <AlertTriangle size={15} />
            <span><strong>Calendar unavailable.</strong> {error}</span>
            {complianceReadStateUiEnabled && (
              <span role="status" style={{ display: "block", overflowWrap: "anywhere" }}>
                Filing and remittance statuses are hidden until the complete employer-specific calendar and rule-watch sources are verified. No all-clear is implied.
              </span>
            )}
            <button type="button" className="secondary-button" onClick={() => void reload()}>Retry calendar</button>
          </div>
        </div>
      ) : payload ? (
        <div className="card-body" style={{ paddingTop: 0, display: "grid", gap: 14 }}>
          <div className="run-stats" style={{ margin: 0 }}>
            <div>
              <span>Needs attention</span>
              <strong className={attentionCount ? "red-number" : "green-number"}>{attentionCount}</strong>
              <small>due soon, overdue, unverified or blocked</small>
            </div>
            <div>
              <span>Reconciled</span>
              <strong className="green-number">{reconciledCount}</strong>
              <small>payment and employee posting proven</small>
            </div>
            <div>
              <span>Upcoming</span>
              <strong>{upcomingCount}</strong>
              <small>prepare before the nominal due date</small>
            </div>
            <div>
              <span>Payroll months</span>
              <strong>{payload.applicableMonths.length}</strong>
              <small>most recent periods on record</small>
            </div>
          </div>

          <div className="notice notice-blue" style={{ margin: 0 }}>
            <CalendarDays size={15} />
            <span>{payload.note}</span>
          </div>

          {payload.ruleWatch && payload.ruleWatch.length > 0 && (
            <section className="leave-request" data-rule-watch style={{ display: "grid", gap: 8 }}>
              <div>
                <div className="card-kicker">STATUTORY RULE WATCH</div>
                <strong>Are the rates payroll uses still the current law?</strong>
              </div>
              {payload.ruleWatch.filter((item) => item.status !== "current").map((item) => (
                <div
                  key={`${item.family}-${item.label}-${item.sourceDocument ?? ""}`}
                  className={RULE_WATCH_URGENT.has(item.status) ? "notice notice-amber" : "notice"}
                  style={{ margin: 0 }}
                >
                  <CircleAlert size={14} />
                  <span>
                    <strong>{item.label}</strong>
                    {RULE_WATCH_LABEL[item.status]}{item.currentVersion ? ` · ${item.currentVersion}` : ""}. {item.detail}
                  </span>
                </div>
              ))}
              {payload.ruleWatch.every((item) => item.status === "current") && (
                <div className="notice notice-green" style={{ margin: 0 }}>
                  <CheckCircle2 size={14} />
                  <span>All statutory rule packs are verified and current.</span>
                </div>
              )}
            </section>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className={attentionOnly ? "primary-button brand" : "secondary-button"}
              onClick={() => setAttentionOnly(true)}
            >
              Attention ({attentionCount})
            </button>
            <button
              type="button"
              className={!attentionOnly ? "primary-button brand" : "secondary-button"}
              onClick={() => setAttentionOnly(false)}
            >
              All obligations ({payload.items.length})
            </button>
          </div>

          <div role="group" aria-label="Compliance deadline planner" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
            <label className="id" style={{ display: "grid", gap: 4 }}>
              Agency
              <select aria-label="Filter compliance obligations by agency" value={agencyFilter}
                onChange={(event) => setAgencyFilter(event.target.value as ComplianceAgencyFilter)}>
                <option value="all">All agencies ({agencyCounts.all})</option>
                <option value="BIR">BIR ({agencyCounts.BIR})</option>
                <option value="SSS">SSS ({agencyCounts.SSS})</option>
                <option value="PhilHealth">PhilHealth ({agencyCounts.PhilHealth})</option>
                <option value="Pag-IBIG">Pag-IBIG ({agencyCounts["Pag-IBIG"]})</option>
              </select>
            </label>
            <label className="id" style={{ display: "grid", gap: 4 }}>
              Deadline order
              <select aria-label="Sort compliance obligations by deadline" value={dateSort}
                onChange={(event) => setDateSort(event.target.value as ComplianceDateSort)}>
                <option value="earliest">Earliest known deadline</option>
                <option value="latest">Latest known deadline</option>
                <option value="source">Original source order</option>
              </select>
            </label>
            <span className="id" role="status" style={{ alignSelf: "end" }}>
              Showing {items.length} of {payload.items.length} verified obligations.
              {agencyCounts.unresolved > 0
                ? ` ${agencyCounts.unresolved} unresolved date(s) across all agencies are not estimated and sort last.`
                : " All displayed due dates come from verified sources."}
              View controls never file, reconcile or mark an obligation complete.
            </span>
          </div>

          {items.length === 0 ? (
            <div className="notice" style={{ margin: 0 }}>
              <CircleAlert size={15} />
              <span><strong>No obligations match the selected filters.</strong> Choose another agency or status view.
                This does not certify filing or remittance completion.</span>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {items.map((item) => (
                <section className="leave-request" key={item.id} style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <div className="card-kicker">{item.agency} · {item.applicableMonth}</div>
                      <strong>{item.obligation}</strong>
                      <p style={{ margin: "4px 0 0" }}>
                        {prettyDate(item.dueDate)}
                        {item.exactness === "conservative-target" ? " · conservative internal target" : " · nominal statutory date"}
                      </p>
                    </div>
                    <Status value={statusLabel(item.status)} />
                  </div>

                  <div className={item.status === "complete" ? "notice notice-green" : needsComplianceAttention(item.status) ? "notice notice-amber" : "notice"} style={{ margin: 0 }}>
                    {item.status === "complete" ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
                    <span>{item.detail}</span>
                  </div>

                  <a
                    className="link-button"
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ width: "fit-content" }}
                  >
                    {item.sourceLabel} <ExternalLink size={12} />
                  </a>
                </section>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="card-body" style={{ paddingTop: 0 }}>
          <p style={{ color: "var(--muted)", fontSize: 12 }}>Loading compliance obligations…</p>
        </div>
      )}
    </article>
  );
}
