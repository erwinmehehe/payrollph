import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { organizations, subscriptions, userOrganizations, users } from "@/db/schema";
import { saasSignupVerifications } from "@/lib/saas-billing-schema";
import { signupMode, signupRateLimitResponse } from "@/lib/saas-launch-config";
import { validPrivatePilotInvite } from "@/lib/private-pilot-invite";
import { deliveryCapable } from "@/lib/mail-provider";
import { isSellablePlan, safeSeats, subscriptionQuote } from "@/lib/saas-pricing";
import { getPublicPricingPlans } from "@/lib/pricing-catalog";
import { randomToken, sha256, hashPassword } from "@/lib/crypto";
import { normalizeEmail, passwordIssues, validEmail } from "@/lib/tokens";
import { queueMessage } from "@/lib/mailer";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { canonicalAppOrigin, enforceSameOriginMutation } from "@/lib/security-request";
import { recordAuditEvent } from "@/lib/audit";
import { enforceIntakeProof } from "@/lib/public-intake-proof-server";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import {
  expiredUnverifiedSignup, isSignupEmailConflict, PENDING_SIGNUP_MAX_AGE_MS,
  signupAcceptedResponse, signupLockKey,
} from "@/lib/signup-pending-recovery";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const startedAt = Date.now();
  const denied = enforceSameOriginMutation(request);
  if (denied) return denied;
  const mode = signupMode();
  if (mode === "disabled") {
    return Response.json({ error: "Company registration is temporarily unavailable. Please try again later." }, { status: 503 });
  }
  const ip = clientIp(request);
  const limited = await rateLimitDistributed("signup:" + ip, { limit: 4, windowMs: 60 * 60_000 });
  const ipRateGate = signupRateLimitResponse(limited);
  if (ipRateGate) return ipRateGate;

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const company = typeof body.company === "string" ? body.company.trim() : "";
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  // A pilot creates a temporary, non-billable Core workspace with 10 seats.
  // Client-supplied paid plan and seats are ignored in this mode.
  const isPilot = mode === "pilot";
  const inviteCode = isPilot && typeof body.privatePilotInviteCode === "string"
    ? body.privatePilotInviteCode.trim()
    : "";
  const invitedPilot = isPilot && inviteCode.length > 0
    && validPrivatePilotInvite(email, inviteCode);
  const plan = isPilot ? "Core" : body.plan;
  const seats = isPilot ? 10 : safeSeats(body.seats);
  const acceptTerms = body.acceptTerms === true;
  const problems = [
    ...(name.length < 2 || name.length > 120 ? ["Enter your full name (2–120 characters)."] : []),
    ...(company.length < 2 || company.length > 160 ? ["Enter a company name (2–160 characters)."] : []),
    ...(!validEmail(email) || email.length > 180 ? ["Enter a valid work email."] : []),
    ...passwordIssues(password),
    ...(!isPilot && !isSellablePlan(plan) ? ["Choose a paid employer plan."] : []),
    ...(!isPilot && !seats ? ["Choose between 1 and 2,000 employee seats."] : []),
    ...(!acceptTerms ? [isPilot ? "Accept the pilot evaluation terms to continue." : "Accept the subscription billing terms to continue."] : []),
  ];
  if (problems.length) return Response.json({ error: "Check your registration details.", problems }, { status: 422 });
  // Only the explicitly invited email/code pair may skip outbound email
  // verification. A public applicant without email delivery always fails closed.
  if (isPilot && inviteCode && !invitedPilot) {
    return Response.json({ error: "Invalid or expired private pilot invitation. Check the email and invitation code." }, { status: 422 });
  }
  if (isPilot && !deliveryCapable() && !invitedPilot) {
    return Response.json({ error: "A private pilot invitation code is required to create an account right now." }, { status: 422 });
  }
  const proofDenied = await enforceIntakeProof(body, email);
  if (proofDenied) return proofDenied;
  if (criticalReleaseFlagEnabled("publicIntakeProof")) {
    const byDomain = await rateLimitDistributed("signup-domain:" + sha256(email.split("@")[1]), { limit: 50, windowMs: 24 * 60 * 60_000 });
    const domainRateGate = signupRateLimitResponse(byDomain, "Too many registration requests. Please try later.");
    if (domainRateGate) return domainRateGate;
  }

  const byEmail = await rateLimitDistributed("signup-email:" + sha256(email), { limit: 3, windowMs: 24 * 60 * 60_000 });
  const emailRateGate = signupRateLimitResponse(byEmail, "Too many registration requests. Please try later.");
  if (emailRateGate) return emailRateGate;
  let origin: string;
  try { origin = canonicalAppOrigin(request); }
  catch { return Response.json({ error: "Registration URL is not configured." }, { status: 503 }); }

  let quote: { plan: string; seats: number; amountCents: number };
  if (isPilot) {
    quote = { plan: "Core", seats: 10, amountCents: 0 };
  } else {
    const catalog = await getPublicPricingPlans();
    const selected = catalog.find((row) => row.name === plan && row.active);
    if (!selected || !seats) return Response.json({ error: "The selected plan is unavailable." }, { status: 422 });
    quote = subscriptionQuote(selected, seats);
  }
  const trialEndsAt = isPilot ? new Date(Date.now() + 14 * 86_400_000) : null;
  // Existing and new addresses perform the same password work.
  const passwordHash = hashPassword(password);
  const token = invitedPilot ? null : randomToken(24);
  let created: { userId: number; organizationId: number } | null = null;
  try {
    created = await db.transaction(async (tx) => {
      // Serialize signup attempts for absent as well as present email rows.
      await tx.execute(sql`select pg_advisory_xact_lock(${signupLockKey(email)}::bigint)`);
      const [existing] = await tx.select({ id: users.id }).from(users)
        .where(eq(users.email, email)).limit(1);
      if (existing) {
        // Verification also locks the verification row BEFORE the user row.
        // Reversing this order can deadlock a valid activation and a duplicate signup.
        const [verification] = await tx.select({
          id: saasSignupVerifications.id,
          createdAt: saasSignupVerifications.createdAt,
          verifiedAt: saasSignupVerifications.verifiedAt,
        }).from(saasSignupVerifications)
          .where(eq(saasSignupVerifications.userId, existing.id)).limit(1).for("update");
        if (!verification) return null;
        const [owner] = await tx.select({ active: users.active, role: users.role }).from(users)
          .where(and(eq(users.id, existing.id), eq(users.email, email))).limit(1).for("update");
        if (!owner || owner.role !== "owner" || !expiredUnverifiedSignup({
          active: owner.active, verifiedAt: verification.verifiedAt, createdAt: verification.createdAt,
        })) return null;
        const cutoff = new Date(Date.now() - PENDING_SIGNUP_MAX_AGE_MS);
        const [expired] = await tx.update(saasSignupVerifications)
          .set({ tokenHash: sha256(randomToken(24)), expiresAt: new Date(0) })
          .where(and(eq(saasSignupVerifications.id, verification.id),
            isNull(saasSignupVerifications.verifiedAt),
            lte(saasSignupVerifications.createdAt, cutoff)))
          .returning({ id: saasSignupVerifications.id });
        if (!expired) return null;
        // Keep employer/audit history. This tombstone is not a valid email and
        // cannot be registered publicly; neither old password nor token grants access.
        const [released] = await tx.update(users).set({ email: "__expired_signup_" + existing.id })
          .where(and(eq(users.id, existing.id), eq(users.email, email), eq(users.active, false)))
          .returning({ id: users.id });
        if (!released) throw new Error("Expired signup could not be released atomically.");
      }
      const [org] = await tx.insert(organizations).values({
        name: company, legalName: company, accountType: "business",
        plan: quote.plan, employeeCount: 0, color: "#176B5D",
      }).returning({ id: organizations.id });
      const [owner] = await tx.insert(users).values({
        name, email, passwordHash, role: "owner", active: invitedPilot,
        totpEnabled: false, backupCodes: [],
      }).returning({ id: users.id });
      await tx.insert(userOrganizations).values({
        organizationId: org.id, userId: owner.id, role: "owner", active: true,
      });
      await tx.insert(subscriptions).values({
        organizationId: org.id, plan: quote.plan,
        status: isPilot ? "trialing" : "pending_payment", seatLimit: quote.seats,
        billingCycle: "monthly", amountCents: quote.amountCents, currency: "PHP",
        provider: isPilot ? "pilot" : null, trialEndsAt,
        periodStart: isPilot ? new Date() : null,
      });
      if (token) {
        await tx.insert(saasSignupVerifications).values({
          organizationId: org.id, userId: owner.id, tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + 60 * 60_000),
        });
      }
      return { userId: owner.id, organizationId: org.id };
    });
  } catch (error) {
    // Other account-creation routes may win the unique-email race.
    if (isSignupEmailConflict(error)) return signupAcceptedResponse(startedAt);
    throw error;
  }
  if (!created) return signupAcceptedResponse(startedAt);
  if (invitedPilot) {
    await recordAuditEvent({
      organizationId: created.organizationId, actor: "private-pilot-invitation",
      action: "Single-recipient fictional-data pilot provisioned",
      resource: "Owner activated by private invitation; email ownership unverified",
      metadata: {
        registrationMode: "pilot", emailVerified: false, inviteBoundToEmail: true,
        selectedPlan: "Core", seats: 10, amountCents: 0,
        trialEndsAt: trialEndsAt?.toISOString() ?? null,
      },
    });
    return signupAcceptedResponse(startedAt);
  }
  if (!token) return Response.json({ error: "Unable to initialize email verification." }, { status: 503 });
  const sent = await queueMessage({
    organizationId: created.organizationId, recipient: email,
    subject: "Verify your Linaw company account", purpose: "signup-email-verification",
    body: [
      "Verify your email address to activate your Linaw company login.",
      isPilot
        ? "Your Core pilot workspace runs for 14 days with 10 employee seats. No card or payment is required. Use fictional/test data only."
        : "No payment has been collected, and no subscription is active yet.",
      "", origin + "/verify-signup?token=" + token, "",
      "This verification link can be used once and expires after 60 minutes.",
      "If you did not request an account, ignore this email.",
    ].join("\n"),
  });
  await recordAuditEvent({
    organizationId: created.organizationId, actor: name,
    action: "Company owner signup requested", resource: "Email verification pending",
    metadata: { registrationMode: mode, selectedPlan: quote.plan, seats: quote.seats,
      amountCents: quote.amountCents, trialEndsAt: trialEndsAt?.toISOString() ?? null, deliveryStatus: sent.status },
  });
  return signupAcceptedResponse(startedAt);
}
