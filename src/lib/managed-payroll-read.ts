/** Verified, employer-scoped client read of managed payroll. No client validation grants server permissions. */
export type ManagedGate = {
  id: number;
  engagementId: number;
  gateKey: string;
  label: string;
  status: string;
  evidenceRef: string | null;
  completedBy: string | null;
  completedAt: string | null;
};
export type ManagedRun = {
  id: number;
  organizationId: number;
  periodLabel: string;
  status: string;
  payDate: string;
  employeeCount: number;
  grossPay: string;
  netPay: string;
  clientApproval: null | { approvedBy: string; approvedAt: string; valid: boolean };
};
export type ManagedPayload = {
  organizationId: number;
  viewerUserId: number;
  engagement: null | {
    id: number;
    organizationId: number;
    status: string;
    serviceTier: string;
    slaHours: number;
    targetGoLive: string | null;
    clientApproverUserId: number;
  };
  gates: ManagedGate[];
  runs: ManagedRun[];
  designatedApprover: null | { id: number; name: string; email: string };
  currentUserIsApprover: boolean;
};
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const nullable = (v: unknown) => v === null || typeof v === "string";
const timestamp = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
const money = (v: unknown) =>
  typeof v === "string" && /^-?\d+(?:\.\d{1,4})?$/.test(v) && Number.isFinite(Number(v));

function validGate(v: unknown, engagementId: number): v is ManagedGate {
  return record(v) && id(v.id) && v.engagementId === engagementId &&
    text(v.gateKey) && text(v.label) && ["pending", "verified"].includes(String(v.status)) &&
    nullable(v.evidenceRef) && nullable(v.completedBy) &&
    (v.completedAt === null || timestamp(v.completedAt)) &&
    (v.status !== "verified" || (text(v.evidenceRef) && text(v.completedBy) && timestamp(v.completedAt)));
}
function validRun(v: unknown, organizationId: number): v is ManagedRun {
  return record(v) && id(v.id) && v.organizationId === organizationId &&
    text(v.periodLabel) && text(v.status) && text(v.payDate) &&
    count(v.employeeCount) && money(v.grossPay) && money(v.netPay) &&
    (v.clientApproval === null || (record(v.clientApproval) &&
      text(v.clientApproval.approvedBy) && timestamp(v.clientApproval.approvedAt) &&
      typeof v.clientApproval.valid === "boolean"));
}

/** Reject a 200 carrying missing evidence, a foreign employer, or stale viewer permissions. */
export function parseManagedPayrollRead(
  value: unknown,
  expected: { organizationId: number; viewerUserId: number | null },
): ManagedPayload | null {
  if (!id(expected.organizationId) || !id(expected.viewerUserId) ||
      !record(value) || value.organizationId !== expected.organizationId ||
      value.viewerUserId !== expected.viewerUserId ||
      !Array.isArray(value.gates) || value.gates.length > 50 ||
      !Array.isArray(value.runs) || value.runs.length > 12 ||
      typeof value.currentUserIsApprover !== "boolean") return null;
  if (value.engagement === null) {
    return value.gates.length === 0 && value.runs.length === 0 &&
      value.designatedApprover === null && value.currentUserIsApprover === false
      ? value as ManagedPayload : null;
  }
  const e = value.engagement;
  if (!record(e) || !id(e.id) || e.organizationId !== expected.organizationId ||
      !["pilot", "live", "paused"].includes(String(e.status)) ||
      !text(e.serviceTier) || !id(e.clientApproverUserId) ||
      !count(e.slaHours) || e.slaHours < 4 || e.slaHours > 168 ||
      !(e.targetGoLive === null || (text(e.targetGoLive) && /^\d{4}-\d{2}-\d{2}$/.test(e.targetGoLive))) ||
      !value.gates.every((g: unknown) => validGate(g, e.id)) ||
      !value.runs.every((r: unknown) => validRun(r, expected.organizationId))) return null;
  const gates: ManagedGate[] = value.gates;
  const runs: ManagedRun[] = value.runs;
  if (new Set(gates.map((g) => g.id)).size !== gates.length ||
      new Set(gates.map((g) => g.gateKey)).size !== gates.length ||
      new Set(runs.map((r) => r.id)).size !== runs.length ||
      value.currentUserIsApprover !== (e.clientApproverUserId === expected.viewerUserId)) return null;
  const approver = value.designatedApprover;
  if (approver !== null && (!record(approver) || approver.id !== e.clientApproverUserId ||
      !text(approver.name) || !text(approver.email))) return null;
  return value as ManagedPayload;
}
