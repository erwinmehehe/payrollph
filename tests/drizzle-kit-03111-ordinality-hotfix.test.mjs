import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import {
  patchPinnedIntrospectionBinary,
  ensurePinnedKitOrdinalityPatch,
} from "../scripts/lib/drizzle-kit-03111-ordinality-hotfix.mjs";

const kit = join("node_modules", "drizzle-kit");
const manifest = JSON.parse(readFileSync(join(kit, "package.json"), "utf8"));
const actual = readFileSync(join(kit, "bin.cjs"), "utf8");
const markerKey = "PAYROLLPH_1019_ORDERED_KEY_COLUMNS_V1";
const markerFk = "PAYROLLPH_1019_PAIRED_FOREIGN_COLUMNS_V1";
const markerIndex = "PAYROLLPH_1019_INDEX_COLUMN_EXPRESSION_V1";

test("#1019 local Drizzle Kit remains version pinned; no RC dependency promotion", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.devDependencies["drizzle-kit"], "0.31.11");
  assert.equal(pkg.dependencies["drizzle-orm"], "0.45.4");
  assert.equal(pkg.scripts["db:push"], "node scripts/strict-db-push.mjs");
  if (manifest.version !== "0.31.11") {
    assert.equal(manifest.version, "1.0.0-rc.4");
    assert.equal(process.env.CI, "true");
    assert.equal(process.env.GITHUB_ACTIONS, "true");
  }
});

test("#1019 patched introspection keeps real CLI and preserves ordered composite key/FK rows", () => {
  if (manifest.version === "1.0.0-rc.4") {
    assert.equal(ensurePinnedKitOrdinalityPatch(join(kit, "bin.cjs")), "ci-only-rc-exempt");
    return;
  }
  assert.equal(manifest.version, "0.31.11");
  const result = patchPinnedIntrospectionBinary(actual);
  assert.ok(result.content.includes(markerKey));
  assert.ok(result.content.includes(markerFk));
  assert.equal(result.content.split(markerIndex).length - 1, 2);
  assert.match(result.content, /CASE WHEN k.attnum = 0 THEN 1 ELSE 0 END AS is_expression/);
  assert.doesNotMatch(result.content, /pg_get_expr(i.indexprs,s*i.indrelid)s+ISs+NOTs+NULL/);
  assert.match(result.content, /information_schema\.key_column_usage/);
  assert.match(result.content, /kcu\.ordinal_position/);
  assert.match(result.content, /ROWS FROM \(pg_catalog\.unnest\(con\.conkey\), pg_catalog\.unnest\(con\.confkey\)\) WITH ORDINALITY/);
  assert.doesNotMatch(result.content, /pg_catalog\.unnest\(con\.conkey,\s*con\.confkey\)/);
  assert.match(result.content, /JOIN LATERAL ROWS FROM/);
  assert.match(result.content, /ORDER BY con\.conname, fkcols\.ord/);
  assert.equal(patchPinnedIntrospectionBinary(result.content).applied, false);
  assert.equal(patchPinnedIntrospectionBinary(result.content).content, result.content);
  assert.throws(
    () => patchPinnedIntrospectionBinary(result.content.replace(markerFk, "partial-hotfix")),
    /DRIZZLE_1019_PARTIAL_OR_UNKNOWN_PATCH/
  );
  assert.throws(
    () => patchPinnedIntrospectionBinary(result.content.replace(markerIndex, "partial-index-hotfix")),
    /DRIZZLE_1019_PARTIAL_OR_UNKNOWN_PATCH/
  );
  const wrapper = readFileSync("scripts/strict-db-push.mjs", "utf8");
  assert.match(wrapper, /assertIsolatedDbPushTarget\(env\.DATABASE_URL, env\)/);
  assert.match(wrapper, /ensurePinnedKitOrdinalityPatch\(BIN, env\)/);
  assert.ok(wrapper.indexOf("assertIsolatedDbPushTarget(env.DATABASE_URL, env)") <
    wrapper.indexOf("ensurePinnedKitOrdinalityPatch(BIN, env)"),
    "remote-target guard runs before any package mutation");
  assert.match(wrapper, /classifyStrictDbPush\(code, stdout, stderr\)/);
  assert.doesNotMatch(wrapper, /--force|--accept-data-loss|DROP SCHEMA|shell:\s*true/);
});
