export function correctionPredecessorId(snapshot: unknown): number | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const id = (snapshot as Record<string, unknown>).correctionOfChangeId;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function readHcmCorrectionReason(ok: boolean, value: unknown, expected: { organizationId: number; employeeId: number; changeId: number }): string {
  const body = value as Record<string, unknown> | null;
  if (!ok || !body || body.organizationId !== expected.organizationId || body.employeeId !== expected.employeeId
    || body.changeId !== expected.changeId || typeof body.note !== "string" || body.note.trim().length < 10 || body.note.length > 500
    || typeof body.reviewer !== "string" || !body.reviewer.trim() || typeof body.returnedAt !== "string" || !Number.isFinite(Date.parse(body.returnedAt))) {
    throw new Error("Return reason unavailable. Refresh the source before correcting it.");
  }
  return body.note;
}

export function verifyHcmCorrectionActionRead(ok: boolean, body: unknown, expected: {
  organizationId: number; employeeId: number; changeId: number; userId: number; action: "return" | "resubmit";
}) {
  const payload = body as { change?: Record<string, unknown>; businessProcess?: Record<string, unknown>; previousProcessId?: unknown } | null;
  const row = payload?.change;
  if (!ok || !row || row.organizationId !== expected.organizationId || row.employeeId !== expected.employeeId
    || !Number.isSafeInteger(row.id) || Number(row.id) <= 0) throw new Error("Correction result unavailable. Refresh before retrying.");
  if (expected.action === "return") {
    if (row.id !== expected.changeId || row.status !== "returned_for_correction" || !Number.isSafeInteger(payload.previousProcessId) || Number(payload.previousProcessId) <= 0) throw new Error("Correction return could not be verified. Refresh before retrying.");
  } else if (row.id === expected.changeId || row.status !== "pending_approval" || row.requestedByUserId !== expected.userId
    || correctionPredecessorId(row.toSnapshot) !== expected.changeId
    || !Number.isSafeInteger(payload.businessProcess?.id) || Number(payload.businessProcess?.id) <= 0 || payload.businessProcess?.status !== "in_progress") {
    throw new Error("Fresh approval submission could not be verified. Refresh before retrying.");
  }
}
