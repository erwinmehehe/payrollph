/**
 * Privacy floor for engagement survey reporting.
 * Never expose individual responses, including in API errors, exports, or small
 * filter slices. Responses must be stored without employee/user identifiers.
 */
export const ENGAGEMENT_MIN_GROUP_SIZE = 5;

export type AnonymousSurveyAnswer = { score: number; group: string };
export type SurveyAggregate = { group: string; count: number; average: number };

export function aggregateAnonymousSurvey(
  answers: readonly AnonymousSurveyAnswer[],
  allowedGroups: readonly string[],
): SurveyAggregate[] {
  const permitted = new Set(allowedGroups);
  const grouped = new Map<string, number[]>();
  for (const row of answers) {
    if (!permitted.has(row.group)) continue;
    if (!Number.isInteger(row.score) || row.score < 1 || row.score > 5) {
      throw new Error("Survey response must be a whole-number rating from 1 to 5.");
    }
    grouped.set(row.group, [...(grouped.get(row.group) ?? []), row.score]);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))
    .filter(([, scores]) => scores.length >= ENGAGEMENT_MIN_GROUP_SIZE)
    .map(([group, scores]) => ({
      group, count: scores.length,
      average: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100,
    }));
}
