/**
 * Dedicated proof for the six pre-login methods: GET and POST setup, POST intake-challenge, POST signup,
 * POST signup/resend and POST signup/verify. None of them has a signed-in employer, so the tenant boundary is restated:
 * a caller may create or activate ONLY the workspace its own request describes, and nothing it sends (forged
 * organization, user, role, plan or seat fields, another address's proof or token, a registered address) may read,
 * change or activate any existing employer.
 *
 * Production-mode localhost HTTP on disposable PG16. First-run setup creates the bootstrap employer; six fillers and a
 * populated victim are then seeded; two independent applicants A and B register through the real routes. A registers
 * before the victim exists (so the victim's IDs exceed A's and six), B after. Verification links are read from the
 * loopback mail this process hosts for the address they were sent to, never from the database and never through a file.
 *
 * Every existing employer (bootstrap, victim, and the other applicant) is compared table by table before and after each
 * group of refused or foreign-aimed requests. Fictional data only; no provider, worker or payment is enabled.
 * This is a proof, not a credit: coverageCredits is 0 and independent review is not claimed.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  PRELOGIN_METHODS, PRELOGIN_TITLE, assertNoSession, assertRefusal, assertRowsUnchanged, clientAddresses, mailedTokens,
  requireDisposablePrelogin, sessionCookieOf, solveIntakeProof,
} from "./tenant-prelogin-contract.mjs";
import { startPreloginSmtpSink } from "./tenant-prelogin-smtp-sink.mjs";

export async function verifyPreloginTenantIsolation() {
  // No database or application import may run before this guard.
  requireDisposablePrelogin();
  const [{ db, pool }, schema, { eq }, fixture] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const { organizations, subscriptions, userOrganizations, users } = schema;
  const { seedEmployer, standaloneMakeSession } = fixture;
  const BASE = process.env.SECURITY_SMOKE_URL;
  // The loopback sink lives in this process, so a verification link reaches the proof in memory, as a mail client would see it.
  const MAIL = [];
  const sink = await startPreloginSmtpSink(MAIL);
  const nextAddress = clientAddresses();

  /** Real HTTP. Every request names its own verified client address unless one is given, so rate limits never collide. */
  async function req(path, { method = "GET", body, cookie, ip = nextAddress(), headers = {}, sameOrigin = true } = {}) {
    const sent = { "x-forwarded-for": ip, ...headers };
    if (cookie) sent.cookie = cookie;
    if (method !== "GET" && sameOrigin) Object.assign(sent, { origin: BASE, "sec-fetch-site": "same-origin" });
    if (body !== undefined) sent["content-type"] = "application/json";
    const response = await fetch(new URL(path, BASE), {
      method, headers: sent, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", cache: "no-store",
    });
    const text = await response.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, text, json, headers: response.headers };
  }
  const crossSite = (path, body) => req(path, {
    method: "POST", body, sameOrigin: false, headers: { origin: "https://attacker.example.test", "sec-fetch-site": "cross-site" },
  });
  const count = async (table) => Number((await pool.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n);
  const totals = async () => ({ organizations: await count("organizations"), users: await count("users"),
    memberships: await count("user_organizations"), subscriptions: await count("subscriptions"),
    verifications: await count("saas_signup_verifications"), sessions: await count("sessions") });

  try {
    assert.equal(await count("users"), 0, "PRELOGIN_PROOF_REFUSED: genuinely empty disposable users required");
    assert.equal(await count("organizations"), 0, "PRELOGIN_PROOF_REFUSED: genuinely empty disposable organizations required");
    assert.equal(MAIL.length, 0, "PRELOGIN_PROOF_REFUSED: the loopback mailbox must start empty");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 8);
    const PASSWORD = "Fictional-" + nonce + "-Pass9";
    const SETUP = "/api/setup";

    // ================= GET and POST setup: only the holder of the setup token, only on an empty instance =================
    const fresh = await req(SETUP);
    assert.equal(fresh.status, 200);
    assert.deepEqual(fresh.json, { needsSetup: true, setupProtected: true }, "an empty production instance reports setup as needed and protected");
    const setupBody = { companyName: "PRE-BOOT-" + nonce + " employer", name: "PRE-BOOT-" + nonce + " owner",
      email: "pre-boot-" + nonce + "@example.invalid", password: PASSWORD };
    assertRefusal(await req(SETUP, { method: "POST", body: setupBody }), 401);
    assertRefusal(await req(SETUP, { method: "POST", body: { ...setupBody, setupToken: "wrong-" + nonce } }), 401);
    assertRefusal(await req(SETUP, { method: "POST", body: setupBody, headers: { "x-setup-token": "wrong-" + nonce } }), 401);
    assertRefusal(await crossSite(SETUP, { ...setupBody, setupToken: process.env.SETUP_TOKEN }), 403);
    assertRefusal(await req(SETUP, { method: "POST", body: { ...setupBody, setupToken: process.env.SETUP_TOKEN }, sameOrigin: false }), 403);
    assertRefusal(await req(SETUP, { method: "POST", body: { ...setupBody, password: "short", setupToken: process.env.SETUP_TOKEN } }), 422);
    assert.deepEqual(await totals(), { organizations: 0, users: 0, memberships: 0, subscriptions: 0, verifications: 0, sessions: 0 },
      "every refused setup attempt must leave the instance empty");
    // One client address is limited to five attempts an hour, counted before the token is even read.
    const hammer = nextAddress();
    for (let attempt = 1; attempt <= 5; attempt++) assertRefusal(await req(SETUP, { method: "POST", body: setupBody, ip: hammer }), 401);
    assertRefusal(await req(SETUP, { method: "POST", body: { ...setupBody, setupToken: process.env.SETUP_TOKEN }, ip: hammer }), 429);
    assert.equal(await count("users"), 0, "a rate-limited setup with the genuine token must create nothing");

    // The real first-run setup: forged identity fields in the body are ignored.
    const created = await req(SETUP, { method: "POST", body: { ...setupBody, setupToken: process.env.SETUP_TOKEN,
      organizationId: 4242, role: "superadmin", plan: "Enterprise", totpEnabled: true } });
    assert.equal(created.status, 201, "own setup: " + created.text.slice(0, 300));
    const bootCookie = sessionCookieOf(created, "setup");
    const [bootOrg] = await db.select().from(organizations);
    const [bootOwner] = await db.select().from(users);
    assert.equal(created.json.organizationId, bootOrg.id);
    assert.equal(bootOrg.name, setupBody.companyName);
    assert.equal(bootOrg.plan, "Core", "a forged plan is ignored");
    assert.notEqual(bootOrg.id, 4242, "a forged organization ID is ignored");
    assert.equal(bootOwner.email, setupBody.email);
    assert.equal(bootOwner.role, "owner", "a forged role is ignored");
    assert.equal(bootOwner.totpEnabled, false, "a forged MFA state is ignored");
    assert.deepEqual(await totals(), { organizations: 1, users: 1, memberships: 1, subscriptions: 0, verifications: 0, sessions: 1 },
      "setup creates exactly one employer, one owner, one membership and one session");
    const me = await req("/api/auth/me", { cookie: bootCookie });
    assert.equal(me.json?.user?.email, setupBody.email, "the setup session belongs to the new owner");
    const done = await req(SETUP);
    assert.deepEqual(done.json, { needsSetup: false, setupProtected: true });
    // Setup is single-use: even the genuine token cannot create a second employer or replace the owner.
    const again = await req(SETUP, { method: "POST", body: { ...setupBody, email: "pre-second-" + nonce + "@example.invalid" },
      headers: { "x-setup-token": process.env.SETUP_TOKEN } });
    assertRefusal(again, 409);
    assertNoSession(again, "repeated setup");
    assert.deepEqual(await totals(), { organizations: 1, users: 1, memberships: 1, subscriptions: 0, verifications: 0, sessions: 1 });
    const boot = { org: bootOrg, owner: bootOwner, marker: "PRE-BOOT-" + nonce };

    // ================= Fixtures and snapshots =================
    for (let pad = 0; pad < 6; pad++) await seedEmployer("PAD" + pad, nonce, standaloneMakeSession);
    const orgTables = (await pool.query(`SELECT table_name FROM information_schema.columns
      WHERE table_schema='public' AND column_name='organization_id' ORDER BY table_name`)).rows.map((row) => row.table_name);
    for (const needed of ["audit_events", "employees", "outbox", "subscriptions", "user_organizations", "saas_signup_verifications", "legal_entities"]) {
      assert.ok(orgTables.includes(needed), "snapshot must cover " + needed);
    }
    /** Everything that belongs to one employer: every organization-scoped table, the organization row, its owner and the owner's sessions. */
    const snapshot = async (e) => {
      const state = {};
      for (const name of orgTables) {
        assert.match(name, /^[a-z_0-9]+$/);
        state[name] = (await pool.query(`SELECT to_jsonb(t) AS row FROM "${name}" t WHERE organization_id=$1 ORDER BY to_jsonb(t)::text`, [e.org.id])).rows.map((row) => row.row);
      }
      state.organization = (await pool.query(`SELECT to_jsonb(o) AS row FROM organizations o WHERE o.id=$1`, [e.org.id])).rows.map((row) => row.row);
      state.owner = (await pool.query(`SELECT to_jsonb(u) AS row FROM users u WHERE u.id=$1`, [e.owner.id])).rows.map((row) => row.row);
      state.owner_sessions = (await pool.query(`SELECT to_jsonb(s) - 'last_seen_at' AS row FROM sessions s WHERE s.user_id=$1 ORDER BY s.id`, [e.owner.id])).rows.map((row) => row.row);
      return state;
    };
    const INTAKE = "/api/intake-challenge", SIGNUP = "/api/signup", RESEND = "/api/signup/resend", VERIFY = "/api/signup/verify";

    /** A genuine, solved intake proof for one address, issued by the real route. */
    async function proofFor(email) {
      // A proof expires at its five-minute window boundary. Never start one in the last 20 seconds of a window.
      const untilBoundary = 300_000 - (Date.now() % 300_000);
      if (untilBoundary < 20_000) await new Promise((resolve) => setTimeout(resolve, untilBoundary + 500));
      const issued = await req(INTAKE, { method: "POST", body: { email } });
      assert.equal(issued.status, 200, "intake challenge: " + issued.text.slice(0, 200));
      assert.equal(issued.json.enabled, true);
      assert.equal(issued.json.difficulty, 16);
      assert.match(issued.headers.get("cache-control") ?? "", /no-store/);
      return { token: issued.json.token, nonce: solveIntakeProof(issued.json.token) };
    }
    const applicant = (key) => ({ key, marker: "PRE-" + key + "-" + nonce, email: "pre-" + key.toLowerCase() + "-" + nonce + "@example.invalid" });
    const signupBody = (who, extra = {}) => ({ name: who.marker + " owner", company: who.marker + " employer", email: who.email,
      password: PASSWORD, acceptTerms: true, ...extra });
    /** Load the employer one applicant's signup created, by the applicant's own address. */
    async function workspaceOf(who) {
      const [owner] = await db.select().from(users).where(eq(users.email, who.email));
      assert.ok(owner, who.key + ": the applicant's owner row must exist");
      const memberships = await db.select().from(userOrganizations).where(eq(userOrganizations.userId, owner.id));
      assert.equal(memberships.length, 1, who.key + ": the applicant belongs to exactly one employer");
      const [org] = await db.select().from(organizations).where(eq(organizations.id, memberships[0].organizationId));
      return { ...who, owner, org, membership: memberships[0] };
    }

    // ================= POST intake-challenge =================
    const a = applicant("A"), b = applicant("B");
    assertRefusal(await req(INTAKE, { method: "POST", body: { email: "not-an-address" } }), 422);
    assertRefusal(await crossSite(INTAKE, { email: a.email }), 403);
    assertRefusal(await req(INTAKE, { method: "POST", body: { email: a.email }, sameOrigin: false }), 403);
    const bootBefore = await snapshot(boot);

    // ================= POST signup: applicant A, before the victim exists =================
    const before = await totals();
    // The proof is bound to the address it was issued for, and a signup without one is refused.
    const proofForOther = await proofFor("pre-other-" + nonce + "@example.invalid");
    assertRefusal(await req(SIGNUP, { method: "POST", body: signupBody(a, { intakeProof: proofForOther }) }), 422);
    assertRefusal(await req(SIGNUP, { method: "POST", body: signupBody(a) }), 422);
    assertRefusal(await req(SIGNUP, { method: "POST", body: signupBody(a, { intakeProof: { token: "forged.0000", nonce: 1 } }) }), 422);
    assertRefusal(await crossSite(SIGNUP, signupBody(a, { intakeProof: await proofFor(a.email) })), 403);
    assertRefusal(await req(SIGNUP, { method: "POST", body: signupBody(a, { intakeProof: await proofFor(a.email), acceptTerms: false }) }), 422);
    assert.deepEqual(await totals(), before, "refused registrations must create nothing");
    assert.equal(MAIL.length, 0, "refused registrations must send no mail");

    /** The real registration, carrying every forged field an applicant could add. */
    async function register(who, forged) {
      const proof = await proofFor(who.email);
      const startTotals = await totals();
      const response = await req(SIGNUP, { method: "POST", body: signupBody(who, { intakeProof: proof, ...forged }) });
      assert.equal(response.status, 202, who.key + " own signup: " + response.text.slice(0, 300));
      assertNoSession(response, who.key + " signup");
      assert.equal(response.json.delivery, "accepted_by_provider", who.key + ": the loopback sink accepted the verification mail");
      const now = await totals();
      assert.deepEqual(now, { ...startTotals, organizations: startTotals.organizations + 1, users: startTotals.users + 1,
        memberships: startTotals.memberships + 1, subscriptions: startTotals.subscriptions + 1, verifications: startTotals.verifications + 1 },
        who.key + ": a signup creates exactly one employer, owner, membership, subscription and pending verification, and no session");
      const made = await workspaceOf(who);
      assert.equal(made.org.name, who.marker + " employer");
      assert.equal(made.org.plan, "Core", who.key + ": a forged plan is ignored in pilot mode");
      assert.equal(made.owner.role, "owner", who.key + ": a forged role is ignored");
      assert.equal(made.owner.active, false, who.key + ": the owner stays inactive until the address is verified");
      assert.equal(made.owner.totpEnabled, false);
      assert.equal(made.membership.role, "owner");
      const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, made.org.id));
      assert.deepEqual([subscription.status, subscription.provider, subscription.seatLimit, subscription.amountCents, subscription.plan],
        ["trialing", "pilot", 10, 0, "Core"], who.key + ": forged seats and plan cannot buy or enlarge a subscription");
      // The same proof cannot be replayed for a second registration.
      assertRefusal(await req(SIGNUP, { method: "POST", body: signupBody(who, { intakeProof: proof }) }), 422);
      // The unverified owner cannot sign in with the password just chosen.
      const login = await req("/api/auth/login", { method: "POST", body: { email: who.email, password: PASSWORD } });
      assertRefusal(login, 401);
      assertNoSession(login, who.key + " login before verification");
      const tokens = mailedTokens(MAIL, who.email);
      assert.equal(tokens.length, 1, who.key + ": exactly one verification link reached the applicant's own mailbox");
      return { ...made, token: tokens[0] };
    }
    const registeredA = await register(a, {});
    assertRowsUnchanged(bootBefore, await snapshot(boot), "the bootstrap employer after A's registration");

    // The victim is created after A, so every victim ID exceeds A's and six.
    const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
    assert.ok(victim.org.id > Math.max(registeredA.org.id, 6) && victim.owner.id > Math.max(registeredA.owner.id, 6) && victim.worker.id > 6,
      "the victim employer must be a real higher-ID row");
    const forbidden = [victim.marker, victim.owner.email, victim.worker.employeeNo];
    const victimBefore = await snapshot(victim);
    const mustStayUnchanged = async (label, others = []) => {
      assertRowsUnchanged(victimBefore, await snapshot(victim), "victim after " + label);
      assertRowsUnchanged(bootBefore, await snapshot(boot), "bootstrap employer after " + label);
      for (const [name, was, e] of others) assertRowsUnchanged(was, await snapshot(e), name + " after " + label);
    };

    // ================= POST signup: applicant B, with the victim in place and every forged selector =================
    const registeredB = await register(b, { organizationId: victim.org.id, userId: victim.owner.id, role: "admin", active: true,
      plan: "Enterprise", seats: 2000, totpEnabled: true, legalEntityId: victim.entity.id });
    assert.notEqual(registeredB.org.id, victim.org.id, "a forged organization ID never attaches an applicant to an existing employer");
    assert.equal((await db.select().from(userOrganizations).where(eq(userOrganizations.organizationId, victim.org.id))).length, 1,
      "the victim keeps exactly its own member");
    await mustStayUnchanged("B's registration");

    // A registered address cannot be re-registered: an existing employer's owner keeps their password, and gets no mail.
    for (const taken of [victim.owner.email, boot.owner.email]) {
      const mailBefore = MAIL.length, at = await totals();
      const response = await req(SIGNUP, { method: "POST", body: { ...signupBody(a), email: taken, intakeProof: await proofFor(taken) } });
      assert.equal(response.status, 202, "a registered address gets the generic answer");
      assertNoSession(response, "signup with a registered address");
      for (const marker of forbidden) assert.ok(!response.text.includes(marker));
      assert.deepEqual(await totals(), at, "a registered address creates nothing");
      assert.equal(MAIL.length, mailBefore, "a registered address is sent nothing");
    }
    await mustStayUnchanged("signups naming registered addresses");
    // An address whose verification is still PENDING is protected too: a second registration cannot take over the account,
    // change its password or company, or mail a new link. (The unverified registration itself is never replaced or expired;
    // that is the recorded address-squatting finding, not something this proof closes.)
    {
      const pending = await workspaceOf(b), mailBefore = MAIL.length, at = await totals();
      const takeover = await req(SIGNUP, { method: "POST", body: { ...signupBody(b), company: "PRE-TAKEOVER-" + nonce, password: "Takeover-" + nonce + "-Pass9",
        intakeProof: await proofFor(b.email) } });
      assert.equal(takeover.status, 202);
      assertNoSession(takeover, "re-registration of a pending address");
      assert.deepEqual(await totals(), at, "re-registering a pending address creates nothing");
      assert.equal(MAIL.length, mailBefore, "re-registering a pending address sends nothing");
      const still = await workspaceOf(b);
      assert.equal(still.owner.passwordHash, pending.owner.passwordHash, "the pending owner's password is unchanged");
      assert.equal(still.org.name, pending.org.name, "the pending employer's name is unchanged");
      const login = await req("/api/auth/login", { method: "POST", body: { email: b.email, password: "Takeover-" + nonce + "-Pass9" } });
      assertRefusal(login, 401);
      assertNoSession(login, "login with the would-be takeover password");
    }
    // One client address is limited to four registrations an hour, counted before the body is read.
    const flood = nextAddress(), atFlood = await totals();
    for (let attempt = 1; attempt <= 4; attempt++) assertRefusal(await req(SIGNUP, { method: "POST", body: { email: "x" }, ip: flood }), 422);
    assertRefusal(await req(SIGNUP, { method: "POST", body: signupBody(applicant("C"), { intakeProof: await proofFor(applicant("C").email) }), ip: flood }), 429);
    assert.deepEqual(await totals(), atFlood, "a rate-limited registration creates nothing");

    // ================= POST signup/resend =================
    const aBefore = await snapshot(registeredA), bBefore = await snapshot(registeredB);
    const generic = await req(RESEND, { method: "POST", body: { email: "pre-nobody-" + nonce + "@example.invalid" } });
    assert.equal(generic.status, 200);
    // Verified, foreign and unknown addresses all get the same answer and no mail; nothing changes for anyone.
    for (const address of [victim.owner.email, boot.owner.email, "not-an-address"]) {
      const mailBefore = MAIL.length;
      const response = await req(RESEND, { method: "POST", body: { email: address, organizationId: victim.org.id, userId: victim.owner.id } });
      assert.equal(response.status, 200);
      assert.equal(response.text, generic.text, "resend must answer identically for an unknown, a verified and a foreign address");
      assert.equal(MAIL.length, mailBefore, "resend sends nothing for an address with no pending verification");
    }
    assertRefusal(await crossSite(RESEND, { email: a.email }), 403);
    await mustStayUnchanged("resend refusals", [["applicant A", aBefore, registeredA], ["applicant B", bBefore, registeredB]]);
    // B's own resend: a new link reaches B's mailbox only, the old link dies, and A is untouched.
    const resent = await req(RESEND, { method: "POST", body: { email: b.email, organizationId: victim.org.id } });
    assert.equal(resent.status, 200);
    assert.equal(resent.text, generic.text);
    const bTokens = mailedTokens(MAIL, b.email);
    assert.equal(bTokens.length, 2, "B's resend delivered exactly one more link, to B");
    assert.notEqual(bTokens[1], registeredB.token);
    assert.equal(mailedTokens(MAIL, a.email).length, 1, "B's resend sends A nothing");
    await mustStayUnchanged("B's own resend", [["applicant A", aBefore, registeredA]]);
    const bAfterResend = await snapshot(registeredB);

    // ================= POST signup/verify =================
    const atVerify = await totals();
    for (const bad of ["", "nope", "g".repeat(48), "0".repeat(48), registeredB.token]) {
      const response = await req(VERIFY, { method: "POST", body: { token: bad, userId: victim.owner.id, organizationId: victim.org.id } });
      assertRefusal(response, 422, forbidden);
      assertNoSession(response, "refused verification");
    }
    assertRefusal(await crossSite(VERIFY, { token: registeredA.token }), 403);
    assert.deepEqual(await totals(), atVerify, "refused verifications create no session and activate nobody");
    await mustStayUnchanged("refused verifications", [["applicant A", aBefore, registeredA], ["applicant B", bAfterResend, registeredB]]);
    assert.equal((await workspaceOf(b)).owner.active, false, "B's superseded link must not activate B");

    /** The real activation: only the token's own owner becomes active, and the session it issues is that owner's. */
    async function activate(who, token, others) {
      const response = await req(VERIFY, { method: "POST", body: { token, userId: victim.owner.id, organizationId: victim.org.id, role: "admin" } });
      assert.equal(response.status, 200, who.key + " own verification: " + response.text.slice(0, 300));
      assert.deepEqual(response.json, { ok: true, redirectTo: "/app" });
      const cookie = sessionCookieOf(response, who.key + " verification");
      const now = await workspaceOf(who);
      assert.equal(now.owner.active, true, who.key + ": the verified owner is active");
      assert.equal(now.owner.role, "owner", who.key + ": a forged role is ignored");
      const whoami = await req("/api/auth/me", { cookie });
      assert.equal(whoami.json?.user?.email, who.email, who.key + ": the session belongs to the verified owner, never to a forged user ID");
      // The link is single-use.
      const reused = await req(VERIFY, { method: "POST", body: { token } });
      assertRefusal(reused, 422);
      assertNoSession(reused, who.key + " reused link");
      // The new session reaches its own employer and is refused the victim's and the bootstrap employer's.
      const own = await req("/api/employees?organizationId=" + now.org.id, { cookie });
      assert.equal(own.status, 200, who.key + " own directory: " + own.text.slice(0, 200));
      for (const foreign of [victim, boot]) {
        assertRefusal(await req("/api/employees?organizationId=" + foreign.org.id, { cookie }), 403, forbidden);
      }
      await mustStayUnchanged(who.key + "'s activation", others);
      return { ...now, cookie };
    }
    const activeA = await activate(a, registeredA.token, [["applicant B", bAfterResend, registeredB]]);
    assert.equal((await workspaceOf(b)).owner.active, false, "A's link must not activate B");
    const aAfter = await snapshot(activeA);
    const activeB = await activate(b, bTokens[1], [["applicant A", aAfter, activeA]]);
    // An activated address has no pending verification left to resend.
    const mailBefore = MAIL.length;
    assert.equal((await req(RESEND, { method: "POST", body: { email: a.email } })).text, generic.text);
    assert.equal(MAIL.length, mailBefore, "a verified address is sent no further link");
    await mustStayUnchanged("the complete run");
    assert.equal((await db.select().from(userOrganizations).where(eq(userOrganizations.organizationId, victim.org.id))).length, 1);
    assert.ok(MAIL.every((mail) => mail.recipients.length === 1 && [a.email, b.email].includes(mail.recipients[0])),
      "mail went only to the two applicants' own addresses");

    console.log(JSON.stringify({
      proof: PRELOGIN_TITLE, methods: PRELOGIN_METHODS, postgresMajor: 16,
      realFirstRunSetup: 1, realRegistrations: 2, realActivations: 2, realResends: 1,
      independentApplicants: 2, victimHigherThanFirstApplicantAndSix: true, forgedSelectorsIgnored: true,
      registeredAddressesProtected: 2, verificationLinksReadFromRecipientMailboxOnly: true,
      existingEmployersByteIdentical: ["bootstrap", "victim", "other applicant"],
      bootstrapEmployerId: boot.org.id, victimEmployerId: victim.org.id, applicantEmployerIds: [activeA.org.id, activeB.org.id],
      knownFindingsNotClosedByThisProof: ["an unverified registration is never replaced or expired (address squatting)",
        "the signup answer differs between a new and a registered address (enumeration)"],
      providerMode: "loopback-smtp-sink-only", externalProviderCalled: false, paidEnrollmentExercised: false,
      coverageCredits: 0, independentlyAccepted: false, independentSecurityReview: "PENDING",
    }));
  } finally {
    await new Promise((resolve) => sink.close(resolve));
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].replaceAll("\\", "/").endsWith("scripts/qa/tenant-prelogin-http.mjs")) {
  await verifyPreloginTenantIsolation();
}
