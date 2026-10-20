/** Read-only UI contract for a selected employer's remittance correction requests.
 * A 200 response is not permission to approve, nor proof that no requests exist.
 */
export type RemittanceCorrectionBatch = {
  id: number; organizationId: number; legalEntityId: number;
  agency: string; applicableMonth: string; status: string; expectedTotal: string;
  amountPaid: string | null; paymentReference: string | null;
  agencyReceiptReference: string | null; paymentChannel: string | null;
  paymentVarianceNote: string | null; paidAt: string | null;
};
export type RemittanceCorrectionMember = {
  id: number; organizationId: number; legalEntityId: number; batchId: number;
  employeeNo: string; totalContribution: string; postingStatus: string;
  postingReference: string | null; postedAmount: string | null; postedAt: string | null;
};
export type RemittanceCorrectionRequest = {
  id: number; organizationId: number; targetType: "batch_payment" | "member_posting" | "member_addition";
  batchId: number; memberId: number | null;
  originalSnapshot: Record<string, unknown>;
  proposedSnapshot: Record<string, unknown>;
  reason: string; status: string;
  requestedByUserId: number | null; requestedByName: string;
  decidedByName: string | null; decisionNote: string | null; createdAt: string;
};
export type RemittanceCorrectionPermissions = {
  organizationId: number; legalEntity: { id: number };
  corrections: RemittanceCorrectionRequest[];
  canRequest: boolean; canApprove: boolean; currentUserId: number;
};
export type VerifiedRemittanceCorrections = {
  batches: RemittanceCorrectionBatch[];
  members: RemittanceCorrectionMember[];
  correctionData: RemittanceCorrectionPermissions;
};
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const nonempty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const nullable = (v: unknown) => v === null || typeof v === "string";
const stamp = (v: unknown) => nonempty(v) && Number.isFinite(Date.parse(v));
const optionalStamp = (v: unknown) => v === null || stamp(v);
const amount = (v: unknown) => typeof v === "string" && /^\d+(?:\.\d{1,4})?$/.test(v) && Number.isFinite(Number(v));
const optionalAmount = (v: unknown) => v === null || amount(v);
const validMonth = (v: unknown) => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

function batch(v: unknown, org: number, entity: number): v is RemittanceCorrectionBatch {
  return record(v) && id(v.id) && v.organizationId === org && v.legalEntityId === entity &&
    nonempty(v.agency) && validMonth(v.applicableMonth) && nonempty(v.status) &&
    amount(v.expectedTotal) && optionalAmount(v.amountPaid) &&
    nullable(v.paymentReference) && nullable(v.agencyReceiptReference) &&
    nullable(v.paymentChannel) && nullable(v.paymentVarianceNote) && optionalStamp(v.paidAt);
}
function member(v: unknown, org: number, entity: number, batchIds: Set<number>): v is RemittanceCorrectionMember {
  return record(v) && id(v.id) && v.organizationId === org && v.legalEntityId === entity &&
    id(v.batchId) && batchIds.has(v.batchId) && nonempty(v.employeeNo) &&
    amount(v.totalContribution) && nonempty(v.postingStatus) && nullable(v.postingReference) &&
    optionalAmount(v.postedAmount) && optionalStamp(v.postedAt);
}
function correction(v: unknown, org: number, batchIds: Set<number>, members: Map<number, RemittanceCorrectionMember>): v is RemittanceCorrectionRequest {
  return record(v) && id(v.id) && v.organizationId === org &&
    ["batch_payment", "member_posting", "member_addition"].includes(String(v.targetType)) &&
    id(v.batchId) && batchIds.has(v.batchId) &&
    (v.memberId === null || (id(v.memberId) && members.get(v.memberId)?.batchId === v.batchId)) &&
    record(v.originalSnapshot) && record(v.proposedSnapshot) &&
    nonempty(v.reason) && nonempty(v.status) && nonempty(v.requestedByName) &&
    (v.requestedByUserId === null || id(v.requestedByUserId)) &&
    nullable(v.decidedByName) && nullable(v.decisionNote) && stamp(v.createdAt);
}
export function parseRemittanceCorrectionsRead(
  remittance: unknown, decisions: unknown,
  expected: { organizationId: number; legalEntityId: number | null; viewerUserId: number | null },
): VerifiedRemittanceCorrections | null {
  if (!id(expected.organizationId) || !id(expected.viewerUserId) ||
      !(expected.legalEntityId === null || id(expected.legalEntityId)) ||
      !record(remittance) || remittance.organizationId !== expected.organizationId ||
      !record(remittance.legalEntity) || !id(remittance.legalEntity.id) ||
      (expected.legalEntityId !== null && remittance.legalEntity.id !== expected.legalEntityId) ||
      !Array.isArray(remittance.batches) || !Array.isArray(remittance.members) ||
      !record(decisions) || decisions.organizationId !== expected.organizationId ||
      !record(decisions.legalEntity) || decisions.legalEntity.id !== remittance.legalEntity.id ||
      decisions.currentUserId !== expected.viewerUserId ||
      typeof decisions.canRequest !== "boolean" || typeof decisions.canApprove !== "boolean" ||
      !Array.isArray(decisions.corrections) || decisions.corrections.length > 500) return null;
  const entity = remittance.legalEntity.id;
  if (!remittance.batches.every((v: unknown) => batch(v, expected.organizationId, entity))) return null;
  const batches: RemittanceCorrectionBatch[] = remittance.batches;
  const batchIds = new Set(batches.map((v) => v.id));
  if (batchIds.size !== batches.length ||
      !remittance.members.every((v: unknown) => member(v, expected.organizationId, entity, batchIds))) return null;
  const members: RemittanceCorrectionMember[] = remittance.members;
  const memberIds = new Map(members.map((v) => [v.id, v]));
  if (memberIds.size !== members.length ||
      !decisions.corrections.every((v: unknown) => correction(v, expected.organizationId, batchIds, memberIds))) return null;
  const corrections: RemittanceCorrectionRequest[] = decisions.corrections;
  if (new Set(corrections.map((v) => v.id)).size !== corrections.length) return null;
  return { batches, members, correctionData: decisions as RemittanceCorrectionPermissions };
}
