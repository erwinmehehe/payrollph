import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, subscriptions, userOrganizations, users } from "@/db/schema";
import { saasSignupVerifications } from "@/lib/saas-billing-schema";
import { publicSelfServeReady } from "@/lib/saas-launch-config";
import { isSellablePlan, safeSeats, subscriptionQuote } from "@/lib/saas-pricing";
import { getPublicPricingPlans } from "@/lib/pricing-catalog";
import { randomToken, sha256, hashPassword } from "@/lib/crypto";
import { normalizeEmail, passwordIssues, validEmail } from "@/lib/tokens";
import { queueMessage } from "@/lib/mailer";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { canonicalAppOrigin, enforceSameOriginMutation } from "@/lib/security-request";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = enforceSameOriginMutation(request);
  if (denied) return denied;
  if (!publicSelfServeReady()) {
    return Response.json({ error: "Self-service registration is not enabled. Please request trial access." }, { status: 503 });
  }
  const ip = clientIp(request);
  const limited = await rateLimitDistributed("signup:" + ip, { limit: 4, windowMs: 60 * 60_000 });
  if (!limited.allowed) return Response.json({ error: "Too many registration attempts. Please try later." }, { status: 429 });

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const company = typeof body.company === "string" ? body.company.trim() : "";
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const plan = body.plan;
  const seats = safeSeats(body.seats);
  const acceptTerms = body.acceptTerms === true;
  const problems = [
    ...(name.length < 2 || name.length > 120 ? ["Enter your full name (2–120 characters)."] : []),
    ...(company.length < 2 || company.length > 160 ? ["Enter a company name (2–160 characters)."] : []),
    ...(!validEmail(email) || email.length > 180 ? ["Enter a valid work email."] : []),
    ...passwordIssues(password),
    ...(!isSellablePlan(plan) ? ["Choose a paid employer plan."] : []),
    ...(!seats ? ["Choose between 1 and 2,000 employee seats."] : []),
    ...(!acceptTerms ? ["Accept the subscription billing terms to continue."] : []),
  ];
  if (problems.length) return Response.json({ error: "Check your registration details.", problems }, { status: 422 });

  const byEmail = await rateLimitDistributed("signup-email:" + sha256(email), { limit: 3, windowMs: 24 * 60 * 60_000 });
  if (!byEmail.allowed) return Response.json({ error: "Too many registration requests. Please try later." }, { status: 429 });
  let origin: string;
  try { origin = canonicalAppOrigin(request); }
  catch { return Response.json({ error: "Registration URL is not configured." }, { status: 503 }); }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return Response.json({ ok: true, message: "If the address is eligible, check your inbox for the verification link." }, { status: 202 });
  const catalog = await getPublicPricingPlans();
  const selected = catalog.find((row) => row.name === plan);
  if (!selected || !seats) return Response.json({ error: "The selected plan is unavailable." }, { status: 422 });
  const quote = subscriptionQuote(selected, seats);
  const token = randomToken(24);
  let created: { userId: number; organizationId: number } | null = null;
  try {
    created = await db.transaction(async (tx) => {
      const [org] = await tx.insert(organizations).values({
        name: company,
        legalName: company,
        accountType: "business",
        plan: quote.plan,
        employeeCount: 0,
        color: "#176B5D",
      }).returning({ id: organizations.id });
      const [owner] = await tx.insert(users).values({
        name,
        email,
        passwordHash: hashPassword(password),
        role: "owner",
        active: false,
        totpEnabled: false,
        backupCodes: [],
      }).returning({ id: users.id });
      await tx.insert(userOrganizations).values({
        organizationId: org.id,
        userId: owner.id,
        role: "owner",
        active: true,
      });
      await tx.insert(subscriptions).values({
        organizationId: org.id,
        plan: quote.plan,
        status: "pending_payment",
        seatLimit: quote.seats,
        billingCycle: "monthly",
        amountCents: quote.amountCents,
        currency: "PHP",
      });
      await tx.insert(saasSignupVerifications).values({
        organizationId: org.id,
        userId: owner.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      });
      return { userId: owner.id, organizationId: org.id };
    });
  } catch (error) {
    // Another request can win the unique email race; do not reveal account existence.
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      return Response.json({ ok: true, message: "If the address is eligible, check your inbox for the verification link." }, { status: 202 });
    }
    throw error;
  }
  if (!created) return Response.json({ error: "Could not initialize registration." }, { status: 503 });
  const verificationUrl = origin + "/verify-signup?token=" + token;
  const sent = await queueMessage({
    organizationId: created.organizationId,
    recipient: email,
    subject: "Verify your Linaw company account",
    purpose: "signup-email-verification",
    body: [
      "Verify your email address to activate your Linaw company login.",
      "No payment has been collected, and no subscription is active yet.",
      "",
      verificationUrl,
      "",
      "This verification link can be used once and expires after 60 minutes.",
      "If you did not request an account, ignore this email.",
    ].join("\n"),
  });
  await recordAuditEvent({
    organizationId: created.organizationId,
    actor: name,
    action: "Self-service owner signup requested",
    resource: "Email verification pending",
    metadata: { selectedPlan: quote.plan, seats: quote.seats, amountCents: quote.amountCents, deliveryStatus: sent.status },
  });
  return Response.json({
    ok: true, message: "Check your email for a verification link. Your subscription will not start until you authorize payment.",
    delivery: sent.delivered ? "accepted_by_provider" : "not_confirmed",
  }, { status: 202 });
}
