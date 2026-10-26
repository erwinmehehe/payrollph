import assert from "node:assert/strict";
import { FAMILY_ROOT, tenantFamilyCatalog } from "./tenant-table-catalog.mjs";
import { bindTenantPath, validateTenantPathBinding } from "./tenant-table-path.mjs";

export function validateTenantRow(row, spec) {
  assert.equal(row?.key, spec.key, "runtime/source method identity mismatch");
  assert.equal(row.profile ?? "default", spec.profile, row.key + ": runtime/source profile mismatch");
  assert.deepEqual(row.flags ?? [], spec.flags, row.key + ": runtime/source flags mismatch");
  validateTenantPathBinding(row.key, row.pathIds);
  assert.deepEqual(row.pathIds, spec.pathIds, row.key + ": runtime/source path binding mismatch");
  assert.ok([403, 404].includes(row.deny ?? 403), row.key + ": foreign request must be denied");
  if (spec.kind === "read") {
    assert.equal(row.status ?? 200, 200, row.key + ": own read must succeed");
    assert.equal(typeof row.prove, "function", row.key + ": own-data proof required");
  } else {
    assert.ok([200, 201, 202, 204].includes(row.status ?? 200), row.key + ": own write must succeed");
    for (const field of ["state", "expect"]) assert.equal(typeof row[field], "function", row.key + ": " + field + " required");
    assert.ok((typeof row.ownBody === "function" && typeof row.foreignBody === "function") ||
      (row.key.startsWith("DELETE ") && typeof row.query === "function"), row.key + ": own and foreign requests required");
  }
  return row;
}

/** Auto-discover every family file, then enforce source/runtime identity and proof shape.
 * Existing fixture order is retained across the mechanical move. New unordered rows
 * follow existing fixtures, sorted by family filename and source line.
 */
export async function loadTenantRows(kind, context, root = FAMILY_ROOT) {
  const catalog = tenantFamilyCatalog(kind, root);
  assert.ok(catalog.length > 0, "an empty tenant table proves nothing");
  const loaded = new Map();
  for (const spec of catalog) {
    if (loaded.has(spec.file)) continue;
    const family = await import(spec.url.href);
    assert.equal(typeof family.createRows, "function", spec.file + ": missing row factory");
    const rows = family.createRows(context);
    assert.ok(Array.isArray(rows), spec.file + ": row factory must return an array");
    const expected = catalog.filter((r) => r.file === spec.file).sort((a, b) => a.line - b.line);
    assert.deepEqual(rows.map((r) => r?.key), expected.map((r) => r.key), spec.file + ": runtime/source row-set mismatch");
    loaded.set(spec.file, new Map(rows.map((row) => [row.key, row])));
  }
  return Object.freeze(catalog.map((spec) => Object.freeze(validateTenantRow(loaded.get(spec.file).get(spec.key), spec))));
}

/** Bind one attacker attempt without mutating the shared, frozen definition. */
export function bindTenantReadRequests(definition, ownId, victimId, extra = "", ctx) {
  assert.ok(definition.key.startsWith("GET "), "read requests require a GET definition");
  if (definition.pathIds) return Object.freeze({ ...definition,
    own: bindTenantPath(definition, ctx, "own") + "?organizationId=" + ownId + extra,
    foreign: bindTenantPath(definition, ctx, "foreign") + "?organizationId=" + victimId + extra });
  const base = "/api/" + definition.key.slice(4) + "?organizationId=";
  return Object.freeze({ ...definition, own: base + ownId + extra, foreign: base + victimId + extra });
}
