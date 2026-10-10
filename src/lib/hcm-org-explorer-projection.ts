/**
 * Privacy-minimized read model for the CURRENT organizational structure.
 * No historic job, manager, vacancy, FTE or headcount is inferred here.
 */
export type OrgExplorerUnitSource = {
  id: number;
  parentId: number | null;
  code: string;
  name: string;
  type: string;
};

export type OrgExplorerPositionSource = {
  id: number;
  code: string;
  status: string;
  jobTitle: string | null;
  orgUnitId: number | null;
  supervisoryOrgUnitId: number | null;
};

export type OrgExplorerUnit = OrgExplorerUnitSource & {
  depth: number;
  relationship: "root" | "linked" | "missing_parent" | "cycle";
  positionRecordCount: number;
};

export type OrgExplorerPosition = OrgExplorerPositionSource & {
  reportingUnitId: number | null;
  relationship: "linked" | "no_unit" | "unit_not_in_snapshot";
};

export type OrgExplorerProjection = {
  units: OrgExplorerUnit[];
  positions: OrgExplorerPosition[];
  integrity: "ready" | "needs_review";
  unlinkedPositionRecords: number;
};

export type PositionAssignmentSource = {
  id: number;
  employeeId: number | null;
  assignmentType: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
};

export type PositionHistoryPreview = {
  items: PositionAssignmentSource[];
  hasMore: boolean;
  partial: boolean;
};

function validId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/** Null or a positive source id; never trust negative IDs or duplicate source rows. */
export function projectOrgExplorer(
  units: readonly OrgExplorerUnitSource[],
  positions: readonly OrgExplorerPositionSource[],
): OrgExplorerProjection {
  const byId = new Map<number, OrgExplorerUnitSource>();
  for (const row of units) {
    if (!validId(row.id) || byId.has(row.id)) throw new Error("Invalid organization hierarchy");
    byId.set(row.id, row);
  }

  const counts = new Map<number, number>();
  const uniquePositions = new Set<number>();
  let unlinkedPositionRecords = 0;
  const mappedPositions: OrgExplorerPosition[] = positions.map((row) => {
    if (!validId(row.id) || uniquePositions.has(row.id)) throw new Error("Invalid position references");
    uniquePositions.add(row.id);
    const reportingUnitId = row.supervisoryOrgUnitId ?? row.orgUnitId;
    const relationship = reportingUnitId == null
      ? "no_unit"
      : byId.has(reportingUnitId) ? "linked" : "unit_not_in_snapshot";
    if (relationship === "linked" && reportingUnitId !== null) {
      counts.set(reportingUnitId, (counts.get(reportingUnitId) ?? 0) + 1);
    } else {
      unlinkedPositionRecords += 1;
    }
    return {
      id: row.id, code: row.code, status: row.status, jobTitle: row.jobTitle,
      // Do not return foreign or out-of-snapshot org IDs as usable links.
      orgUnitId: row.orgUnitId !== null && byId.has(row.orgUnitId) ? row.orgUnitId : null,
      supervisoryOrgUnitId: row.supervisoryOrgUnitId !== null && byId.has(row.supervisoryOrgUnitId)
        ? row.supervisoryOrgUnitId : null,
      reportingUnitId: relationship === "linked" ? reportingUnitId : null,
      relationship,
    };
  });

  const paths = new Map<number, string>();
  const mappedUnits: OrgExplorerUnit[] = units.map((row) => {
    const seen = new Set<number>();
    const ancestors: OrgExplorerUnitSource[] = [];
    let parent: number | null = row.id;
    let issue: "missing_parent" | "cycle" | null = null;

    while (parent !== null) {
      if (seen.has(parent)) { issue = "cycle"; break; }
      seen.add(parent);
      const current = byId.get(parent);
      if (!current) { issue = "missing_parent"; break; }
      ancestors.push(current);
      parent = current.parentId;
    }

    const path = issue ? [row] : ancestors.reverse();
    paths.set(row.id, path.map((unit) => unit.name.toLowerCase() + ":" + String(unit.id).padStart(12, "0")).join("/"));
    return {
      id: row.id, code: row.code, name: row.name, type: row.type,
      // A missing parent may belong to another employer. Preserve the
      // integrity warning without exposing an unverified source identifier.
      parentId: row.parentId !== null && byId.has(row.parentId) ? row.parentId : null,
      depth: issue ? 0 : path.length - 1,
      relationship: issue ?? (path.length === 1 ? "root" : "linked"),
      positionRecordCount: counts.get(row.id) ?? 0,
    };
  });

  mappedUnits.sort((a, b) => {
    const ai = a.relationship === "cycle" || a.relationship === "missing_parent" ? 1 : 0;
    const bi = b.relationship === "cycle" || b.relationship === "missing_parent" ? 1 : 0;
    return ai - bi || (paths.get(a.id) ?? "").localeCompare(paths.get(b.id) ?? "") || a.id - b.id;
  });
  mappedPositions.sort((a, b) => a.code.localeCompare(b.code) || a.id - b.id);

  return {
    units: mappedUnits,
    positions: mappedPositions,
    integrity: mappedUnits.some((unit) =>
      unit.relationship === "cycle" || unit.relationship === "missing_parent") ||
      unlinkedPositionRecords > 0 ? "needs_review" : "ready",
    unlinkedPositionRecords,
  };
}

/**
 * Caller must SQL-filter by tenant + position, sort newest first, and pass
 * at most limit+1 source rows. Do not claim completed vacancy or filled work.
 */
export function projectPositionHistory(
  rows: readonly PositionAssignmentSource[],
  limit = 50,
): PositionHistoryPreview {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid history preview limit");
  const ordered = [...rows].sort((a, b) =>
    b.effectiveFrom.localeCompare(a.effectiveFrom) || b.id - a.id);
  return {
    items: ordered.slice(0, limit).map((row) => ({
      id: row.id,
      employeeId: row.employeeId,
      assignmentType: row.assignmentType,
      effectiveFrom: row.effectiveFrom,
      effectiveUntil: row.effectiveUntil,
    })),
    hasMore: ordered.length > limit,
    partial: ordered.length > limit,
  };
}

/** Correct PH calendar date even during UTC / Manila midnight transitions. */
export function orgExplorerBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const find = (name: string) => parts.find((part) => part.type === name)?.value ?? "";
  return [find("year"), find("month"), find("day")].join("-");
}
