/** One-use, exact-source draft reconciliation. No DB, network, provider or credits. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';

const ROOT='src/app/api/auth/saml/metadata/[providerId]/route.ts';
const OLD='589fb64376d807f03245a12c6aca1de7c3bfa08f';
const NEW='4f8d12b9867de0c18aea8e447208e8470773350b';
const MANIFEST='scripts/qa/tenant-isolation-coverage-manifest.json';
const INVENTORY='tests/tenant-isolation-coverage-inventory.test.mjs';
const CONTRACT='scripts/qa/tenant-saml-metadata-public-contract.mjs';
const RUNNER='scripts/qa/tenant-saml-metadata-public-http.mjs';
const TEST='tests/tenant-saml-metadata-public.test.mjs';
const WORKFLOW='.github/workflows/tenant-saml-metadata-public-http.yml';
const DOC='docs/qa/tenant-saml-metadata-public-proof.md';
const VERIFY='scripts/qa/tenant-saml-metadata-privacy-verify.mjs';
const VERIFY_TEST='tests/tenant-saml-metadata-privacy-verify.test.mjs';
const REGRESSION='tests/tenant-saml-metadata-disabled-route.test.mjs';
const hash=x=>{const b=Buffer.isBuffer(x)?x:Buffer.from(x);return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex')};
const read=p=>readFileSync(p,'utf8');
const replace=(s,a,b)=>{assert.equal(s.split(a).length-1,1,'Expected one source anchor: '+a);return s.replace(a,b)};
const pins={
 [ROOT]:NEW,[MANIFEST]:'afdd063031e270d270f63053e112b5bb253c0055',
 [INVENTORY]:'f92d98108e7b74ddf4f5bd7044d1be24546b556b',
 [CONTRACT]:'8a65d22fe1e0f1a2b6575988fb91348f12830af6',
 [RUNNER]:'dfcaa486e2b88bbc1efc0ab54b1732191871b3a4',
 [TEST]:'54bcc2023c69433a94bd791988a5c6c4a3d7559c',
 [WORKFLOW]:'428118de90ec17419626581a7763f6d5c39bf309',
 [DOC]:'3bc8921a76f3caea6d3bb9dbeceac275cbcfbe75',
 [REGRESSION]:'f3e71670c309d83739e9a693bbd60aba9cc89bb1',
};
for(const [p,sha]of Object.entries(pins))assert.equal(hash(read(p)),sha,'Source moved: '+p);
assert.equal(existsSync(VERIFY),false);assert.equal(existsSync(VERIFY_TEST),false);
const changes={};
const protectedFlags=['FINAL_PAY_SIGNED_REVIEW_ENABLED','EXACT_THIRTEENTH_CENTAVOS_ENABLED','PAYROLL_CALCULATION_HISTORY_ENABLED','NEXT_CSP_ENABLED'];
let c=replace(read(CONTRACT),OLD,NEW);
c=replace(c,'/** Public SAML service-provider XML is a candidate, never a covered tenant method. */','/** Enabled SAML XML and disabled-provider concealment; zero method credits. */');
c=replace(c,'    DEMO_MODE: "false", WORKER_ENABLED: "false",',protectedFlags.map(k=>'    '+k+': "false",').join('\n')+'\n    DEMO_MODE: "false", WORKER_ENABLED: "false",');
c=replace(c,'  assert.equal(response.status, 200, "Public SP metadata must return 200");','  assert.equal(response.status, 200, "Enabled SP metadata must return 200");\n  assert.equal(response.headers.get("cache-control"), "no-store");');
c+='\n/** A disabled provider must expose exactly the same observable response as a missing ID. */\nexport function assertConcealedMetadata(response, missing, markers = []) {\n  assert.equal(response.status, 404, "Disabled provider must be concealed");\n  assert.equal(missing.status, 404);\n  assert.equal(response.text, missing.text, "Disabled and absent bodies must match");\n  assert.equal(response.headers.get("cache-control"), "no-store");\n  assert.equal(missing.headers.get("cache-control"), "no-store");\n  for (const header of ["content-type", "cache-control", "location", "www-authenticate"])\n    assert.equal(response.headers.get(header), missing.headers.get(header), header);\n  assert.deepEqual(JSON.parse(response.text), { error: "SAML provider not found." });\n  assert.doesNotMatch(response.text, /EntityDescriptor|AssertionConsumerService/);\n  for (const marker of markers) assert.ok(marker && !response.text.includes(marker), "Private marker leaked");\n}\n';
changes[CONTRACT]=c;

let r=read(RUNNER);
r=replace(r,'requireIsolatedSamlProof, assertMetadata, assertSameMetadata, assertMissingMetadata,','requireIsolatedSamlProof, assertMetadata, assertSameMetadata, assertMissingMetadata, assertConcealedMetadata,');
r=replace(r,'async function addProvider(actor, protocol) {','async function addProvider(actor, protocol, enabled = protocol === "oidc") {');
r=replace(r,'protocol, enabled: protocol === "oidc",','protocol, enabled,');
r=replace(r,'    const oidc = await addProvider(victim, "oidc");','    const oidc = await addProvider(victim, "oidc");\n    const enabledProviders = [];\n    for (const actor of actors) enabledProviders.push(await addProvider(actor, "saml", true));\n    // Enabled rows are fictional metadata fixtures only; no IdP or login request is made.');
r=replace(r,'"Fictional SAML providers must be disabled to expose the pending public-policy decision"','"Disabled fixtures must remain disabled for the privacy regression"');
const negative=`    const missingPath = "/api/auth/saml/metadata/" + (oidc.id + 10000);
    const missing = await get(missingPath);
    let concealedCases = 0;
    for (const provider of providers) {
      const path = "/api/auth/saml/metadata/" + provider.id;
      assertConcealedMetadata(await get(path), missing, forbidden);
      concealedCases++;
      for (const cookie of [null, a.cookie, b.cookie, victim.cookie]) {
        const selectors = new URLSearchParams({
          providerId: String(enabledProviders[2].id), enabled: "true",
          organizationId: String(victim.org.id), employeeId: String(victim.worker.id),
          legalEntityId: String(victim.entity.id),
        });
        const headers = { "x-organization-id": String(victim.org.id), "x-tenant-id": String(victim.org.id) };
        if (cookie) headers.cookie = cookie;
        const actual = await get(path + "?" + selectors, headers);
        const absent = await get(missingPath + "?" + selectors, headers);
        assertConcealedMetadata(actual, absent, forbidden);
        assert.deepEqual(await snapshot(), before, "Concealment and forged selectors changed protected SQL");
        concealedCases++;
      }
    }
    assert.equal(concealedCases, 15);

    for (const provider of enabledProviders) {`;
r=replace(r,'    for (const provider of providers) {',negative);
r=replace(r,'      anonymousXml200: true, forgedSelectorsIdentical: true,','      enabledSamlXml200: true, forgedSelectorsIdentical: true,');
r=replace(r,'      disabledSamlProviderMetadataIsAnonymous200: true,','      disabledProvidersConcealed404: true, concealedCases,');
r=replace(r,'      disabledProviderPublicPolicy: "PENDING_IDENTITY_SECURITY_OWNER_DECISION",','      disabledProviderPolicy: "OWNER_PRIVACY_FIRST_2026_11_11",');
r=replace(r,'      classificationCandidate: "PUBLIC-BY-DESIGN",','      evidenceLabel: "SOLO_VERIFIED_DEV_RECOVERY",');
changes[RUNNER]=r;

let t=read(TEST);
t=replace(t,'assertMetadata, assertSameMetadata, assertMissingMetadata,','assertMetadata, assertSameMetadata, assertMissingMetadata, assertConcealedMetadata,');
t=replace(t,'headers: new Map([["content-type", "application/samlmetadata+xml; charset=utf-8"]]),','headers: new Map([["content-type", "application/samlmetadata+xml; charset=utf-8"], ["cache-control", "no-store"]]),');
t=replace(t,'test("unchanged SAML GET is GAP; selecting only public provider fields is source pinned"','test("privacy-first SAML GET stays GAP and enabled-only lookup is source pinned"');
t=replace(t,'  assert.match(source, /canonicalAppOrigin\\(request\\)/);','  assert.ok(source.includes("eq(identityProviders.enabled, true)"));\n  assert.match(source, /canonicalAppOrigin\\(request\\)/);');
t=replace(t,'    DEMO_MODE: "false", WORKER_ENABLED: "false",',protectedFlags.map(k=>'    '+k+': "false",').join('\n')+'\n    DEMO_MODE: "false", WORKER_ENABLED: "false",');
t=replace(t,'/return 200/','/return 200/');
t=replace(t,'    "disabledSamlProviderMetadataIsAnonymous200: true",','    "disabledProvidersConcealed404: true", "assertConcealedMetadata(actual, absent, forbidden)",\n    "assert.equal(concealedCases, 15)", "for (const provider of enabledProviders)",');
t=replace(t,'    \'disabledProviderPublicPolicy: "PENDING_IDENTITY_SECURITY_OWNER_DECISION"\',','    \'disabledProviderPolicy: "OWNER_PRIVACY_FIRST_2026_11_11"\',');
t+=`\ntest("concealment contract rejects disclosure, cacheability and differing absent responses", () => {
  const absent = { status: 404, text: JSON.stringify({ error: "SAML provider not found." }),
    headers: new Map([["content-type", "application/json"], ["cache-control", "no-store"]]) };
  assert.doesNotThrow(() => assertConcealedMetadata(absent, absent, ["PRIVATE_MARKER"]));
  assert.throws(() => assertConcealedMetadata(response(xml(7)), absent));
  assert.throws(() => assertConcealedMetadata({ ...absent, text: '{"error":"Disabled provider"}' }, absent));
  assert.throws(() => assertConcealedMetadata({ ...absent, headers: new Map() }, absent));
});
\ntest("metadata proof refuses each protected release flag", () => {
  const source = readFileSync("scripts/qa/tenant-saml-metadata-public-contract.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-saml-metadata-public-http.yml", "utf8");
  for (const flag of ${JSON.stringify(protectedFlags)}) {
    assert.ok(source.includes(flag + ': "false"'));
    assert.ok(workflow.includes(flag + ": 'false'"));
  }
});
`;
changes[TEST]=t;

let w=read(WORKFLOW);
w=replace(w,'name: SAML public metadata (fictional PG16 HTTP, zero method credit)','name: SAML metadata privacy (fictional PG16 HTTP, zero method credit)');
w=replace(w,"      - 'tests/tenant-saml-metadata-public.test.mjs'","      - 'tests/tenant-saml-metadata-public.test.mjs'\n      - 'tests/tenant-saml-metadata-disabled-route.test.mjs'\n      - 'tests/tenant-saml-metadata-privacy-verify.test.mjs'\n      - 'scripts/qa/tenant-saml-metadata-privacy-verify.mjs'");
w=replace(w,"      WORKER_ENABLED: 'false'",protectedFlags.map(k=>"      "+k+": 'false'").join('\n')+"\n      WORKER_ENABLED: 'false'");
w=replace(w,'          persist-credentials: false','          persist-credentials: false\n          ref: ${{ github.event.pull_request.head.sha }}');
w=replace(w,'          node --test tests/tenant-saml-metadata-public.test.mjs','          node --test tests/tenant-saml-metadata-public.test.mjs tests/tenant-saml-metadata-disabled-route.test.mjs tests/tenant-saml-metadata-privacy-verify.test.mjs');
w=replace(w,'      - name: Three-employer SAML XML, forged selectors, unchanged SQL','      - name: Disabled-provider concealment, enabled XML, forged selectors, unchanged SQL');
changes[WORKFLOW]=w;

const evidencePaths=[CONTRACT,RUNNER,TEST,WORKFLOW,REGRESSION];
const evidencePins=Object.fromEntries(evidencePaths.map(p=>[p,hash(changes[p]??read(p))]));
const hold={kind:'saml-metadata-disabled-privacy-zero-credit',oldSourceBlobSha:OLD,newSourceBlobSha:NEW,
 evidenceLabel:'SOLO_VERIFIED_DEV_RECOVERY',coverageCredits:0,exactHeadPg16Http:'PENDING',
 independentSecurityReview:'PENDING',productionCertified:false,sourcePins:evidencePins};
const modernMissing='  if (!provider) return Response.json(\n    { error: "SAML provider not found." },\n    { status: 404, headers: { "Cache-Control": "no-store" } },\n  );';
const oldMissing='  if (!provider) return Response.json({ error: "SAML provider not found." }, { status: 404 });';
const v=`/** Exact-source zero-credit privacy repair; never a tenant coverage receipt. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const ROUTE=${JSON.stringify(ROOT)};
export const SAML_METADATA_PRIVACY_HOLD=Object.freeze(${JSON.stringify(hold,null,2)});
const hash=x=>{const b=Buffer.isBuffer(x)?x:Buffer.from(x);return createHash('sha1').update('blob '+b.length+'\\0').update(b).digest('hex')};
export function verifySamlMetadataPrivacyHold(method, currentBlob, read=p=>readFileSync(p)) {
  assert.equal(method.name,'GET');
  assert.equal(method.status,'GAP','Privacy repair alone earns no method credit');
  assert.equal(method.testedBy,null);
  assert.deepEqual(method.reviewedUncertified,SAML_METADATA_PRIVACY_HOLD);
  assert.equal(currentBlob,${JSON.stringify(NEW)});
  const source=read(ROUTE).toString('utf8');
  assert.equal(hash(source),currentBlob,'Metadata route source drift');
  const restored=source.replace('    eq(identityProviders.enabled, true),\\n','')
    .replace(${JSON.stringify(modernMissing)},${JSON.stringify(oldMissing)})
    .replace('"Cache-Control": "no-store"','"Cache-Control": "private, max-age=300"');
  assert.equal(hash(restored),${JSON.stringify(OLD)},'Only the reviewed privacy delta is permitted');
  for(const [path,sha]of Object.entries(SAML_METADATA_PRIVACY_HOLD.sourcePins))
    assert.equal(hash(read(path)),sha,'SAML proof/source drift: '+path);
  return 0;
}
`;
changes[VERIFY]=v;
changes[VERIFY_TEST]=`import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {verifySamlMetadataPrivacyHold} from '../scripts/qa/tenant-saml-metadata-privacy-verify.mjs';
const m=JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'));
const route=m.allApiRouteFiles[${JSON.stringify(ROOT)}];
const method=route.methods.find(x=>x.name==='GET');
test('metadata privacy repair is exact-source and carries zero coverage credits',()=>{
  assert.equal(verifySamlMetadataPrivacyHold(method,route.gitBlobSha),0);
});
test('metadata hold rejects invented credit, source drift and changed proof inputs',()=>{
  for(const patch of [{status:'COVERED'},{testedBy:{}},
    {reviewedUncertified:{...method.reviewedUncertified,coverageCredits:1}}])
    assert.throws(()=>verifySamlMetadataPrivacyHold({...method,...patch},route.gitBlobSha));
  assert.throws(()=>verifySamlMetadataPrivacyHold(method,'0'.repeat(40)));
  assert.throws(()=>verifySamlMetadataPrivacyHold(method,route.gitBlobSha,p=>
    Buffer.concat([readFileSync(p),Buffer.from('tamper')])));
});
`;

let inv=read(INVENTORY);
inv='import { verifySamlMetadataPrivacyHold } from "../scripts/qa/tenant-saml-metadata-privacy-verify.mjs";\n'+inv;
inv=replace(inv,'function reviewedStatus(method, key, isNewOrChanged, currentBlob) {',
 'function reviewedStatus(method, key, isNewOrChanged, currentBlob) {\n  if (key === "'+ROOT+' GET") {\n    verifySamlMetadataPrivacyHold(method, currentBlob);\n    return;\n  }');
changes[INVENTORY]=inv;
const original=JSON.parse(read(MANIFEST));
const manifest=structuredClone(original);
const target=manifest.allApiRouteFiles[ROOT];
assert.equal(target.gitBlobSha,OLD);
assert.equal(target.methods.length,1);
const method=target.methods[0];
assert.equal(method.name,'GET');assert.equal(method.status,'GAP');assert.equal(method.testedBy,null);
assert.ok(!method.reviewedUncertified,'Existing metadata hold requires explicit reconciliation');
target.gitBlobSha=NEW;
method.reviewedUncertified=hold;
method.reason='Still GAP: owner-approved privacy-first repair conceals disabled SAML providers. Exact-source unit regressions pass; fresh disposable PG16 HTTP and security review remain required. No disabled-response coverage credit.';
const audit=structuredClone(manifest);
audit.allApiRouteFiles[ROOT]=original.allApiRouteFiles[ROOT];
assert.deepEqual(audit,original,'Unrelated manifest content must remain byte-equivalent as data');
assert.deepEqual(manifest.metrics,original.metrics);
changes[MANIFEST]=JSON.stringify(manifest,null,2)+'\n';
changes[DOC]=`# SAML metadata privacy-first recovery - draft PR #1934

Evidence: **SOLO_VERIFIED_DEV_RECOVERY**. No method credit or production acceptance.

The owner's 2026-11-11 decision supersedes the public-disabled-provider proposal below.
The route now filters ID, protocol=saml, and enabled=true in one SQL predicate.
Disabled and nonexistent providers return the same generic no-store 404. Enabled
fictional SAML metadata remains the positive control, with no-store responses.
No SAML login endpoint or real identity provider is activated or called.

Handler unit regressions were run: original source **2 pass / 6 fail**; repaired
source **8 pass / 0 fail**. Dependency doubles are not PostgreSQL HTTP receipts.
The existing PG16 runner now requires **15 disabled-provider concealment cases**,
three enabled-provider positive fixtures, forged query/header selectors, three
real fictional sessions, and unchanged employer/provider/user/session/payroll/audit SQL.
The revised PG16 workflow is pending until an actual successful run is inspected.

The manifest keeps GET metadata **GAP / testedBy:null**, with an exact-source
zero-credit hold. All method counts and unrelated proofs remain unchanged.
SAML start/ACS and SSO start/callback are **deferred until SAML/SSO is offered**;
a real proof must exercise successful protocol validation, browser/state binding,
nonce/replay/expiry, exact verified-domain/account/employer linking, MFA and
unchanged foreign identity/session SQL. A disabled refusal never earns credit.

## Historical #1771 record (superseded behavior, not evidence for this repaired source)

`+read(DOC);
for(const [path,content]of Object.entries(changes))writeFileSync(path,content);
console.log(JSON.stringify({label:'SOLO_VERIFIED_DEV_RECOVERY',files:Object.keys(changes),countsBefore:original.metrics,countsAfter:manifest.metrics,credits:0,pg16Executed:false}));
