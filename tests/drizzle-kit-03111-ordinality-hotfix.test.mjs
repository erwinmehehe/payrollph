import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import {
  patchPinnedIntrospectionBinary,
  ensurePinnedKitOrdinalityPatch,
  canonicalPgJsonbDefault,
} from "../scripts/lib/drizzle-kit-03111-ordinality-hotfix.mjs";

const kit = join("node_modules", "drizzle-kit");
const manifest = JSON.parse(readFileSync(join(kit, "package.json"), "utf8"));
const actual = readFileSync(join(kit, "bin.cjs"), "utf8");
const markerKey = "PAYROLLPH_1019_ORDERED_KEY_COLUMNS_V1";
const markerFk = "PAYROLLPH_1019_PAIRED_FOREIGN_COLUMNS_V1";
const markerIndex = "PAYROLLPH_1019_INDEX_COLUMN_EXPRESSION_V1";
const markerFkName = "PAYROLLPH_1019_PG63_FOREIGN_NAMES_V1";
const markerJsonb = "PAYROLLPH_1019_JSONB_CANONICAL_DEFAULT_V1";

test("#1019 canonical JSONB defaults preserve values but match PG object key order", () => {
  const declared={version:1,all:[],any:[]};
  assert.equal(canonicalPgJsonbDefault(declared), '{"all":[],"any":[],"version":1}');
  assert.deepEqual(JSON.parse(canonicalPgJsonbDefault(declared)), declared);
  assert.equal(canonicalPgJsonbDefault([{long:3,a:2}]), '[{"a":2,"long":3}]');
});

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
  // Pinned 0.31.11 contains BOTH MySQL and PostgreSQL foreign-key serializers.
  // The installed hotfix must change PG only, leaving MySQL unmodified.
  const bareInsertion = /fks\.forEach\(\(it\)\s*=>\s*\{\s*foreignKeysObject\[it\.name\]\s*=\s*it;\s*\}\);/g;
  assert.equal([...actual.matchAll(bareInsertion)].length,2);
  const result = patchPinnedIntrospectionBinary(actual);
  assert.ok(result.content.includes(markerKey));
  assert.ok(result.content.includes(markerFk));
  assert.equal(result.content.split(markerIndex).length - 1, 2);
  assert.equal(result.content.split(markerFkName).length - 1, 1);
  assert.equal(result.content.split(markerJsonb).length - 1, 2);
  assert.match(result.content, /Buffer\.byteLength\(a, "utf8"\)/);
  assert.equal([...result.content.matchAll(bareInsertion)].length,1,
    "the MySQL FK insertion must be retained unchanged");
  const pgMarkerPos = result.content.indexOf(markerFkName);
  assert.match(result.content.slice(Math.max(0,pgMarkerPos-330),pgMarkerPos),
    /schemaTo,\s*columnsFrom,\s*columnsTo/);
  assert.match(result.content, /Buffer\.byteLength\(it\.name, 'utf8'\) > 63/);
  assert.match(result.content, /DRIZZLE_1019_FK_NAME_COLLISION/);
  assert.match(result.content, /DRIZZLE_1019_UNSUPPORTED_MULTIBYTE_FK_NAME/);
  assert.match(result.content, /CASE WHEN k.attnum = 0 THEN 1 ELSE 0 END AS is_expression/);
  assert.doesNotMatch(result.content, /pg_get_expr\(i\.indexprs,\s*i\.indrelid\)\s+IS\s+NOT\s+NULL/);
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
  assert.throws(
    () => patchPinnedIntrospectionBinary(result.content.replace(markerFkName, "partial-fk-name-hotfix")),
    /DRIZZLE_1019_PARTIAL_OR_UNKNOWN_PATCH/
  );
  assert.throws(
    () => patchPinnedIntrospectionBinary(result.content.replace(markerJsonb, "partial-jsonb-hotfix")),
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
