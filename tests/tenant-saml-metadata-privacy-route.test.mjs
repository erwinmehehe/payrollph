/** Execute the actual TypeScript GET handler with isolated in-memory adapters.
 * No database, Next server, session, provider, secret or network is contacted.
 * This is regression evidence, not disposable-PG16 HTTP acceptance.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { compileFunction } from 'node:vm';
import test from 'node:test';

const ROUTE = 'src/app/api/auth/saml/metadata/[providerId]/route.ts';
const routeSource = readFileSync(process.env.SAML_METADATA_REGRESSION_SOURCE || ROUTE, 'utf8');

function harness() {
  const rows = [
    { id: 11, protocol: 'saml', enabled: false, name: 'PRIVATE_DISABLED', clientSecretEncrypted: 'FICTIONAL_SECRET' },
    { id: 12, protocol: 'saml', enabled: true, name: 'PRIVATE_ENABLED' },
    { id: 13, protocol: 'oidc', enabled: true, name: 'PRIVATE_OIDC' },
    { id: 14, protocol: 'saml', enabled: null, name: 'PRIVATE_NULL' },
  ];
  const table = Object.fromEntries(['id', 'protocol', 'enabled'].map(key => [key, key]));
  let reads = 0;
  const eq = (column, value) => row => row[column] === value;
  const and = (...predicates) => row => predicates.every(predicate => predicate(row));
  const db = {
    select(projection) {
      return { from(actualTable) {
        assert.equal(actualTable, table);
        return { where(predicate) {
          return { async limit(limit) {
            reads++;
            return rows.filter(predicate).slice(0, limit).map(row =>
              Object.fromEntries(Object.entries(projection).map(([key, column]) => [key, row[column]])));
          } };
        } };
      } };
    },
  };
  const imports = [
    'import { and, eq } from "drizzle-orm";',
    'import { db } from "@/db";',
    'import { identityProviders } from "@/db/schema";',
    'import { canonicalAppOrigin } from "@/lib/security-request";',
    'import { buildSamlServiceProviderMetadata } from "@/lib/saml";',
  ];
  let source = routeSource;
  for (const statement of imports) {
    assert.equal(source.split(statement).length, 2, 'Unexpected route import contract: ' + statement);
    source = source.replace(statement, '');
  }
  source = stripTypeScriptTypes(source).replace(/^export /gm, '');
  const load = compileFunction(source + '\nreturn GET;', [
    'and', 'eq', 'db', 'identityProviders', 'canonicalAppOrigin', 'buildSamlServiceProviderMetadata',
  ], { filename: ROUTE });
  const GET = load(and, eq, db, table, () => 'https://payroll.example.test',
    ({ entityId, acsUrl }) => `<EntityDescriptor entityID="${entityId}"><AssertionConsumerService Location="${acsUrl}"/></EntityDescriptor>`);
  const request = async (id, query = '', headers = {}) => {
    const response = await GET(new Request('http://127.0.0.1:3000/api/auth/saml/metadata/' + id + query, { headers }),
      { params: Promise.resolve({ providerId: String(id) }) });
    return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
  };
  return { rows, request, reads: () => reads };
}

test('disabled and nonexistent providers have identical non-cacheable 404 responses', async () => {
  const h = harness();
  const disabled = await h.request(11), missing = await h.request(9999);
  assert.equal(disabled.status, 404);
  assert.deepEqual(disabled, missing);
  assert.equal(disabled.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(disabled.body), { error: 'SAML provider not found.' });
});

test('enabled SAML metadata remains canonical and excludes private provider fields', async () => {
  const h = harness(), before = structuredClone(h.rows);
  const result = await h.request(12);
  assert.equal(result.status, 200);
  assert.match(result.headers['content-type'], /application\/samlmetadata\+xml/);
  assert.match(result.body, /entityID="https:\/\/payroll\.example\.test\/api\/auth\/saml\/metadata\/12"/);
  assert.match(result.body, /Location="https:\/\/payroll\.example\.test\/api\/auth\/saml\/acs\/12"/);
  assert.doesNotMatch(result.body, /PRIVATE_|FICTIONAL_SECRET/);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.headers['x-content-type-options'], 'nosniff');
  assert.deepEqual(h.rows, before);
});

test('OIDC and null-enabled records cannot reveal provider existence', async () => {
  const h = harness(), missing = await h.request(9999);
  assert.equal(missing.status, 404);
  assert.deepEqual(await h.request(13), missing);
  assert.deepEqual(await h.request(14), missing);
});

test('forged query and header selectors cannot make a disabled provider visible', async () => {
  const h = harness(), before = structuredClone(h.rows);
  const query = '?providerId=12&organizationId=777&enabled=true&protocol=saml';
  const headers = { 'x-organization-id': '777', 'x-tenant-id': '777', 'x-provider-id': '12', cookie: 'session=fictional-not-authentication' };
  const result = await h.request(11, query, headers);
  assert.equal(result.status, 404);
  assert.deepEqual(result, await h.request(9999));
  assert.deepEqual(await h.request(12, query, headers), await h.request(12));
  assert.deepEqual(h.rows, before);
});

test('invalid provider IDs are rejected before any database selection', async () => {
  const h = harness();
  for (const id of ['not-an-id', '1.5']) assert.equal((await h.request(id)).status, 400);
  assert.equal(h.reads(), 0);
});

test('disabling a provider removes its metadata on the next request', async () => {
  const h = harness();
  assert.equal((await h.request(12)).status, 200);
  h.rows.find(row => row.id === 12).enabled = false;
  const disabled = await h.request(12);
  assert.equal(disabled.status, 404);
  assert.equal(disabled.headers['cache-control'], 'no-store');
  assert.deepEqual(disabled, await h.request(9999));
});
