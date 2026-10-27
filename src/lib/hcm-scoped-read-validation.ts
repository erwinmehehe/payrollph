import type { MyTeamResponse } from "./hcm-my-team-contract";
import type { HcmOrgExplorerResponse, HcmPositionHistoryResponse } from "./hcm-org-explorer-contract";
import type { TeamLeaveMonthResponse } from "./hcm-team-leave-calendar-contract";

/** Runtime checks for untrusted HTTP JSON, before any employer-scoped data is rendered. */
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function id(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function text(value: unknown): value is string {
  return typeof value === "string";
}
function optionalText(value: unknown): value is string | null {
  return value === null || text(value);
}
function optionalId(value: unknown): value is number | null {
  return value === null || id(value);
}
function date(value: unknown): value is string {
  return text(value) && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value);
}
function observed(value: unknown): value is string {
  return text(value) && value.length > 0 && Number.isFinite(Date.parse(value));
}
function scope(value: unknown): boolean {
  return object(value) && (
    (value.kind === "company" && value.orgUnitId === null) ||
    (value.kind === "unit" && id(value.orgUnitId))
  );
}

export function validMyTeamResponse(
  value: unknown, organizationId: number, cursor: number, query: string, statusFilter: string,
): value is MyTeamResponse {
  if (!object(value) || value.organizationId !== organizationId ||
      value.query !== query || value.statusFilter !== statusFilter ||
      !scope(value.scope) || !observed(value.observedAt) || !text(value.warning) ||
      !Array.isArray(value.items) || value.items.length > 25 ||
      !object(value.summary) || !object(value.page) ||
      value.page.size !== 25 || typeof value.page.hasMore !== "boolean" ||
      // A continuation requires a full page and a real server-issued cursor.
      // A terminal page (including an empty one) must not advertise a cursor.
      (value.page.hasMore && (value.items.length !== 25 || !id(value.page.nextCursor))) ||
      (!value.page.hasMore && value.page.nextCursor !== null) ||
      value.summary.employeeRecordsThisPage !== value.items.length ||
      !count(value.summary.pendingLeaveRecordsThisPage) ||
      !count(value.summary.pendingOvertimeRecordsThisPage) ||
      !count(value.summary.pendingAttendanceCorrectionsThisPage) ||
      !count(value.summary.incompletePunchRecordsThisPage)) return false;

  const unique = new Set<number>();
  let previousId = cursor;
  let leave = 0, overtime = 0, corrections = 0, incomplete = 0;
  for (const item of value.items as unknown[]) {
    // Server keyset ordering is strictly ascending, not merely unique.
    if (!object(item) || !id(item.id) || item.id <= previousId || unique.has(item.id) ||
        !text(item.employeeNo) || !text(item.name) || !text(item.jobTitle) ||
        !text(item.employmentType) || !text(item.status) ||
        !optionalText(item.orgUnitName) ||
        !["verified", "not_recorded", "unverified"].includes(String(item.orgUnitIntegrity)) ||
        !count(item.pendingLeaveRecords) || !count(item.pendingOvertimeRecords) ||
        !count(item.pendingAttendanceCorrections) || !count(item.incompletePunchRecords)) return false;
    unique.add(item.id);
    previousId = item.id;
    leave += item.pendingLeaveRecords;
    overtime += item.pendingOvertimeRecords;
    corrections += item.pendingAttendanceCorrections;
    incomplete += item.incompletePunchRecords;
  }
  // A cursor ahead of the actual last displayed row would silently skip
  // records on the next request. Never accept it as a verified page.
  return (!value.page.hasMore || value.page.nextCursor === previousId) &&
    value.summary.pendingLeaveRecordsThisPage === leave &&
    value.summary.pendingOvertimeRecordsThisPage === overtime &&
    value.summary.pendingAttendanceCorrectionsThisPage === corrections &&
    value.summary.incompletePunchRecordsThisPage === incomplete;
}

export function validOrgExplorerResponse(value: unknown, organizationId: number): value is HcmOrgExplorerResponse {
  if (!object(value) || value.tenantId !== organizationId ||
      !observed(value.observedAt) || !date(value.currentBusinessDate) ||
      !Array.isArray(value.sources) || value.sources.length !== 3 ||
      value.sources[0] !== "org_units" || value.sources[1] !== "positions" ||
      value.sources[2] !== "job_profiles" ||
      !["ready", "needs_review"].includes(String(value.integrity)) ||
      !count(value.unlinkedPositionRecords) ||
      !Array.isArray(value.units) || !Array.isArray(value.positions)) return false;

  const unitIds = new Set<number>();
  for (const unit of value.units as unknown[]) {
    if (!object(unit) || !id(unit.id) || unitIds.has(unit.id) ||
        !optionalId(unit.parentId) || !text(unit.code) || !text(unit.name) ||
        !text(unit.type) || !count(unit.depth) || !count(unit.positionRecordCount) ||
        !["root", "linked", "missing_parent", "cycle"].includes(String(unit.relationship))) return false;
    unitIds.add(unit.id);
  }
  const positionIds = new Set<number>();
  for (const position of value.positions as unknown[]) {
    if (!object(position) || !id(position.id) || positionIds.has(position.id) ||
        !text(position.code) || !text(position.status) || !optionalText(position.jobTitle) ||
        !optionalId(position.orgUnitId) || !optionalId(position.supervisoryOrgUnitId) ||
        !optionalId(position.reportingUnitId) ||
        !["linked", "no_unit", "unit_not_in_snapshot"].includes(String(position.relationship))) return false;
    positionIds.add(position.id);
  }
  return true;
}

export function validPositionHistoryResponse(
  value: unknown, organizationId: number, positionId: number,
): value is HcmPositionHistoryResponse {
  if (!object(value) || value.tenantId !== organizationId || value.positionId !== positionId ||
      !observed(value.observedAt) || !object(value.position) ||
      value.position.source !== "positions" || value.position.id !== positionId ||
      !text(value.position.code) || !text(value.position.status) ||
      !optionalText(value.position.currentJobTitle) ||
      !object(value.history) || value.history.source !== "position_assignments" ||
      !object(value.history.preview) ||
      typeof value.history.preview.hasMore !== "boolean" ||
      typeof value.history.preview.partial !== "boolean" ||
      !Array.isArray(value.history.preview.items) || value.history.preview.items.length > 50) return false;
  const ids = new Set<number>();
  for (const item of value.history.preview.items as unknown[]) {
    if (!object(item) || !id(item.id) || ids.has(item.id) ||
        !optionalId(item.employeeId) || !text(item.assignmentType) ||
        !date(item.effectiveFrom) ||
        !(item.effectiveUntil === null || date(item.effectiveUntil))) return false;
    ids.add(item.id);
  }
  return true;
}

export function validTeamLeaveResponse(
  value: unknown, organizationId: number, month: string,
  expectedDates: { start: string; end: string },
): value is TeamLeaveMonthResponse {
  if (!object(value) || value.organizationId !== organizationId || value.month !== month ||
      !scope(value.scope) || !observed(value.observedAt) || !text(value.notice) ||
      !object(value.dates) || value.dates.start !== expectedDates.start ||
      value.dates.end !== expectedDates.end ||
      !Array.isArray(value.cases) || value.cases.length > 400 || !object(value.summary) ||
      !count(value.summary.approvedRequestRecords) || !count(value.summary.pendingRequestRecords)) return false;

  let approved = 0, pending = 0;
  const ids = new Set<number>();
  for (const item of value.cases as unknown[]) {
    if (!object(item) || !id(item.requestId) || ids.has(item.requestId) ||
        !id(item.employeeId) || !text(item.employeeNo) || !text(item.employeeName) ||
        !["Approved", "Pending"].includes(String(item.status)) ||
        !date(item.startDate) || !date(item.endDate) ||
        item.startDate > item.endDate || item.startDate > expectedDates.end ||
        item.endDate < expectedDates.start) return false;
    ids.add(item.requestId);
    if (item.status === "Approved") approved++; else pending++;
  }
  return value.summary.approvedRequestRecords === approved &&
    value.summary.pendingRequestRecords === pending;
}
