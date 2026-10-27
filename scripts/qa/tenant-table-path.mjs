import assert from "node:assert/strict";

export function validateTenantPathBinding(key, binding) {
  const route = key.split(" ")[1];
  const names = [...route.matchAll(/\[([A-Za-z][A-Za-z0-9]*)\]/g)].map(match => match[1]);
  if (!names.length) { assert.equal(binding, undefined, key + ": static route cannot declare path IDs"); return; }
  assert.equal(new Set(names).size, names.length, key + ": repeated path parameter");
  assert.ok(binding && Object.getPrototypeOf(binding) === Object.prototype, key + ": literal path binding required");
  assert.deepEqual(Object.keys(binding).sort(), [...names].sort(), key + ": every path parameter must be bound exactly once");
  for (const field of Object.values(binding)) assert.match(field, /^[a-zA-Z][a-zA-Z0-9]*$/, key + ": simple seeded field required");
}

/** Only genuine seeded numeric own/victim IDs may enter a dynamic URL. */
export function bindTenantPath(definition, ctx, target) {
  validateTenantPathBinding(definition.key, definition.pathIds);
  assert.ok(["own", "foreign", "forged"].includes(target), "unknown path target");
  const route = definition.key.split(" ")[1];
  if (!definition.pathIds) return "/api/" + route;
  return "/api/" + route.replace(/\[([A-Za-z][A-Za-z0-9]*)\]/g, (_, name) => {
    const field = definition.pathIds[name], own = ctx.seeded?.[field], victim = ctx.victimSeeded?.[field];
    assert.ok(Number.isSafeInteger(own) && own > 0 && Number.isSafeInteger(victim) && victim > own,
      definition.key + ": victim path ID must genuinely exceed the attacker seed");
    return String(target === "own" ? own : victim);
  });
}

export function selectTenantPathRows(rows, enabled) {
  if (enabled === undefined) return rows;
  assert.equal(enabled, "1", "TENANT_TABLE_PATH_ONLY must be exactly 1 when supplied");
  const selected = rows.filter(row => row.pathIds);
  assert.ok(selected.length, "No path-bound rows in this profile");
  return selected;
}
