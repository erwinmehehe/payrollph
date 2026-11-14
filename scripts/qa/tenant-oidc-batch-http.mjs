/** Real production Next -> HTTPS IdP -> signed JWKS -> PostgreSQL/session proof.
 * No authentication mocks, transport preloads, TLS disablement or real IdP.
 */
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createServer } from "node:https";
import { lookup } from "node:dns/promises";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { APP, CANONICAL_APP, IDP_HOST, IDP_IP, IDP_ORIGIN, TLS_DIR,
  assertCallbackDenied } from "./tenant-oidc-full-contract.mjs";
import {requireOidcBatchEnv,assertOwnedOidcStart,assertDeniedOidcStart} from './tenant-oidc-batch-contract.mjs';
import {collectOidcBatchInputs} from './tenant-oidc-batch-inputs.mjs';

export async function proveCompleteOidcHttp() {
  requireOidcBatchEnv(); // Before any database/application import.
  assert.match(execFileSync("ip", ["route", "get", IDP_IP], { encoding: "utf8" }), /local .*dev lo/,
    "Synthetic IdP address must route locally, never to an internet interface");
  execFileSync("sudo", ["-n", "iptables", "-C", "OUTPUT", "-d", IDP_IP, "!", "-o", "lo", "-j", "REJECT"]);
  const resolved = await lookup(IDP_HOST, { all: true });
  assert.ok(resolved.length > 0 && resolved.every(row => row.address === IDP_IP));
  const [{ db, pool }, s, { eq, and, asc }, fixture, { encryptEnterpriseSecret,decryptEnterpriseSecret }] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"), import("drizzle-orm"),
    import("./tenant-table-http.mjs"), import("../../src/lib/enterprise-secret.ts"),
  ]);
  const issuers = new Map(), codes = new Map(), events = [];
  const badKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  function jwt(provider, attempt) {
    const now = Math.floor(Date.now() / 1000);
      const claims = { iss: provider.issuer, aud: provider.client, sub: provider.subject,
      email: provider.email, email_verified: true, nonce: attempt.nonce,
      iat: now, exp: now + 300, amr: ["pwd", "mfa"], ...attempt.overrides };
    const part = value => Buffer.from(JSON.stringify(value)).toString("base64url");
    const input = part({ alg: "RS256", kid: provider.kid }) + "." + part(claims);
    return input + "." + sign("RSA-SHA256", Buffer.from(input), attempt.badSignature ? badKey : provider.privateKey).toString("base64url");
  }
  const idp = createServer({ key: readFileSync(TLS_DIR + "/server.key"), cert: readFileSync(TLS_DIR + "/server.crt") }, async (req, res) => {
    const reply = (status, body) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
    try {
      assert.equal(req.socket.localAddress, IDP_IP);
      const url = new URL(req.url, IDP_ORIGIN);
      const [, label, action] = url.pathname.split("/");
      const p = issuers.get(label);
      if (!p) return reply(404, { error: "Unknown fictional issuer" });
      events.push({ label, action, method: req.method });
      if (action === "jwks" && req.method === "GET") return reply(200, { keys: [p.jwk] });
      if (action === "authorize" && req.method === "GET") {
        assert.equal(url.searchParams.get("client_id"), p.client);
        assert.equal(url.searchParams.get("login_hint"), p.email);
        assert.equal(url.searchParams.get("redirect_uri"), CANONICAL_APP + "/api/auth/sso/callback");
        assert.equal(url.searchParams.get("response_type"), "code");
        assert.equal(url.searchParams.get("code_challenge_method"), "S256");
        const code = randomUUID();
        const record = { label, nonce: url.searchParams.get("nonce"), challenge: url.searchParams.get("code_challenge"),
          redirect: url.searchParams.get("redirect_uri"), overrides: {}, badSignature: false, used: false };
        assert.ok(record.nonce && record.challenge);
        codes.set(code, record);
        const back = new URL(record.redirect); back.searchParams.set("code", code); back.searchParams.set("state", url.searchParams.get("state"));
        res.writeHead(302, { location: back.toString(), "cache-control": "no-store" }); return res.end();
      }
      if (action === "token" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) { body += chunk; assert.ok(body.length < 16000); }
        const form = new URLSearchParams(body), attempt = codes.get(form.get("code"));
        if (!attempt || attempt.label !== label || attempt.used) return reply(400, { error: "invalid_grant" });
        assert.equal(form.get("client_id"), p.client);
        assert.equal(form.get("client_secret"), p.secret);
        assert.equal(form.get("grant_type"), "authorization_code");
        assert.equal(form.get("redirect_uri"), attempt.redirect);
        if (createHash("sha256").update(form.get("code_verifier") || "").digest("base64url") !== attempt.challenge)
          return reply(400, { error: "invalid_pkce" });
        attempt.used = true;
        return reply(200, { id_token: jwt(p, attempt), token_type: "Bearer" });
      }
      return reply(404, { error: "Unknown fictional endpoint" });
    } catch { return reply(400, { error: "Synthetic IdP rejected request" }); }
  });
  await new Promise((resolve, reject) => { idp.once("error", reject); idp.listen(8443, IDP_IP, resolve); });
  const request = async (url, cookie) => {
    const r = await fetch(url, { headers: cookie ? { cookie } : {}, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15000) });
    const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = null; }
    return { status: r.status, headers: r.headers, text, json };
  };
  const encode = value => encodeURIComponent(String(value));
  const plain = value => JSON.parse(JSON.stringify(value));
  try {
    const version = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(version >= 160000 && version < 170000);
    for (const table of [s.organizations, s.identityProviders, s.oidcLoginStates])
      assert.equal((await db.select().from(table).limit(1)).length, 0, "Fresh empty fictional schema is required");
    const nonce = randomUUID().slice(0, 8);
    const padding = [];
    for (let i = 0; i < 7; i++) padding.push(await fixture.seedEmployer("OIDCPAD" + i, nonce, fixture.standaloneMakeSession));
    async function employer(label) {
      const e = await fixture.seedEmployer(label, nonce, fixture.standaloneMakeSession);
      const domain = label.toLowerCase() + "-" + nonce + ".example.invalid";
      const email = "owner@" + domain;
      await db.update(s.users).set({ email }).where(eq(s.users.id, e.owner.id));
      const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const issuer = IDP_ORIGIN + "/" + label, client = "client-" + label, secret = "fictional-" + randomUUID();
      const kid = "key-" + label;
      const [provider] = await db.insert(s.identityProviders).values({ organizationId: e.org.id, name: "Fictional " + label,
        protocol: "oidc", enabled: true, clientId: client, clientSecretEncrypted: encryptEnterpriseSecret(secret),
        issuer, authorizationEndpoint: issuer + "/authorize", tokenEndpoint: issuer + "/token", jwksUri: issuer + "/jwks" }).returning();
      await db.insert(s.identityDomains).values({ organizationId: e.org.id, providerId: provider.id, domain,
        verified: true, verifiedAt: new Date(), verificationTokenHash: "fictional-" + nonce + label });
      const p = { ...e, label, provider, domain, email, issuer, client, secret, privateKey, kid,
        subject: "subject-" + label, jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" } };
      issuers.set(label, p); return p;
    }
    const a = await employer("OIDCA"), b = await employer("OIDCB"), v = await employer("OIDCVICTIM");
    assert.ok(v.org.id > Math.max(a.org.id, b.org.id, 6) && v.provider.id > Math.max(a.provider.id, b.provider.id));
    for (const e of [a, v]) await db.insert(s.externalIdentities).values({ organizationId: e.org.id,
      providerId: e.provider.id, userId: e.owner.id, subject: e.subject, email: e.email, lastLoginAt: new Date("2000-01-01") });
    const identitySnapshot = async () => {
      const out = {};
      for (const name of ["users", "userOrganizations", "externalIdentities", "sessions", "auditEvents"])
        out[name] = plain(await db.select().from(s[name]).orderBy(asc(s[name].id)));
      return out;
    };
    const victimSnapshot = async () => {
      const out = {};
      const tables = (await pool.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='organization_id' ORDER BY table_name")).rows;
      for (const { table_name: table } of tables) {
        assert.match(table, /^[a-z_][a-z0-9_]*$/);
        out[table] = (await pool.query(`SELECT to_jsonb(t) AS row FROM "${table}" t WHERE organization_id=$1 ORDER BY to_jsonb(t)::text`, [v.org.id])).rows;
      }
      out.victimUser = plain(await db.select().from(s.users).where(eq(s.users.id, v.owner.id)));
      out.victimSessions = plain(await db.select().from(s.sessions).where(eq(s.sessions.userId, v.owner.id)).orderBy(asc(s.sessions.id)));
      return out;
    };
    let validatedStarts=0,startDenials=0;
    async function begin(e) {
      const protectedBefore=await identitySnapshot(),victimBefore=await victimSnapshot();
      const statesBefore=plain(await db.select().from(s.oidcLoginStates).orderBy(asc(s.oidcLoginStates.id)));
      const other=e===v?a:v;
      const start = await request(APP + "/api/auth/sso/start?providerId=" + e.provider.id + "&loginHint=" + encode(e.email)+
        '&organizationId='+other.org.id+'&userId='+other.owner.id,e.cookie);
      const expectedRedirect=assertOwnedOidcStart(start,e);
      assert.deepEqual(await identitySnapshot(),protectedBefore,'Start must not authenticate, relink accounts or write audit');
      assert.deepEqual(await victimSnapshot(),victimBefore,'Own start changed protected victim SQL');
      const stateHash=createHash('sha256').update(expectedRedirect.searchParams.get('state')).digest('hex');
      const statesAfter=plain(await db.select().from(s.oidcLoginStates).orderBy(asc(s.oidcLoginStates.id)));
      const created=statesAfter.filter(row=>!statesBefore.some(old=>old.id===row.id));assert.equal(created.length,1);
      const row=created[0];assert.equal(row.stateHash,stateHash);assert.equal(row.providerId,e.provider.id);
      assert.equal(row.loginHint,e.email);assert.equal(row.nonce,expectedRedirect.searchParams.get('nonce'));
      assert.equal(row.redirectUri,CANONICAL_APP+'/api/auth/sso/callback');assert.equal(row.usedAt,null);
      assert.equal(createHash('sha256').update(decryptEnterpriseSecret(row.codeVerifier)).digest('base64url'),
        expectedRedirect.searchParams.get('code_challenge'));
      assert.ok(new Date(row.expiresAt)>new Date());
      for(const old of statesBefore){const retained=statesAfter.find(x=>x.id===old.id);
        if(retained)assert.deepEqual(retained,old,'Start changed an existing browser state');
        else assert.ok(new Date(old.expiresAt)<new Date(),'Only expired state cleanup is allowed');}
      validatedStarts++;
      const cookie = start.headers.getSetCookie().find(value => value.startsWith("linaw_oidc_browser_state="))?.split(";")[0];
      assert.ok(cookie, "Own start must set the initiating browser cookie");
      const authorize = start.headers.get("location");
      assert.ok(authorize.startsWith(e.issuer + "/authorize?"));
      // TLS and the IdP's authorize endpoint are real HTTPS, not dependency doubles.
      const auth = await request(authorize);
      assert.equal(auth.status, 302);
      const back = new URL(auth.headers.get("location"));
      const code = back.searchParams.get("code"), state = back.searchParams.get("state");
      assert.ok(codes.has(code));
      return { e, cookie, code, state, url: APP + back.pathname + back.search };
    }
    const startFlows=new Map();
    for(const e of [a,b,v])startFlows.set(e.org.id,await begin(e));
    let malformedStartDenials=0;
    for(const e of [a,b]){
      for(const [provider,email]of [[v.provider,e.email],[e.provider,v.email]]){
        const before=await identitySnapshot(),victimBefore=await victimSnapshot();
        const states=plain(await db.select().from(s.oidcLoginStates).orderBy(asc(s.oidcLoginStates.id))),eventCount=events.length;
        const refused=await request(APP+'/api/auth/sso/start?providerId='+provider.id+'&loginHint='+encode(email),e.cookie);
        assertDeniedOidcStart(refused,403,[v.provider.name,v.email,v.marker]);
        assert.deepEqual(await identitySnapshot(),before);assert.deepEqual(await victimSnapshot(),victimBefore);
        assert.deepEqual(plain(await db.select().from(s.oidcLoginStates).orderBy(asc(s.oidcLoginStates.id))),states);
        assert.equal(events.length,eventCount,'Foreign start must not contact any IdP');startDenials++;
      }
      const prefix='/api/auth/sso/start?',hint='&loginHint='+encode(e.email);
      const invalid=[
        prefix+'providerId='+e.provider.id+'&providerId='+v.provider.id+hint,
        prefix+'providerId='+e.provider.id+'&providerId='+e.provider.id+hint,
        prefix+'providerId='+e.provider.id+hint+'&loginHint='+encode(v.email),
        prefix+'providerId=0'+e.provider.id+hint,prefix+'providerId='+e.provider.id+'e0'+hint,
        prefix+'providerId='+e.provider.id+'.0'+hint,prefix+'loginHint='+encode(e.email),
        prefix+'providerId='+e.provider.id+'&loginHint='+encode('worker@@'+e.domain),
      ];
      for(const path of invalid){
        const before=await identitySnapshot(),victimBefore=await victimSnapshot();
        const states=plain(await db.select().from(s.oidcLoginStates).orderBy(asc(s.oidcLoginStates.id))),eventCount=events.length;
        const malformed=await request(APP+path,e.cookie);
        assertDeniedOidcStart(malformed,400,[v.provider.name,v.email,v.marker]);
        assert.deepEqual(await identitySnapshot(),before);assert.deepEqual(await victimSnapshot(),victimBefore);
        assert.deepEqual(plain(await db.select().from(s.oidcLoginStates).orderBy(asc(s.oidcLoginStates.id))),states);
        assert.equal(events.length,eventCount);malformedStartDenials++;
      }
    }
    let denied = 0, ownLogins = 0, discriminator = 0;
    async function reject(flow, status, { cookie = flow.cookie, url = flow.url, claimsState = true } = {}) {
      const before = await identitySnapshot(), victimBefore = await victimSnapshot();
      const states = plain(await db.select().from(s.oidcLoginStates).orderBy(asc(s.oidcLoginStates.id)));
      const response = await request(url, cookie);
      assertCallbackDenied(response, status);
      assert.deepEqual(await identitySnapshot(), before, "Denied callback changed identity, membership, account, session or audit SQL");
      assert.deepEqual(await victimSnapshot(), victimBefore, "Denied callback changed victim SQL");
      const after = plain(await db.select().from(s.oidcLoginStates).orderBy(asc(s.oidcLoginStates.id)));
      for (const row of after) {
        const old = states.find(x => x.id === row.id);
        if (claimsState && row.stateHash === createHash("sha256").update(flow.state).digest("hex")) {
          assert.ok(row.usedAt); row.usedAt = old.usedAt;
        }
      }
      assert.deepEqual(after, states, "Only the attempted one-use state may be consumed");
      denied++; return response;
    }
    // Each actor's actual signed login must establish its OWN identity and MFA
    // session despite forged employer/provider/account selectors in the callback.
    const victimBefore = await victimSnapshot();
    for (const e of [a, b]) {
      const flow = startFlows.get(e.org.id);
      const url = flow.url + "&organizationId=" + v.org.id + "&providerId=" + v.provider.id + "&userId=" + v.owner.id;
      const response = await request(url, flow.cookie);
      assert.equal(response.status, 302, "Own callback must authenticate: " + String(response.json?.error || response.status));
      const authCookie = response.headers.getSetCookie().find(value => value.startsWith("__Host-linaw_session="))?.split(";")[0];
      assert.ok(authCookie, "A valid signed own login must issue a real session");
      const raw = authCookie.slice(authCookie.indexOf("=") + 1);
      const [session] = await db.select().from(s.sessions).where(eq(s.sessions.tokenHash, createHash("sha256").update(raw).digest("hex")));
      assert.equal(session.userId, e.owner.id); assert.equal(session.identityProviderId, e.provider.id);
      assert.equal(session.authMethod, "oidc"); assert.ok(session.mfaVerifiedAt);
      const [link] = await db.select().from(s.externalIdentities).where(and(eq(s.externalIdentities.providerId, e.provider.id), eq(s.externalIdentities.subject, e.subject)));
      assert.equal(link.organizationId, e.org.id); assert.equal(link.userId, e.owner.id);
      assert.ok(link.lastLoginAt.getFullYear() > 2000);
      const own = await request(APP + "/api/employees?organizationId=" + e.org.id, authCookie);
      assert.equal(own.status, 200, "OIDC session must authorize a real own API read: " + own.text.slice(0, 100));
      assert.ok(own.text.includes(e.worker.employeeNo)); assert.ok(!own.text.includes(v.worker.employeeNo));
      const foreign = await request(APP + "/api/employees?organizationId=" + v.org.id, authCookie);
      assert.equal(foreign.status, 403); discriminator++;
      const loginAudit = await db.select().from(s.auditEvents).where(and(eq(s.auditEvents.organizationId, e.org.id), eq(s.auditEvents.action, "SSO sign-in completed")));
      assert.equal(loginAudit.length, 1); assert.equal(loginAudit[0].metadata.providerId, e.provider.id);
      await reject(flow, 400, { claimsState: false }); // Captured cookie cannot replay a consumed state/code.
      ownLogins++;
    }
    assert.deepEqual(await victimSnapshot(), victimBefore);
    // A real victim login is a legitimate comparator. Borrowing its state/code
    // with either attacker's browser cookie must fail before token exchange.
    const victimFlow = startFlows.get(v.org.id);
    for (const e of [a, b]) {
      const ownFlow = await begin(e), count = events.length;
      await reject(victimFlow, 403, { cookie: ownFlow.cookie, claimsState: false });
      assert.equal(events.length, count, "Foreign browser refusal must precede IdP contact");
      const peer = await begin(e === a ? b : a);
      await reject(ownFlow, 401, { url: ownFlow.url.replace(encode(ownFlow.code), encode(peer.code)) });
      assert.equal(codes.get(peer.code).used, false, "A mismatched client cannot consume the peer's code");
    }
    // Authentic RSA/JWKS verification must reject signed-but-wrong claims and
    // forged signatures; each attempt starts through real HTTP and PKCE.
    for (const e of [a, b]) {
      for (const overrides of [ { iss: v.issuer }, { aud: v.client }, { nonce: "wrong-nonce" },
        { exp: 1 }, { email_verified: false }, { email: v.email } ]) {
        const flow = await begin(e); codes.get(flow.code).overrides = overrides;
        await reject(flow, overrides.email === v.email ? 403 : 401);
      }
      const signature = await begin(e); codes.get(signature.code).badSignature = true;
      await reject(signature, 401);
      const pkce = await begin(e);
      await db.update(s.oidcLoginStates).set({ codeVerifier: encryptEnterpriseSecret("incorrect-verifier") })
        .where(eq(s.oidcLoginStates.stateHash, createHash("sha256").update(pkce.state).digest("hex")));
      await reject(pkce, 401);
      const revoked = await begin(e);
      await db.update(s.userOrganizations).set({ active: false }).where(and(eq(s.userOrganizations.userId, e.owner.id), eq(s.userOrganizations.organizationId, e.org.id)));
      await reject(revoked, 403);
      await db.update(s.userOrganizations).set({ active: true }).where(and(eq(s.userOrganizations.userId, e.owner.id), eq(s.userOrganizations.organizationId, e.org.id)));
      const disabled = await begin(e);
      await db.update(s.identityProviders).set({ enabled: false }).where(eq(s.identityProviders.id, e.provider.id));
      const count = events.length; await reject(disabled, 403); assert.equal(events.length, count);
      await db.update(s.identityProviders).set({ enabled: true }).where(eq(s.identityProviders.id, e.provider.id));
      const singleFactorFlow = await begin(e); codes.get(singleFactorFlow.code).overrides = { amr: ["pwd"] };
      await db.insert(s.organizationSecurityPolicies).values({ organizationId: e.org.id, requireMfa: true });
      await reject(singleFactorFlow, 403);
      await db.delete(s.organizationSecurityPolicies).where(eq(s.organizationSecurityPolicies.organizationId, e.org.id));
      const inherited = await begin(e); codes.get(inherited.code).overrides = { amr: ["pwd"] };
      await db.insert(s.userOrganizations).values({ userId: e.owner.id, organizationId: padding[0].org.id, role: "owner", active: true });
      await db.insert(s.organizationSecurityPolicies).values({ organizationId: padding[0].org.id, requireMfa: true });
      await reject(inherited, 403);
      await db.delete(s.organizationSecurityPolicies).where(eq(s.organizationSecurityPolicies.organizationId, padding[0].org.id));
      await db.delete(s.userOrganizations).where(and(eq(s.userOrganizations.userId,e.owner.id),eq(s.userOrganizations.organizationId,padding[0].org.id)));
      const domain = await begin(e);
      await db.update(s.identityDomains).set({ verified: false }).where(eq(s.identityDomains.providerId,e.provider.id));
      await reject(domain,403);
      await db.update(s.identityDomains).set({ verified: true }).where(eq(s.identityDomains.providerId,e.provider.id));
      const inactive = await begin(e);
      await db.update(s.users).set({ active: false }).where(eq(s.users.id,e.owner.id));
      await reject(inactive,403);
      await db.update(s.users).set({ active: true }).where(eq(s.users.id,e.owner.id));
      const emailChanged = await begin(e); codes.get(emailChanged.code).overrides = { email: "changed@"+e.domain };
      await reject(emailChanged,409);
      const unknown = await begin(e); codes.get(unknown.code).overrides = { sub: "unprovisioned", email: "unprovisioned@"+e.domain };
      await reject(unknown,403);
      const noBrowser = await begin(e), eventCount = events.length;
      await reject(noBrowser,403,{cookie:"",claimsState:false}); assert.equal(events.length,eventCount);
      const expired = await begin(e);
      await db.update(s.oidcLoginStates).set({ expiresAt:new Date(0) }).where(eq(s.oidcLoginStates.stateHash,createHash("sha256").update(expired.state).digest("hex")));
      await reject(expired,400,{claimsState:false});
    }
    const corrupt = await begin(a);
    const [aLink] = await db.select().from(s.externalIdentities).where(eq(s.externalIdentities.providerId, a.provider.id));
    await db.update(s.externalIdentities).set({ organizationId: v.org.id }).where(eq(s.externalIdentities.id, aLink.id));
    await reject(corrupt, 409);
    await db.update(s.externalIdentities).set({ organizationId: a.org.id }).where(eq(s.externalIdentities.id, aLink.id));
    // Genuine victim success proves the rejected foreign state was usable by
    // its own browser, rather than a fabricated/nonexistent denial target.
    const victimLogin = await request(victimFlow.url, victimFlow.cookie);
    assert.equal(victimLogin.status, 302); assert.ok(victimLogin.headers.getSetCookie().some(x => x.startsWith("__Host-linaw_session=")));
    assert.equal(ownLogins, 2); assert.equal(discriminator, 2); assert.equal(denied, 43);
    let offRefusals=0;
    async function offSnapshot(){
      const snapshot={identity:await identitySnapshot(),states:plain(await db.select().from(s.oidcLoginStates).orderBy(asc(s.oidcLoginStates.id)))};
      const tables=(await pool.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='organization_id' ORDER BY table_name")).rows;
      for(const {table_name:table}of tables){assert.match(table,/^[a-z_][a-z0-9_]*$/);
        snapshot[table]=(await pool.query('SELECT to_jsonb(t) AS row FROM "'+table+'" t ORDER BY to_jsonb(t)::text')).rows;}
      return snapshot;
    }
    for(const e of [a,b,v]){
      const valid=await begin(e),before=await offSnapshot(),eventsBefore=events.length;
      const controls=[
        ['start','/api/auth/sso/start?providerId='+e.provider.id+'&loginHint='+encode(e.email)],
        ['callback',new URL(valid.url).pathname+new URL(valid.url).search],
        ['resolve','/api/auth/sso/resolve'],
      ];
      let common;
      for(const[action,path]of controls){
        const response=await fetch('http://127.0.0.1:3001'+path,{method:action==='resolve'?'POST':'GET',
          headers:{cookie:valid.cookie,origin:CANONICAL_APP,'sec-fetch-site':'same-origin','content-type':'application/json'},
          ...(action==='resolve'?{body:JSON.stringify({email:e.email})}:{}),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(15000)});
        const body=await response.text();assert.equal(response.status,503,'OFF '+action);
        assert.ok(response.headers.get('cache-control')?.includes('no-store'));assert.equal(response.headers.getSetCookie().length,0);
        if(common===undefined)common=body;else assert.equal(body,common,'All OFF entrypoints must be indistinguishable');
        for(const marker of [e.email,e.provider.name,v.email,v.provider.name])assert.ok(!body.includes(marker));
        assert.deepEqual(await offSnapshot(),before,'OFF entrypoint changed protected identity, browser state or tenant SQL');
        assert.equal(events.length,eventsBefore,'OFF entrypoint contacted the IdP');offRefusals++;
      }
    }
    assert.equal(offRefusals,9);
    const sourceCommit = execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
    const inputs=collectOidcBatchInputs();
    assert.equal(startDenials,4);
    assert.equal(malformedStartDenials,16);
    const receipt = { suite: "oidc-start-callback-batch-https-pg16", methods:['GET auth/sso/start','GET auth/sso/callback'],
      ownStartControls:3,validatedStarts,startDenials,malformedStartDenials,ownLogins, victimOwnLogin: true,offRefusals,
      resolveCreditHeldByOwner:true,
      sourceCommit, inputs, evidenceClassification:"SOLO_VERIFIED_DEV_RECOVERY",
      refusedCallbacks: denied, authenticatedForeignReadsDenied: discriminator, realPkce: true, realRsaJwks: true,
      tlsVerificationEnabled: true, transportMocks: false, ssrfGuardUnchanged: true,
      onlyLocallyRoutedSyntheticIdp: true, realProviderCalls: 0, coverageCredits: 0,
      independentSecurityReview: "PENDING", productionCertified: false };
    const receiptDirectory = mkdtempSync(join(TLS_DIR, "receipt-"));
    writeFileSync(join(receiptDirectory, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx", mode: 0o600 });
    console.log("OIDC_BATCH_HTTP_PASS " + JSON.stringify(receipt));
  } finally {
    await new Promise(resolve => idp.close(resolve)); await pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("tenant-oidc-batch-http.mjs")) await proveCompleteOidcHttp();
