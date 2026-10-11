import {
  notifyMarketingLead,
  recordMarketingLead,
  updateMarketingLeadNotification,
  type MarketingLeadNotificationStatus,
} from "@/lib/marketing-leads";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { sha256 } from "@/lib/crypto";
import { hasMarketingEnquiryConsent, marketingConsentEvidence, marketingHoneypotTripped } from "@/lib/marketing-consent";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { normalizeEmail, validEmail } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const ip = clientIp(request);
  const limited = await rateLimitDistributed(`payroll-outsourcing:${ip}`, {
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });

  if (!limited.allowed) {
    return Response.json({ error: "Too many requests from this address. Try again later." }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) || {};
  if (marketingHoneypotTripped(body)) {
    // A bot filled an invisible field: do not persist a lead or queue an email.
    return Response.json({ ok: true, recorded: false, notified: false }, { headers: { "Cache-Control": "no-store" } });
  }
  const name = String(body.name ?? "").trim().slice(0, 120);
  const email = normalizeEmail(body.email);
  const company = String(body.company ?? "").trim().slice(0, 160);
  const headcount = String(body.headcount ?? "").trim().slice(0, 40);
  const frequency = String(body.frequency ?? "").trim().slice(0, 40);
  const entities = String(body.entities ?? "").trim().slice(0, 40);
  const notes = String(body.notes ?? "").trim().slice(0, 1000);

  const problems: string[] = [];
  if (!hasMarketingEnquiryConsent(body)) problems.push("Please agree to the privacy notice before submitting.");
  if (name.length < 2) problems.push("Your name is required.");
  if (!validEmail(email)) problems.push("A valid work email is required.");
  if (company.length < 2) problems.push("Company name is required.");
  if (!headcount) problems.push("Payroll headcount is required.");
  if (problems.length) {
    return Response.json({ error: "Validation failed.", problems }, { status: 422 });
  }
  // These limits survive attacker-controlled/rotating proxy headers.
  const emailDomain = email.split("@")[1] ?? "";
  const [perEmail, perDomain] = await Promise.all([
    rateLimitDistributed(`public-enquiry-email:${sha256(email)}`, { limit: 5, windowMs: 60 * 60 * 1000 }),
    rateLimitDistributed(`public-enquiry-domain:${sha256(emailDomain)}`, { limit: 50, windowMs: 60 * 60 * 1000 }),
  ]);
  if (!perEmail.allowed || !perDomain.allowed) {
    return Response.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }


  let lead: Awaited<ReturnType<typeof recordMarketingLead>>;
  try {
    lead = await recordMarketingLead({
      kind: "payroll-outsourcing",
      name,
      email,
      company,
      headcount,
      payrollFrequency: frequency,
      entities,
      notes,
      sourcePath: "/payroll-outsourcing",
      attribution: marketingConsentEvidence(),
    });
  } catch (error) {
    console.error("marketing-lead: could not persist payroll outsourcing request", error);
    return Response.json(
      { error: "We could not record your request right now. Please try again shortly." },
      { status: 503 },
    );
  }

  let status: MarketingLeadNotificationStatus = "not-configured";
  try {
    const notification = await notifyMarketingLead(lead.id);
    status = notification.status;
  } catch (error) {
    console.error("marketing-lead: notification failed after durable outsourcing capture", error);
    status = "failed";
    await updateMarketingLeadNotification({ id: lead.id, status }).catch(() => {});
  }

  return Response.json(
    {
      ok: true,
      recorded: true,
      leadId: lead.id,
      notified: status === "sent",
      notificationStatus: status,
    },
    { status: 201 },
  );
}
