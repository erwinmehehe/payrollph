import {
  canConfirmMemberPosting,
  canMarkRemittancePaid,
} from "@/lib/statutory-remittance";

export type BatchPaymentEvidence = {
  amountPaid: string | null;
  paymentReference: string | null;
  agencyReceiptReference: string | null;
  paymentChannel: string | null;
  paymentVarianceNote: string | null;
  paidAt: string | null;
  paymentRecordedBy: string | null;
};

export type MemberPostingEvidence = {
  postingStatus: string;
  postingReference: string | null;
  postedAmount: string | null;
  postedAt: string | null;
  confirmedBy: string | null;
  exceptionNote: string | null;
};

export function batchPaymentSnapshot(batch: {
  amountPaid: unknown;
  paymentReference: string | null;
  agencyReceiptReference: string | null;
  paymentChannel: string | null;
  paymentVarianceNote: string | null;
  paidAt: Date | string | null;
  paymentRecordedBy: string | null;
}): BatchPaymentEvidence {
  return {
    amountPaid: batch.amountPaid == null ? null : String(batch.amountPaid),
    paymentReference: batch.paymentReference,
    agencyReceiptReference: batch.agencyReceiptReference,
    paymentChannel: batch.paymentChannel,
    paymentVarianceNote: batch.paymentVarianceNote,
    paidAt: batch.paidAt == null
      ? null
      : new Date(batch.paidAt).toISOString(),
    paymentRecordedBy: batch.paymentRecordedBy,
  };
}

export function memberPostingSnapshot(member: {
  postingStatus: string;
  postingReference: string | null;
  postedAmount: unknown;
  postedAt: Date | string | null;
  confirmedBy: string | null;
  exceptionNote: string | null;
}): MemberPostingEvidence {
  return {
    postingStatus: member.postingStatus,
    postingReference: member.postingReference,
    postedAmount: member.postedAmount == null ? null : String(member.postedAmount),
    postedAt: member.postedAt == null
      ? null
      : new Date(member.postedAt).toISOString(),
    confirmedBy: member.confirmedBy,
    exceptionNote: member.exceptionNote,
  };
}

export function snapshotsMatch(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validatePaymentCorrection(input: {
  expectedTotal: number;
  proposed: {
    amountPaid: number;
    paymentReference: string;
    agencyReceiptReference: string;
    paymentChannel?: string | null;
    paymentVarianceNote?: string | null;
    paidAt: string;
  };
}) {
  const paidAt = new Date(input.proposed.paidAt);
  if (!Number.isFinite(paidAt.getTime())) {
    return { ok: false as const, error: "Corrected payment date must be valid." };
  }
  return canMarkRemittancePaid({
    expectedTotal: input.expectedTotal,
    amountPaid: input.proposed.amountPaid,
    paymentReference: input.proposed.paymentReference,
    agencyReceiptReference: input.proposed.agencyReceiptReference,
    paymentVarianceNote: input.proposed.paymentVarianceNote ?? undefined,
  });
}

export function validatePostingCorrection(input: {
  expectedTotal: number;
  proposed: {
    postingReference: string;
    postedAmount: number;
    postedAt: string;
  };
}) {
  const postedAt = new Date(input.proposed.postedAt);
  if (!Number.isFinite(postedAt.getTime())) {
    return { ok: false as const, error: "Corrected posting date must be valid." };
  }
  return canConfirmMemberPosting({
    expectedTotal: input.expectedTotal,
    postedAmount: input.proposed.postedAmount,
    postingReference: input.proposed.postingReference,
  });
}
