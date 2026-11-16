/**
 * Independent, strictly default-OFF pilot flag inventory for the three
 * protected Philippine workplace modules.
 *
 * This does NOT grant deployment authority. The original globally source-
 * sealed registry remains unchanged, preserving existing test evidence.
 * New pilot flags are enumerated, human-owned and verified by dedicated tests.
 */
export const PH_WORKPLACE_PILOT_FLAGS = {
  phDoleExtended: {
    env: "PH_DOLE_EXTENDED_REPORTS_ENABLED",
    owner: "Philippine Compliance Lead and DPO",
    risk: "DOLE outcome claims need external evidence and independent review",
    approval: "Approved 0139 schema receipt, tenant acceptance, official portal workflow verification and documented compliance signoff",
  },
  phOshRecords: {
    env: "PH_OSH_RECORDS_ENABLED",
    owner: "OSH Officer and DPO",
    risk: "Workplace incidents and worker training evidence are sensitive",
    approval: "Reviewed OSH policy, privacy controls, isolated tenancy, independent proof and safe operational UAT",
  },
  phProtectedCases: {
    env: "PH_PROTECTED_WORKPLACE_CASES_ENABLED",
    owner: "DPO, Independent CODI and Labor Counsel",
    risk: "Harassment allegations and reporter identity require strict confidential handling and procedural fairness",
    approval: "Independent CODI appointment, privacy impact, conflict-of-interest process, legal due process and security UAT",
  },
} as const;

export type WorkplacePilotFlag = keyof typeof PH_WORKPLACE_PILOT_FLAGS;

export function workplacePilotFlagEnabled(
  flag: WorkplacePilotFlag,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (!Object.hasOwn(PH_WORKPLACE_PILOT_FLAGS, flag)) {
    throw new Error("Unknown workplace release-critical feature flag.");
  }
  return env[PH_WORKPLACE_PILOT_FLAGS[flag].env] === "true";
}

export function workplacePilotFlagInventory() {
  return Object.entries(PH_WORKPLACE_PILOT_FLAGS).map(([key, value]) => ({
    key, ...value, defaultEnabled: false, releaseApproved: false,
  }));
}
