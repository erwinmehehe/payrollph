import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runInNewContext } from "node:vm";
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
  // Full regression runs AFTER db:push; the standalone two-push proof runs
  // BEFORE it. Both are valid installed states of the same pinned binary.
  const alreadyPatched = actual.includes(markerKey);
  assert.equal([...actual.matchAll(bareInsertion)].length, alreadyPatched ? 1 : 2);
  const result = patchPinnedIntrospectionBinary(actual);
  assert.equal(result.applied, !alreadyPatched);
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

test("#1019 executes the patched PG serializer without changing MySQL or paired column order", () => {
  if (manifest.version !== "0.31.11") return;
  const patched = patchPinnedIntrospectionBinary(actual).content;
  const pg = patched.match(/fks\.forEach\(\(it\) => \{ \/\* PAYROLLPH_1019_PG63_FOREIGN_NAMES_V1 \*\/[\s\S]*?foreignKeysObject\[it\.name\] = it; \}\);/)?.[0];
  const mysql = patched.match(/fks\.forEach\(\(it\)\s*=>\s*\{\s*foreignKeysObject\[it\.name\]\s*=\s*it;\s*\}\);/)?.[0];
  assert.ok(pg && mysql, "Both vendor serializer bodies must be available for execution");
  const longName = "fk_" + "a".repeat(70);
  const fixture = () => ({ name: longName, tableFrom: "employee_hr_cases", tableTo: "documents",
    columnsFrom: ["organization_id", "employee_id", "coe_document_id"],
    columnsTo: ["organization_id", "employee_id", "id"] });
  const execute = (source, fks) => {
    const foreignKeysObject = Object.create(null);
    runInNewContext(source, { Buffer, fks, foreignKeysObject }, { timeout: 1000 });
    return foreignKeysObject;
  };
  const original = fixture();
  const pgResult = execute(pg, [structuredClone(original)]);
  assert.deepEqual(Object.keys(pgResult), [longName.slice(0, 63)]);
  assert.deepEqual(pgResult[longName.slice(0, 63)], { ...original, name: longName.slice(0, 63) });
  assert.deepEqual(execute(mysql, [structuredClone(original)])[longName], original);
  assert.throws(() => execute(pg, [fixture(), { ...fixture(), name: longName + "collision" }]), /DRIZZLE_1019_FK_NAME_COLLISION/);
  assert.throws(() => execute(pg, [{ ...fixture(), name: "é".repeat(40) }]), /DRIZZLE_1019_UNSUPPORTED_MULTIBYTE_FK_NAME/);
});

test("#1019 installer accepts both fresh and previously patched local packages without rewriting twice", () => {
  if (manifest.version !== "0.31.11") return;
  const root = resolve(tmpdir());
  const fixture = mkdtempSync(join(root, "payrollph-1019-"));
  try {
    const binary = join(fixture, "bin.cjs");
    writeFileSync(join(fixture, "package.json"), JSON.stringify({ version: "0.31.11" }));
    for (const source of [actual, patchPinnedIntrospectionBinary(actual).content]) {
      writeFileSync(binary, source);
      assert.equal(ensurePinnedKitOrdinalityPatch(binary), source.includes(markerKey) ? "previously-patched" : "patched-pinned-kit");
      const first = readFileSync(binary, "utf8");
      assert.equal(ensurePinnedKitOrdinalityPatch(binary), "previously-patched");
      assert.equal(readFileSync(binary, "utf8"), first);
    }
    writeFileSync(join(fixture, "package.json"), JSON.stringify({ version: "0.31.12" }));
    assert.throws(() => ensurePinnedKitOrdinalityPatch(binary), /UNSUPPORTED_KIT_VERSION/);
  } finally {
    assert.equal(dirname(resolve(fixture)), root);
    assert.ok(basename(fixture).startsWith("payrollph-1019-"));
    rmSync(fixture, { recursive: true, force: true });
  }
});
