import { selectEffectiveWorksiteAssignment, type WorksiteAssignmentRecord } from "@/lib/workforce-worksite";

export type WorkArrangement = {
  id: number;
  employeeId: number;
  mode: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
};
export type WorksiteAuthorization = {
  id: number;
  employeeId: number;
  worksiteId: number;
  decision?: "allow" | "deny";
  effectiveFrom: string;
  effectiveUntil: string | null;
};
export type WorksiteFact = { id: number; active: boolean; siteType: string };
export type SiteEligibilityFinding = {
  code:
    | "SITE_EXPLICITLY_DENIED"
    | "SITE_NOT_AUTHORIZED"
    | "SITE_INACTIVE"
    | "WORK_ARRANGEMENT_SITE_MISMATCH"
    | "SITE_GOVERNANCE_UNCONFIGURED";
  severity: "warning" | "blocker";
  message: string;
  sourceId?: number;
  worksiteId?: number;
};

export type SiteEligibility = {
  eligible: boolean;
  status: "eligible" | "warning" | "ineligible";
  source: "primary" | "authorization" | "legacy" | "none";
  arrangement: string | null;
  findings: SiteEligibilityFinding[];
  blockers: string[];
  warnings: string[];
};

function active(row: { effectiveFrom: string; effectiveUntil?: string | null }, date: string) {
  return row.effectiveFrom <= date && (row.effectiveUntil == null || row.effectiveUntil >= date);
}
export function selectArrangement(rows: WorkArrangement[], employeeId: number, date: string) {
  return rows.filter((row) => row.employeeId === employeeId && active(row, date))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.id - a.id)[0] ?? null;
}

/** Primary assignment remains the HR source of truth; extra-site grants never change payroll location. */
export function evaluateSiteEligibility(input: {
  employeeId: number;
  date: string;
  worksiteId: number | null;
  sites: WorksiteFact[];
  primaryAssignments: (WorksiteAssignmentRecord & { employeeId: number })[];
  arrangements: WorkArrangement[];
  authorizations: WorksiteAuthorization[];
}): SiteEligibility {
  const findings: SiteEligibilityFinding[] = [];
  const addFinding = (
    code: SiteEligibilityFinding["code"],
    severity: SiteEligibilityFinding["severity"],
    message: string,
    sourceId?: number,
  ) => findings.push({
    code,
    severity,
    message,
    ...(sourceId == null ? {} : { sourceId }),
    ...(input.worksiteId == null ? {} : { worksiteId: input.worksiteId }),
  });
  const arrangement = selectArrangement(input.arrangements, input.employeeId, input.date);
  const site = input.sites.find((item) => item.id === input.worksiteId);
  const primaryRows = input.primaryAssignments.filter((row) => row.employeeId === input.employeeId);
  const permits = input.authorizations.filter((row) => row.employeeId === input.employeeId);
  const primary = selectEffectiveWorksiteAssignment(primaryRows, input.date);
  const denyEvidence = permits.find((row) =>
    row.worksiteId === input.worksiteId
    && row.decision === "deny"
    && active(row, input.date)
  );
  const explicitlyDenied = Boolean(denyEvidence);
  const authorized = permits.some((row) =>
    row.worksiteId === input.worksiteId
    && row.decision !== "deny"
    && active(row, input.date)
  );

  let source: SiteEligibility["source"] = "none";
  if (primary?.worksiteId === input.worksiteId) source = "primary";
  else if (authorized) source = "authorization";

  if (explicitlyDenied) {
    addFinding(
      "SITE_EXPLICITLY_DENIED",
      "blocker",
      "Worksite access is explicitly denied for this employee on this date.",
      denyEvidence?.id,
    );
  }
  if (!site || !site.active) {
    addFinding("SITE_INACTIVE", "blocker", "Target worksite is missing or inactive.");
  }
  if (arrangement?.mode === "remote" && site?.siteType !== "remote_hub") {
    addFinding("WORK_ARRANGEMENT_SITE_MISMATCH", "blocker", "Remote arrangement requires a remote-hub worksite.", arrangement.id);
  }
  if ((arrangement?.mode === "onsite" || arrangement?.mode === "field") && site?.siteType === "remote_hub") {
    addFinding("WORK_ARRANGEMENT_SITE_MISMATCH", "blocker", "Work arrangement does not authorize remote-hub work.", arrangement.id);
  }
  if (source === "none") {
    if (!primaryRows.length && !permits.length && !input.arrangements.some((r) => r.employeeId === input.employeeId)) {
      // Existing tenants cannot be retroactively blocked without onboarding.
      source = "legacy";
      addFinding(
        "SITE_GOVERNANCE_UNCONFIGURED",
        "warning",
        "Worksite eligibility is not yet governed for this worker; configure a primary worksite or authorization.",
      );
    } else {
      addFinding(
        "SITE_NOT_AUTHORIZED",
        "blocker",
        "No effective primary assignment or approved secondary-site authorization covers this date.",
      );
    }
  }

  const blockers = findings.filter((finding) => finding.severity === "blocker").map((finding) => finding.message);
  const warnings = findings.filter((finding) => finding.severity === "warning").map((finding) => finding.message);
  return {
    eligible: blockers.length === 0,
    status: blockers.length ? "ineligible" : warnings.length ? "warning" : "eligible",
    source,
    arrangement: arrangement?.mode ?? null,
    findings,
    blockers,
    warnings,
  };
}
