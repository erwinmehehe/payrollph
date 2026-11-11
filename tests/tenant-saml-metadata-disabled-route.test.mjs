/**
 * Execute the actual metadata handler with isolated dependency doubles.
 * These are unit regressions, NOT PostgreSQL/Next HTTP execution receipts.
 * No database, session, network, provider or environment secrets are loaded.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const routePath = "src/app/api/auth/saml/metadata/[providerId]/route.ts";
const originalSource = readFileSync(routePath, "utf8");
const compiled = ts.transpileModule(originalSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: routePath,
  reportDiagnostics: true,
});
assert.equal((compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);

function harness() {
  const rows = [
    { id: 101, protocol: "saml", enabled: false, name: "PRIVATE_DISABLED_MARKER" },
    { id: 202, protocol: "saml", enabled: true, name: "PRIVATE_ENABLED_MARKER" },
    { id: 303, protocol: "oidc", enabled: true, name: "PRIVATE_OIDC_MARKER" },
    { id: 404, protocol: "saml", enabled: null, name: "PRIVATE_UNSET_MARKER" },
    { id: 606, protocol: "saml", enabled: true, name: "PRIVATE_OTHER_MARKER" },
  ];
  const table = Object.freeze({ id: "id", protocol: "protocol", enabled: "enabled" });
  const calls = { queries: [], metadata: [], origins: 0 };
  const eq = (column, value) => ({ kind: "eq", column, value });
  const and = (...terms) => ({ kind: "and", terms });
  const matches = (row, expression) => {
    if (expression.kind === "eq") return row[expression.column] === expression.value;
    assert.equal(expression.kind, "and");
    return expression.terms.every(term => matches(row, term));
  };
  const db = {
    select(selection) {
      return { from(actualTable) {
        assert.equal(actualTable, table);
        return { where(predicate) {
          calls.queries.push(predicate);
          return { async limit(n) {
            return rows.filter(row => matches(row, predicate)).slice(0, n).map(row =>
              Object.fromEntries(Object.entries(selection).map(([key, column]) => [key, row[column]])));
          } };
        } };
      } };
    },
  };
  const dependencies = {
    "drizzle-orm": { and, eq },
    "@/db": { db },
    "@/db/schema": { identityProviders: table },
    "@/lib/security-request": { canonicalAppOrigin() { calls.origins++; return "https://payroll.example.test"; } },
    "@/lib/saml": { buildSamlServiceProviderMetadata(value) {
      calls.metadata.push({ ...value });
      return `<EntityDescriptor entityID="${value.entityId}"><AssertionConsumerService Location="${value.acsUrl}"/></EntityDescriptor>`;
    } },
  };
  const module = { exports: {} };
  runInNewContext(compiled.outputText, {
    module, exports: module.exports, Response,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), "Unexpected dependency: " + name);
      return dependencies[name];
    },
  }, { filename: routePath, timeout: 1000 });
  const get = (id, query = "", headers = {}) => module.exports.GET(
    new Request("http://127.0.0.1/api/auth/saml/metadata/" + id + query, { headers }),
    { params: Promise.resolve({ providerId: String(id) }) },
  );
  return { rows, calls, get };
}

async function snapshot(response) {
  return {
    status: response.status,
    headers: Object.fromEntries([...response.headers.entries()].sort()),
    body: await response.text(),
  };
}

// These negative cases deliberately fail against main's original route.
test("disabled SAML and a nonexistent provider have the same no-store 404 response", async () => {
  const h = harness();
  const disabled = await snapshot(await h.get(101));
  const missing = await snapshot(await h.get(99999));
  assert.equal(disabled.status, 404);
  assert.deepEqual(disabled, missing);
  assert.equal(disabled.headers["cache-control"], "no-store");
  assert.deepEqual(JSON.parse(disabled.body), { error: "SAML provider not found." });
  assert.equal(h.calls.metadata.length, 0);
  assert.equal(h.calls.origins, 0);
});

test("forged query and header selectors cannot expose a disabled provider", async () => {
  const h = harness();
  const forged = await snapshot(await h.get(101,
    "?providerId=202&organizationId=999&enabled=true", {
      "x-organization-id": "999", "x-tenant-id": "999",
    }));
  const missing = await snapshot(await h.get(99999));
  assert.deepEqual(forged, missing);
  assert.equal(h.calls.metadata.length, 0);
  assert.doesNotMatch(forged.body, /EntityDescriptor|PRIVATE_|101|202/);
});

test("enabled SAML keeps metadata behavior but its response is not cacheable", async () => {
  const h = harness();
  const result = await snapshot(await h.get(202));
  assert.equal(result.status, 200);
  assert.match(result.headers["content-type"], /^application\/samlmetadata\+xml/);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.headers["x-content-type-options"], "nosniff");
  assert.match(result.body, /metadata\/202/);
  assert.match(result.body, /acs\/202/);
  assert.doesNotMatch(result.body, /PRIVATE_/);
  assert.equal(h.calls.metadata.length, 1);
});

test("OIDC and unset-enabled providers are indistinguishable from a missing provider", async () => {
  const h = harness();
  const missing = await snapshot(await h.get(99999));
  for (const id of [303, 404]) assert.deepEqual(await snapshot(await h.get(id)), missing);
  assert.equal(h.calls.metadata.length, 0);
});

test("the query requires the requested ID, SAML protocol, and enabled true", async () => {
  const h = harness();
  await h.get(202);
  // JSON normalization avoids cross-realm prototype comparisons.
  const expression = JSON.parse(JSON.stringify(h.calls.queries[0]));
  assert.equal(expression.kind, "and");
  for (const [column, value] of [["id", 202], ["protocol", "saml"], ["enabled", true]]) {
    assert.ok(expression.terms.some(term => term.kind === "eq" && term.column === column && term.value === value),
      "Missing query predicate: " + column);
  }
});

test("disabling a previously visible provider conceals its next response", async () => {
  const h = harness();
  assert.equal((await h.get(202)).status, 200);
  h.rows.find(row => row.id === 202).enabled = false;
  assert.deepEqual(await snapshot(await h.get(202)), await snapshot(await h.get(99999)));
  assert.equal(h.calls.metadata.length, 1);
});

test("forged selectors cannot substitute a different enabled provider for the path ID", async () => {
  const h = harness();
  const expected = await snapshot(await h.get(202));
  const actual = await snapshot(await h.get(202, "?providerId=606&organizationId=999", {
    "x-provider-id": "606", "x-organization-id": "999",
  }));
  assert.deepEqual(actual, expected);
  assert.doesNotMatch(actual.body, /606|PRIVATE_/);
});

test("malformed IDs retain the existing 400 response without querying providers", async () => {
  const h = harness();
  for (const id of ["not-an-id", "1.5"]) assert.equal((await h.get(id)).status, 400);
  assert.equal(h.calls.queries.length, 0);
  assert.equal(h.calls.metadata.length, 0);
});
