"use client";

import { useEffect, useState } from "react";
import { ArrowRight, RefreshCw, ShieldCheck } from "lucide-react";
import type { DashboardData } from "@/components/workspace/types";
import {
  projectHcmDecisions, projectPeopleFollowUps, projectOperationalCases,
  type HcmHomeItem,
} from "@/lib/hcm-people-home-projection";

type Slice = { status: "loading" | "ready" | "unavailable"; items: HcmHomeItem[]; partial: boolean };
const loading = (): Slice => ({ status: "loading", items: [], partial: false });

type BP = { myWork?: Parameters<typeof projectHcmDecisions>[1] };
type Ops = { rows?: Parameters<typeof projectPeopleFollowUps>[1]; filteredTotal?: number; pages?: number };
type Cases = { items?: Parameters<typeof projectOperationalCases>[1] };

function dateLabel(value: string | null, milestone: boolean) {
  if (!value) return "No source date";
  const parsed = milestone ? new Date(value + "T12:00:00+08:00") : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

export function HcmPeopleHome({ data, onPage, onOpenWorker }: {
  data: DashboardData;
  onPage: (page: string) => void;
  onOpenWorker: (id: number) => void;
}) {
  const orgId = data.selectedOrganization.id;
  const role = data.access?.role ?? "";
  const hrAccess = Boolean(data.access?.companyWide && ["owner", "admin", "bookkeeper", "hr"].includes(role));
  const [decisions, setDecisions] = useState<Slice>(loading);
  const [followUps, setFollowUps] = useState<Slice>(loading);
  const [cases, setCases] = useState<Slice>(loading);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    // Reset all sources on employer change; render is gated by sourceOrg below.
    const options = { cache: "no-store" as const, signal: controller.signal };
    const get = async (path: string) => {
      const response = await fetch(path, options);
      if (!response.ok) throw new Error("Source unavailable");
      return response.json();
    };
    setDecisions(loading());
    setFollowUps(loading());
    setCases(loading());
    void get("/api/hcm/business-processes/inbox?organizationId=" + orgId).then((payload: BP) => {
      if (!controller.signal.aborted) setDecisions({
        status: "ready", items: projectHcmDecisions(orgId, payload.myWork ?? []),
        partial: false,
      });
    }).catch(() => { if (!controller.signal.aborted) setDecisions({ status: "unavailable", items: [], partial: true }); });
    if (hrAccess) {
      void get("/api/hcm/people-operations-inbox?organizationId=" + orgId + "&page=1&pageSize=20").then((payload: Ops) => {
        if (!controller.signal.aborted) setFollowUps({
          status: "ready", items: projectPeopleFollowUps(orgId, payload.rows ?? []),
          partial: (payload.filteredTotal ?? 0) > (payload.rows?.length ?? 0),
        });
      }).catch(() => { if (!controller.signal.aborted) setFollowUps({ status: "unavailable", items: [], partial: true }); });
      void get("/api/hcm/work-items?organizationId=" + orgId + "&status=open").then((payload: Cases) => {
        if (!controller.signal.aborted) setCases({
          status: "ready", items: projectOperationalCases(orgId, payload.items ?? []),
          partial: (payload.items?.length ?? 0) >= 200,
        });
      }).catch(() => { if (!controller.signal.aborted) setCases({ status: "unavailable", items: [], partial: true }); });
    }
    return () => controller.abort();
  }, [orgId, hrAccess, revision]);

  function open(item: HcmHomeItem) {
    if (item.source === "operational_case") {
      window.location.assign("/hcm/work-items?organizationId=" + orgId);
    } else if (item.subjectEmployeeId && item.actionRoute === "People") {
      onOpenWorker(item.subjectEmployeeId);
    } else {
      onPage(item.actionRoute);
    }
  }

  function sourceCard(title: string, hint: string, slice: Slice, source: "decisions" | "followups" | "cases") {
    const sourceRoute = source === "cases" ? "WorkQueue" : "People";
    return <section className="card" aria-label={title} style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div><div className="card-kicker">READ-ONLY · SOURCE-LINKED</div><h2>{title}</h2><p>{hint}</p></div>
        <span aria-live="polite" style={{ fontWeight: 700 }}>
          {slice.status === "ready" ? (slice.partial ? "Showing a limited preview" : slice.items.length + " visible") : slice.status}
        </span>
      </div>
      <div className="card-body">
        {slice.status === "loading" && <p role="status">Loading authorized items…</p>}
        {slice.status === "unavailable" && <p role="alert">Source unavailable. Work status is unknown; this is not an all-clear.</p>}
        {slice.status === "ready" && slice.items.length === 0 && <p>No matching items in the current source view.</p>}
        {slice.status === "ready" && slice.items.slice(0, 10).map(item => <div key={item.source + item.sourceId} className="approval-content" style={{ padding: "12px 0", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
          <div style={{ flex: 1 }}>
            <strong>{item.label}</strong>
            <p style={{ fontSize: 12 }}>{item.status.replaceAll("_", " ")} · {dateLabel(item.dueAt ?? item.sourceDate, Boolean(item.sourceDate))}{item.sourceDate ? " · Source milestone, not SLA" : ""}{item.incompleteEvidence ? " · Verify source" : ""}</p>
          </div>
          <button type="button" className="secondary-button" onClick={() => open(item)}>Open source <ArrowRight size={13} /></button>
        </div>)}
        {slice.status === "ready" && (slice.partial || slice.items.length > 10) && <p style={{ fontSize: 12 }}>Preview only. Open the source for complete, authorized results.</p>}
        {slice.status === "ready" && <button type="button" className="secondary-button" onClick={() => source === "cases" ? window.location.assign("/hcm/work-items?organizationId=" + orgId) : onPage(sourceRoute)}>Open full source</button>}
      </div>
    </section>;
  }

  return <div>
    <div className="page-heading" style={{ marginBottom: 22 }}>
      <div className="card-kicker">HCM · PEOPLE HOME</div>
      <h1>People Home</h1>
      <p>{data.selectedOrganization.name} · Your existing HR and employee workflows in one place. No payroll or employee records can be changed here.</p>
      <button type="button" className="secondary-button" onClick={() => setRevision(v => v + 1)}><RefreshCw size={14} /> Refresh sources</button>
    </div>
    <div className="notice notice-green" style={{ marginBottom: 20 }}><ShieldCheck size={16} /> Only authorized work is shown. Source approvals and maker-checker rules still apply.</div>
    {sourceCard("My HCM decisions", "Assigned business process approvals, reviews and to-dos. Open the People workspace to decide.", decisions, "decisions")}
    {hrAccess && sourceCard("People Ops follow-ups", "Company-wide source checks and follow-ups are not assigned approvals.", followUps, "followups")}
    {hrAccess && sourceCard("Operational cases", "Open cases and SLA ownership; resolution remains in the case workflow.", cases, "cases")}
    {!hrAccess && <p className="notice notice-amber">Company-wide HR follow-ups and operational case details are restricted to authorized People administrators.</p>}
  </div>;
}
