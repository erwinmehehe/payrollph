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
export type SiteEligibility = {
  eligible: boolean;
  status: "eligible" | "warning" | "ineligible";
  source: "primary" | "authorization" | "legacy" | "none";
  arrangement: string | null;
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
  const blockers: string[] = [];
  const warnings: string[] = [];
  const arrangement = selectArrangement(input.arrangements, input.employeeId, input.date);
  const site = input.sites.find((item) => item.id === input.worksiteId);
  const primaryRows = input.primaryAssignments.filter((row) => row.employeeId === input.employeeId);
  const permits = input.authorizations.filter((row) => row.employeeId === input.employeeId);
  const primary = selectEffectiveWorksiteAssignment(primaryRows, input.date);
  const explicitlyDenied = permits.some((row) =>
    row.worksiteId === input.worksiteId
    && row.decision === "deny"
    && active(row, input.date)
  );
  const authorized = permits.some((row) =>
    row.worksiteId === input.worksiteId
    && row.decision !== "deny"
    && active(row, input.date)
  );

  let source: SiteEligibility["source"] = "none";
  if (primary?.worksiteId === input.worksiteId) source = "primary";
  else if (authorized) source = "authorization";

  if (explicitlyDenied) blockers.push("Worksite access is explicitly denied for this employee on this date.");
  if (!site || !site.active) blockers.push("Target worksite is missing or inactive.");
  if (arrangement?.mode === "remote" && site?.siteType !== "remote_hub") {
    blockers.push("Remote arrangement requires a remote-hub worksite.");
  }
  if ((arrangement?.mode === "onsite" || arrangement?.mode === "field") && site?.siteType === "remote_hub") {
    blockers.push("Work arrangement does not authorize remote-hub work.");
  }
  if (source === "none") {
    if (!primaryRows.length && !permits.length && !input.arrangements.some((r) => r.employeeId === input.employeeId)) {
      // Existing tenants cannot be retroactively blocked without onboarding.
      source = "legacy";
      warnings.push("Worksite eligibility is not yet governed for this worker; configure a primary worksite or authorization.");
    } else {
      blockers.push("No effective primary assignment or approved secondary-site authorization covers this date.");
    }
  }

  return {
    eligible: blockers.length === 0,
    status: blockers.length ? "ineligible" : warnings.length ? "warning" : "eligible",
    source,
    arrangement: arrangement?.mode ?? null,
    blockers,
    warnings,
  };
}
