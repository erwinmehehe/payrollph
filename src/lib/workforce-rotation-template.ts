/** Review-only editor draft for a compatible seven-day workforce rotation. */
export type RotationTemplateResult =
  | { ok: true; code: string; name: string; choices: string[] }
  | { ok: false; error: string };

type Pattern = { id: number; code: string; name: string; cycleDays: number };
type Day = { id: number; patternId: number; dayIndex: number; isRestDay: boolean };
type Segment = { patternDayId: number; segmentOrder: number; shiftDefinitionId: number };

export function buildRotationTemplateDraft(input: {
  pattern: Pattern;
  patterns: Pattern[];
  days: Day[];
  segments: Segment[];
  shiftIds: number[];
}): RotationTemplateResult {
  const { pattern, patterns, days, segments, shiftIds } = input;
  if (!patterns.some(row => row.id === pattern.id && row.code === pattern.code)) {
    return { ok: false, error: "Selected rotation is no longer available in the current catalog." };
  }
  if (pattern.cycleDays !== 7) {
    return { ok: false, error: "Only seven-day rotations can be copied in this editor." };
  }
  const matchedDays = days.filter(row => row.patternId === pattern.id);
  if (matchedDays.length !== 7 ||
      new Set(matchedDays.map(row => row.dayIndex)).size !== 7 ||
      matchedDays.some(row => !Number.isSafeInteger(row.dayIndex) || row.dayIndex < 0 || row.dayIndex > 6)) {
    return { ok: false, error: "This rotation has incomplete or contradictory day evidence." };
  }
  const shiftSet = new Set(shiftIds);
  const choices: string[] = [];
  for (let i = 0; i < 7; i++) {
    const day = matchedDays.find(row => row.dayIndex === i)!;
    const daySegments = segments.filter(row => row.patternDayId === day.id);
    if (day.isRestDay) {
      if (daySegments.length !== 0) {
        return { ok: false, error: "A rest day unexpectedly contains a shift segment; inspect the source." };
      }
      choices.push("REST");
    } else if (daySegments.length === 1 && daySegments[0].segmentOrder === 1 &&
      shiftSet.has(daySegments[0].shiftDefinitionId)) {
      choices.push(String(daySegments[0].shiftDefinitionId));
    } else {
      return { ok: false, error: "Split, missing or complex shifts cannot be flattened into a single-shift editor." };
    }
  }
  const root = pattern.code.slice(0, 20).replace(/-COPY-\d+$/i, "");
  if (!root) return { ok: false, error: "Rotation code needs review before reuse." };
  const usedCodes = new Set(patterns.map(row => row.code.toUpperCase()));
  for (let suffix = 1; suffix <= 999; suffix++) {
    const code = (root + "-COPY-" + suffix).slice(0, 32).toUpperCase();
    if (!usedCodes.has(code)) {
      return { ok: true, code, name: (pattern.name + " (copy)").slice(0, 120), choices };
    }
  }
  return { ok: false, error: "No unique copy code is available; enter a new code manually." };
}
