/**
 * Frozen source-of-truth guard for independently approved, effective-dated
 * worker moves. A scheduler must not overwrite a newer job, manager, employer
 * or employment status using an earlier approval snapshot.
 *
 * No database dependency: the exact same validator is used at scheduled
 * application and the failed-change retry endpoint.
 */
export type HcmEffectiveSourceState = {
  employee: Record<string, unknown>;
  assignment: Record<string, unknown> | null;
  position: Record<string, unknown> | null;
};

export type HcmEffectiveSourceDrift = {
  code: "HCM_EFFECTIVE_SOURCE_MISSING" | "HCM_EFFECTIVE_SOURCE_CHANGED";
  field: string;
  message: string;
};

const employeeFields = ["orgUnitId", "legalEntityId", "title", "employmentType", "status"] as const;
const assignmentFields = ["id", "positionId", "assignmentType", "fte", "effectiveFrom"] as const;
const positionFields = [
  "id", "code", "orgUnitId", "supervisoryOrgUnitId", "legalEntityId",
  "costCenterId", "managerEmployeeId", "employmentType",
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function comparable(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

/**
 * Returns the first material difference, or null when the source matches.
 * Fail closed for legacy/unparseable approvals: there is no evidence that
 * their source assumptions are still valid.
 */
export function effectiveHcmSourceDrift(
  approvedFromSnapshot: unknown,
  current: HcmEffectiveSourceState,
): HcmEffectiveSourceDrift | null {
  if (!isObject(approvedFromSnapshot)
    || !isObject(approvedFromSnapshot.employee)
    || !Object.hasOwn(approvedFromSnapshot, "assignment")
    || !Object.hasOwn(approvedFromSnapshot, "position")
    || !isObject(current.employee)
  ) {
    return {
      code: "HCM_EFFECTIVE_SOURCE_MISSING",
      field: "fromSnapshot",
      message: "This HCM approval has no complete original worker/assignment/position evidence. Cancel it and request a new independently reviewed change.",
    };
  }
  const stored: HcmEffectiveSourceState = {
    employee: approvedFromSnapshot.employee,
    assignment: isObject(approvedFromSnapshot.assignment) ? approvedFromSnapshot.assignment : null,
    position: isObject(approvedFromSnapshot.position) ? approvedFromSnapshot.position : null,
  };
  // null is legitimate; undefined/malformed is not. Both nullable structures
  // must be null or non-null together with the now-authoritative worker state.
  if ((approvedFromSnapshot.assignment !== null && !isObject(approvedFromSnapshot.assignment))
    || (approvedFromSnapshot.position !== null && !isObject(approvedFromSnapshot.position))
  ) {
    return {
      code: "HCM_EFFECTIVE_SOURCE_MISSING",
      field: "fromSnapshot.assignment/position",
      message: "The original HCM assignment/position evidence is malformed. Cancel and request a new approval.",
    };
  }

  const sections: Array<{
    name: string;
    from: Record<string, unknown> | null;
    now: Record<string, unknown> | null;
    fields: readonly string[];
  }> = [
    { name: "employee", from: stored.employee, now: current.employee, fields: employeeFields },
    { name: "assignment", from: stored.assignment, now: current.assignment, fields: assignmentFields },
    { name: "position", from: stored.position, now: current.position, fields: positionFields },
  ];

  for (const section of sections) {
    if ((section.from === null) !== (section.now === null)) {
      return {
        code: "HCM_EFFECTIVE_SOURCE_CHANGED",
        field: section.name,
        message: `The approved HCM source ${section.name} was replaced or removed. Reconcile and request new approval before applying this change.`,
      };
    }
    if (section.from === null || section.now === null) continue;
    for (const key of section.fields) {
      if (!Object.hasOwn(section.from, key)) {
        return {
          code: "HCM_EFFECTIVE_SOURCE_MISSING",
          field: `${section.name}.${key}`,
          message: `The approved HCM source snapshot is missing ${section.name}.${key}. Re-submit for independent approval.`,
        };
      }
      if (comparable(section.from[key]) !== comparable(section.now[key])) {
        return {
          code: "HCM_EFFECTIVE_SOURCE_CHANGED",
          field: `${section.name}.${key}`,
          message: `The worker's ${section.name}.${key} changed after HCM approval. The scheduled change cannot overwrite the newer state; cancel and resubmit it for independent review.`,
        };
      }
    }
  }
  return null;
}
