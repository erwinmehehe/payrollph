"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { Status } from "@/components/workspace/ui";

type CalendarStatus =
  | "complete"
  | "upcoming"
  | "due-soon"
  | "overdue"
  | "posting-pending"
  | "exception"
  | "verification-required"
  | "configuration-required";

type CalendarItem = {
  id: string;
  agency: "BIR" | "SSS" | "PhilHealth" | "Pag-IBIG";
  obligation: string;
  applicableMonth: string;
  dueDate: string | null;
  status: CalendarStatus;
  detail: string;
  sourceLabel: string;
  sourceUrl: string;
  exactness: "nominal" | "conservative-target";
};

type Payload = {
  today: string;
  applicableMonths: string[];
  items: CalendarItem[];
  note: string;
};

const urgent = new Set<CalendarStatus>([
  "overdue",
  "exception",
  "verification-required",
  "configuration-required",
  "posting-pending",
  "due-soon",
]);

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
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/compliance/calendar?organizationId=${organizationId}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "Compliance calendar could not be loaded.");
        return;
      }
      setPayload(body);
    } catch {
      setError("Compliance calendar could not be loaded because the server could not be reached.");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  const items = useMemo(
    () => (payload?.items ?? []).filter((item) => !attentionOnly || urgent.has(item.status)),
    [payload, attentionOnly],
  );
  const attentionCount = (payload?.items ?? []).filter((item) => urgent.has(item.status)).length;
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
        <button className="secondary-button" type="button" disabled={loading} onClick={() => void load()}>
          <RefreshCw size={14} /> {loading ? "Checking…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <div className="card-body" style={{ paddingTop: 0 }}>
          <div className="notice notice-red" style={{ margin: 0 }}>
            <AlertTriangle size={15} />
            <span><strong>Calendar unavailable.</strong> {error}</span>
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

          {items.length === 0 ? (
            <div className="notice notice-green" style={{ margin: 0 }}>
              <CheckCircle2 size={15} />
              <span><strong>No calendar items need attention.</strong> Open all obligations to review upcoming and reconciled dates.</span>
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

                  <div className={item.status === "complete" ? "notice notice-green" : urgent.has(item.status) ? "notice notice-amber" : "notice"} style={{ margin: 0 }}>
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
