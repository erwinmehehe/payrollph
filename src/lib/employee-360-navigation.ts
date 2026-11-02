import type { Employee360Card, Employee360CardId } from "./employee-360-overview";

/** Presentation-only groups. The existing People drawer remains the single
 * entry point, and each card still links to its source-owned detail section. */
export const EMPLOYEE_360_SECTIONS = [
  { id: "overview", label: "Overview", cardIds: ["onboarding", "payroll"] },
  { id: "job", label: "Job & Organization", cardIds: ["employment", "compensation"] },
  { id: "leave", label: "Leave", cardIds: ["leave"] },
  { id: "documents", label: "Documents", cardIds: ["documents"] },
  { id: "performance", label: "Performance", cardIds: ["performance"] },
  { id: "history", label: "History", cardIds: ["history"] },
] as const satisfies readonly {
  id: string; label: string; cardIds: readonly Employee360CardId[];
}[];

export type Employee360SectionId = (typeof EMPLOYEE_360_SECTIONS)[number]["id"];

export function cardsForEmployee360Section(
  cards: readonly Employee360Card[],
  section: Employee360SectionId,
): Employee360Card[] {
  const group = EMPLOYEE_360_SECTIONS.find(item => item.id === section);
  if (!group) return [];
  return group.cardIds.flatMap(id => {
    const card = cards.find(item => item.id === id);
    return card ? [card] : [];
  });
}

/** Only recorded effective dates qualify. No mutable current employee field or
 * unsourced timeline event is allowed to manufacture an historical "as of". */
export function latestLinkedEffectiveDate(history: {
  employmentEvents: readonly unknown[];
  positionAssignments: readonly unknown[];
}): string | null {
  const dates: string[] = [];
  const recordDate = (record: unknown, field: "effectiveDate" | "effectiveFrom") => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return;
    const value = (record as Record<string, unknown>)[field];
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const stamp = new Date(value + "T00:00:00Z");
    if (Number.isNaN(stamp.getTime()) || stamp.toISOString().slice(0, 10) !== value) return;
    dates.push(value);
  };
  for (const event of history.employmentEvents) recordDate(event, "effectiveDate");
  for (const assignment of history.positionAssignments) recordDate(assignment, "effectiveFrom");
  return dates.length ? dates.sort().at(-1)! : null;
}
