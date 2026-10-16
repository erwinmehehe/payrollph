/** Source-derived defaults for the editable workforce roster, without effect-driven setters. */
export function workforcePlannerDraftDefaults(shiftId?: number | null, patternId?: number | null) {
  const shift = shiftId == null ? null : String(shiftId);
  return {
    patternChoices: shift == null
      ? Array<string>(7).fill("")
      : [shift, shift, shift, shift, shift, "REST", "REST"],
    overrideMode: shift ?? "REST",
    assignmentPatternId: patternId == null ? "" : String(patternId),
  };
}

/** Discard an obsolete employee/date/tenant preview even before effect cleanup runs. */
export function scopedWorkforcePlannerPreview<T>(
  snapshot: { scopeKey: string; data: T } | null,
  activeScopeKey: string,
): T | null {
  return snapshot?.scopeKey === activeScopeKey ? snapshot.data : null;
}
