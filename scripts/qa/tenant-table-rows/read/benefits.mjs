// Fictional fixtures only. Shared runners enforce all HTTP/DB isolation controls.
// Preserve the existing fixture order; new rows may omit an order until integration.
export const fixtureOrder = {
  "GET benefits/hmo": 0,
  "GET benefits": 1
};

export function createRows({ proofs }) {
  return [
  { key: "GET benefits/hmo", prove: proofs.listsOwnMarker("employees", "name") },
  { key: "GET benefits", prove: proofs.listsOwnMarker("employees", "name") },
  ];
}
