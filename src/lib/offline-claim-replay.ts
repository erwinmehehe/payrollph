/** Compare an already-recorded unverified claim with the same offline client event. */
export function sameOfflineClaimReplay(
 existing: { submittedByUserId: number; actionType: string; claimedAt: Date },
 incoming: { submittedByUserId: number; actionType: string; claimedAt: Date },
): boolean {
 return Number.isSafeInteger(existing.submittedByUserId)
  && existing.submittedByUserId > 0
  && existing.submittedByUserId === incoming.submittedByUserId
  && ["clock_in","clock_out"].includes(existing.actionType)
  && existing.actionType === incoming.actionType
  && Number.isFinite(existing.claimedAt.getTime())
  && Number.isFinite(incoming.claimedAt.getTime())
  && existing.claimedAt.getTime() === incoming.claimedAt.getTime();
}
