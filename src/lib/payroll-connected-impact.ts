/**
 * Payroll-first, read-only reconciliation of upstream HRIS/WFM/HCM evidence.
 * This module MUST NOT change a payroll run, pay profile, bank destination,
 * attendance event, compensation decision, or approval.
 *
 * The server owns tenant, legal-entity and org-unit scoping. Findings are
 * advisory until separately reviewed financial-release gates are integrated.
 */
export type ConnectedImpactArea = "HRIS" | "WFM" | "HCM";
export type ConnectedImpactSeverity = "attention" | "review";
export type ConnectedImpactAction = "People" | "Time & attendance" | "Compensation";

export type DatedImpactSource = {
  id: number;
  employeeId: number;
  status: string;
  effectiveDate: string;
  appliedAfterRunCreated?: boolean;
};
export type PayoutImpactSource = {
  id: number;
  employeeId: number;
  status: string;
  appliedAt?: string | Date | null;
  appliedAfterRunCreated?: boolean;
};
export type WorkImpactSource = {
  id: number;
  employeeId: number;
  status: string;
  workDate: string;
  severity?: string | null;
  appliedAt?: string | Date | null;
  appliedAfterRunCreated?: boolean;
};
export type TimesheetImpactSource = {
  id: number;
  employeeId: number;
  periodStart: string;
  periodEnd: string;
  version: number;
  status: string;
};

export type AppliedPayRevision = {
  id: number;
  employeeId: number;
  effectiveDate: string;
  // Existence of a matching, applied and explicitly approved proposal is
  // source-link evidence only. It does not independently certify the pay.
  compensationProposalId?: number | null;
  createdAfterRunCreated?: boolean;
};

export type ConnectedImpactFinding = {
  area: ConnectedImpactArea;
  severity: ConnectedImpactSeverity;
  code: string;
  employeeId: number;
  sourceId: number;
  date: string | null;
  status: string;
  title: string;
  detail: string;
  action: ConnectedImpactAction;
};

export type ConnectedImpactInput = {
  periodStart: string;
  periodEnd: string;
  employmentChanges?: DatedImpactSource[];
  payoutChanges?: PayoutImpactSource[];
  attendanceCorrections?: WorkImpactSource[];
  attendanceExceptions?: WorkImpactSource[];
  timesheets?: TimesheetImpactSource[];
  compensationProposals?: DatedImpactSource[];
  payRevisions?: AppliedPayRevision[];
  truncatedSources?: string[];
};

export type ConnectedImpactReport = {
  periodStart: string;
  periodEnd: string;
  summary: { HRIS: number; WFM: number; HCM: number };
  total: number;
  attention: number;
  review: number;
  incomplete: boolean;
  truncatedSources: string[];
  findings: ConnectedImpactFinding[];
  advisoryOnly: true;
};

const TERMINAL = new Set(["applied", "cancelled", "canceled", "rejected", "declined", "voided", "superseded"]);
const MAX_VISIBLE = 60;

function status(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}
function validDate(value: string): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function stillOpen(value: string): boolean {
  return !TERMINAL.has(status(value));
}
function add(items: ConnectedImpactFinding[], value: ConnectedImpactFinding) {
  if (!Number.isSafeInteger(value.employeeId) || value.employeeId <= 0
    || !Number.isSafeInteger(value.sourceId) || value.sourceId <= 0) return;
  items.push(value);
}

/**
 * Makes a scoped, non-financial review of a specific cutoff.
 * Amounts, TINs, bank coordinates and internal payloads are deliberately
 * absent. A zero-count result is NOT a payroll-release authorization.
 */
export function buildPayrollConnectedImpact(input: ConnectedImpactInput): ConnectedImpactReport {
  if (!validDate(input.periodStart) || !validDate(input.periodEnd) || input.periodStart > input.periodEnd) {
    throw new Error("A valid payroll cutoff is required.");
  }
  const findings: ConnectedImpactFinding[] = [];

  for (const row of input.employmentChanges ?? []) {
    if (!validDate(row.effectiveDate) || row.effectiveDate > input.periodEnd) continue;
    if (status(row.status) === "applied" && row.appliedAfterRunCreated) {
      add(findings, {
        area: "HRIS", severity: "attention", code: "HRIS_LATE_EMPLOYMENT_CHANGE",
        employeeId: row.employeeId, sourceId: row.id, date: row.effectiveDate,
        status: "applied", title: "Employment change applied after payroll was opened",
        detail: "An effective-dated worker change was applied after this payroll run was created. Revalidate employee eligibility, costing, attendance and the current payroll input snapshot before approval.",
        action: "People",
      });
      continue;
    }
    if (!stillOpen(row.status)) continue;
    add(findings, {
      area: "HRIS", severity: "attention", code: "HRIS_CHANGE_NOT_APPLIED",
      employeeId: row.employeeId, sourceId: row.id, date: row.effectiveDate,
      status: status(row.status), title: "Employment change still open",
      detail: "A pending, scheduled or failed employment change is effective on or before this cutoff. Review the authorized worker record before relying on its payroll inputs.",
      action: "People",
    });
  }

  for (const row of input.payoutChanges ?? []) {
    const decision = status(row.status);
    // A decision without an applied timestamp (or a pending request with an
    // applied timestamp) is inconsistent evidence and must remain visible.
    const dismissed = ["cancelled", "canceled", "rejected", "declined", "voided", "superseded"].includes(decision)
      && !row.appliedAt;
    const applied = ["approved", "applied"].includes(decision) && !!row.appliedAt;
    if (applied && row.appliedAfterRunCreated) {
      add(findings, {
        area: "HRIS", severity: "attention", code: "HRIS_LATE_PAYOUT_CHANGE",
        employeeId: row.employeeId, sourceId: row.id, date: null,
        status: decision, title: "Payout destination updated after payroll was opened",
        detail: "A governed payout destination change was applied after run creation. Recheck any prior bank export or payout preflight and its immutable payee snapshot before submitting funds.",
        action: "People",
      });
      continue;
    }
    if (dismissed || applied) continue;
    add(findings, {
      area: "HRIS", severity: "attention", code: "HRIS_PAYOUT_REVIEW",
      employeeId: row.employeeId, sourceId: row.id, date: null,
      status: status(row.status), title: "Payout destination review outstanding",
      detail: "A requested payout change has not been confirmed as applied. Follow the existing independently governed payout workflow before any bank export or transfer.",
      action: "People",
    });
  }

  for (const row of input.attendanceCorrections ?? []) {
    if (!validDate(row.workDate) || row.workDate < input.periodStart || row.workDate > input.periodEnd) continue;
    const decision = status(row.status);
    const dismissed = ["rejected", "cancelled", "canceled", "voided", "superseded"].includes(decision)
      && !row.appliedAt;
    const applied = ["approved", "applied"].includes(decision) && !!row.appliedAt;
    if (applied && row.appliedAfterRunCreated) {
      add(findings, {
        area: "WFM", severity: "attention", code: "WFM_LATE_ATTENDANCE_CORRECTION",
        employeeId: row.employeeId, sourceId: row.id, date: row.workDate,
        status: decision, title: "Attendance corrected after payroll was opened",
        detail: "A correction for this cutoff was applied after the payroll run was created. Verify the timesheet was marked stale where required, recalculate affected pay, and require fresh checker approval.",
        action: "Time & attendance",
      });
      continue;
    }
    if (dismissed || applied) continue;
    add(findings, {
      area: "WFM", severity: "attention", code: "WFM_CORRECTION_NOT_APPLIED",
      employeeId: row.employeeId, sourceId: row.id, date: row.workDate,
      status: status(row.status), title: "Attendance correction awaits resolution",
      detail: "An attendance correction within this cutoff is not yet applied. Verify independent approval and the resulting timesheet/payroll snapshot.",
      action: "Time & attendance",
    });
  }

  for (const row of input.attendanceExceptions ?? []) {
    if (!validDate(row.workDate) || row.workDate < input.periodStart || row.workDate > input.periodEnd
      || status(row.status) !== "open") continue;
    add(findings, {
      area: "WFM", severity: status(row.severity ?? "") === "info" ? "review" : "attention",
      code: "WFM_ATTENDANCE_EXCEPTION",
      employeeId: row.employeeId, sourceId: row.id, date: row.workDate,
      status: status(row.status), title: "Attendance exception remains open",
      detail: "An attendance exception for this cutoff has not been resolved. Check the source time evidence and payroll premium/exception trace.",
      action: "Time & attendance",
    });
  }

  // The existing configured Timesheet Payroll Gate remains authoritative.
  // Surface only the most recent version per employee/period; a superseded
  // submission must not hide a newer stale or unapproved version.
  const latestTimesheet = new Map<number, TimesheetImpactSource>();
  for (const row of input.timesheets ?? []) {
    if (row.periodStart !== input.periodStart || row.periodEnd !== input.periodEnd) continue;
    if (!Number.isSafeInteger(row.version) || row.version <= 0) continue;
    const previous = latestTimesheet.get(row.employeeId);
    if (!previous || row.version > previous.version || (row.version === previous.version && row.id > previous.id)) {
      latestTimesheet.set(row.employeeId, row);
    }
  }
  for (const row of latestTimesheet.values()) {
    if (status(row.status) === "approved") continue;
    add(findings, {
      area: "WFM", severity: "attention", code: "WFM_TIMESHEET_NOT_APPROVED",
      employeeId: row.employeeId, sourceId: row.id, date: row.periodEnd,
      status: status(row.status), title: "Latest timesheet is not approved",
      detail: "The latest submitted timesheet version for this cutoff is not approved. Resolve or resubmit it through the existing maker-checker timesheet workflow before relying on its payroll snapshot.",
      action: "Time & attendance",
    });
  }

  for (const row of input.compensationProposals ?? []) {
    if (!stillOpen(row.status) || !validDate(row.effectiveDate) || row.effectiveDate > input.periodEnd) continue;
    add(findings, {
      area: "HCM", severity: "attention", code: "HCM_COMP_NOT_APPLIED",
      employeeId: row.employeeId, sourceId: row.id, date: row.effectiveDate,
      status: status(row.status), title: "Compensation decision not applied",
      detail: "A compensation proposal with an effective date on or before this cutoff is not finalized. Follow the existing finance/owner approval and effective-dated pay revision flow; do not edit salary directly.",
      action: "Compensation",
    });
  }

  for (const row of input.payRevisions ?? []) {
    if (!validDate(row.effectiveDate) || row.effectiveDate > input.periodEnd) continue;
    const withinCutoff = row.effectiveDate >= input.periodStart;
    const changedAfterRun = row.createdAfterRunCreated === true;
    // A newly introduced backdated revision may alter payroll for the entire
    // cutoff even when its legal effective date precedes the cutoff start.
    if (!withinCutoff && !changedAfterRun) continue;
    add(findings, {
      area: "HCM", severity: changedAfterRun ? "attention" : "review",
      code: changedAfterRun
        ? "HCM_LATE_EFFECTIVE_PAY_REVISION"
        : row.compensationProposalId != null ? "HCM_LINKED_PAY_REVISION" : "HCM_PAY_REVISION_SOURCE_REVIEW",
      employeeId: row.employeeId, sourceId: row.id, date: row.effectiveDate,
      status: changedAfterRun ? "changed-after-run-created" : row.compensationProposalId != null ? "proposal-linked" : "recorded",
      title: changedAfterRun
        ? "Effective-dated pay revision recorded after payroll was opened"
        : row.compensationProposalId != null ? "Approved proposal-linked pay revision" : "Pay revision source requires review",
      detail: changedAfterRun
        ? "A new salary/pay-rate revision effective on or before this cutoff end was recorded after the payroll run was created. Verify the authorized source, retroactive impact, recalculation and a fresh checker approval; never rewrite released payroll."
        : row.compensationProposalId != null
          ? "This rate change is linked to an applied compensation proposal and effective date. Confirm the independent approval, accurate rate segmentation and payroll snapshot before release."
          : "A pay revision inside this cutoff has no matching applied and approved compensation proposal in the available evidence. Confirm the authorized HR/payroll source and effective-date calculation; legacy authorized revisions may be valid.",
      action: "Compensation",
    });
  }

  const rank = (v: ConnectedImpactFinding) => v.severity === "attention" ? 0 : 1;
  const areaRank = (v: ConnectedImpactFinding) => v.area === "HRIS" ? 0 : v.area === "WFM" ? 1 : 2;
  findings.sort((a, b) => rank(a) - rank(b) || areaRank(a) - areaRank(b)
    || (a.date ?? "").localeCompare(b.date ?? "") || a.employeeId - b.employeeId || a.sourceId - b.sourceId);

  const summary = { HRIS: 0, WFM: 0, HCM: 0 };
  for (const finding of findings) summary[finding.area] += 1;
  const truncatedSources = [...new Set(input.truncatedSources ?? [])];
  return {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    summary,
    total: findings.length,
    attention: findings.filter((finding) => finding.severity === "attention").length,
    review: findings.filter((finding) => finding.severity === "review").length,
    incomplete: truncatedSources.length > 0,
    truncatedSources,
    findings: findings.slice(0, MAX_VISIBLE),
    advisoryOnly: true,
  };
}
