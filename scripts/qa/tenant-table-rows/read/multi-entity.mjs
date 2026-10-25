// Fictional fixtures only. Shared runners enforce all HTTP/DB isolation controls.
// Preserve the existing fixture order; new rows may omit an order until integration.
export const fixtureOrder = {
  "GET multi-entity/context": 78,
  "GET multi-entity/settings": 79,
  "GET multi-entity/transfers": 80
};

export function createRows({ grantOwnEntity, proofs }) {
  return [
  { key: "GET multi-entity/context", profile: "multi-entity", flags: ["MULTI_ENTITY_ENABLED"], seed: grantOwnEntity,
    prove: proofs.all(proofs.echoesOrganization(), proofs.echoesOwn("legalEntityId", "entityId"), proofs.listsOwnMarker("entities", "legalName")) },
  { key: "GET multi-entity/settings", profile: "multi-entity", flags: ["MULTI_ENTITY_ENABLED"], seed: grantOwnEntity,
    prove: proofs.listsOwnMarker("entities", "legalName") },
  { key: "GET multi-entity/transfers", profile: "multi-entity", flags: ["MULTI_ENTITY_ENABLED"], seed: grantOwnEntity,
    prove: proofs.listsOwnMarker("destinations", "legalName") },
  ];
}
