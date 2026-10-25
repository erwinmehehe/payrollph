/**
 * Legacy compliance tasks have no legal_entity_id column. Only the canonical
 * source-key prefix establishes the task's employer; display text never does.
 */
export function statutoryRemittanceTaskEntityId(sourceKey: string): number | null {
  const match = /^legal-entity:([1-9]\d*):/.exec(sourceKey);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

export function statutoryRemittanceTaskInScope(
  sourceKey: string,
  legalEntityId: number | null,
): boolean {
  return legalEntityId === null
    || statutoryRemittanceTaskEntityId(sourceKey) === legalEntityId;
}
