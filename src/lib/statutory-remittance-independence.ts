export type EvidenceActor = {
  userId?: number | null;
  name?: string | null;
};

export type EvidenceActorIdentity = {
  userIds: Set<number>;
  legacyNames: Set<string>;
};

export function buildEvidenceActorIdentity(actors: EvidenceActor[]) {
  const userIds = new Set<number>();
  const legacyNames = new Set<string>();

  for (const actor of actors) {
    if (Number.isInteger(actor.userId) && Number(actor.userId) > 0) {
      userIds.add(Number(actor.userId));
      continue;
    }
    const name = String(actor.name ?? "").trim();
    if (name) legacyNames.add(name);
  }

  return { userIds, legacyNames };
}

export function certifierConflictsWithEvidence(input: {
  certifierUserId: number;
  certifierName: string;
  evidence: EvidenceActorIdentity;
}) {
  if (input.evidence.userIds.has(input.certifierUserId)) return true;
  const name = input.certifierName.trim();
  return Boolean(name && input.evidence.legacyNames.has(name));
}
