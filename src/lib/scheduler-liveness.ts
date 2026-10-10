export type SchedulerLiveness = {
  ok: boolean;
  state: "healthy" | "never-ran" | "overdue" | "last-run-failed" | "invalid-clock" | "missing-or-invalid-lease";
  lastSuccessfulRunAt: string | null;
  secondsSinceSuccess: number | null;
  lastLeaseStatus: string | null;
};

export function evaluateSchedulerLiveness(input: {
  lastSuccessfulRunAt?: Date | null;
  lastLeaseStatus?: string | null;
  now?: Date;
  overdueAfterMs?: number;
}): SchedulerLiveness {
  const now = (input.now ?? new Date()).getTime();
  const previous = input.lastSuccessfulRunAt?.getTime() ?? NaN;
  const lease = input.lastLeaseStatus ?? null;
  const cutoff = input.overdueAfterMs ?? 10 * 60_000;
  if (!Number.isFinite(now) || !Number.isFinite(cutoff) || cutoff < 60_000 || cutoff > 60 * 60_000) {
    return {ok:false,state:"invalid-clock",lastSuccessfulRunAt:null,secondsSinceSuccess:null,lastLeaseStatus:lease};
  }
  if (!Number.isFinite(previous)) {
    return {ok:false,state:"never-ran",lastSuccessfulRunAt:null,secondsSinceSuccess:null,lastLeaseStatus:lease};
  }
  const age = now - previous;
  const ageSeconds = Number.isFinite(age) && age >= 0 ? Math.floor(age / 1000) : null;
  const timestamp = input.lastSuccessfulRunAt?.toISOString() ?? null;
  if (ageSeconds === null) {
    return {ok:false,state:"invalid-clock",lastSuccessfulRunAt:timestamp,secondsSinceSuccess:null,lastLeaseStatus:lease};
  }
  if (lease === "failed") {
    return {ok:false,state:"last-run-failed",lastSuccessfulRunAt:timestamp,secondsSinceSuccess:ageSeconds,lastLeaseStatus:lease};
  }
  // A recent legacy delivery-drain row is not evidence that the new central
  // scheduler lease exists. Without a recognized lease state, fail closed.
  if (lease !== "running" && lease !== "completed") {
    return {ok:false,state:"missing-or-invalid-lease",lastSuccessfulRunAt:timestamp,secondsSinceSuccess:ageSeconds,lastLeaseStatus:lease};
  }
  const good = age <= cutoff;
  return {ok:good,state:good?"healthy":"overdue",lastSuccessfulRunAt:timestamp,secondsSinceSuccess:ageSeconds,lastLeaseStatus:lease};
}
