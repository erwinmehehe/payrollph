import {
  notifyMarketingLead,
  recordMarketingLead,
  updateMarketingLeadNotification,
  type MarketingLeadKind,
  type MarketingLeadNotificationStatus,
} from "@/lib/marketing-leads";
import { sanitizeMarketingAttribution } from "@/lib/marketing-attribution";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { normalizeEmail, validEmail } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const ip = clientIp(request);
  const limited = await rateLimitDistributed(`demo-request:${ip}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  if (!limited.allowed) {
    return Response.json({ error: "Too many demo requests from this address. Try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const requestType: MarketingLeadKind =
    body.requestType === "trial-access" || body.requestType === "trial"
      ? "trial-access"
      : "demo";
  const name = String(body.name ?? "").trim().slice(0, 120);
  const email = normalizeEmail(body.email);
  const company = String(body.company ?? "").trim().slice(0, 160);
  const headcount = String(body.headcount ?? "").trim().slice(0, 40);
  const notes = String(body.notes ?? "").trim().slice(0, 1000);
  const attribution = sanitizeMarketingAttribution(body.attribution);

  const problems: string[] = [];
  if (name.length < 2) problems.push("Your name is required.");
  if (!validEmail(email)) problems.push("A valid work email is required.");
  if (company.length < 2) problems.push("Company or practice name is required.");
  if (problems.length) return Response.json({ error: "Validation failed.", problems }, { status: 422 });

  let lead: Awaited<ReturnType<typeof recordMarketingLead>>;
  try {
    lead = await recordMarketingLead({
      kind: requestType,
      name,
      email,
      company,
      headcount,
      notes,
      sourcePath: requestType === "trial-access" ? "/signup" : body.sourcePath === "/contact" ? "/contact" : "/book-demo",
      attribution,
    });
  } catch (error) {
    console.error("marketing-lead: could not persist demo/trial request", error);
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
    console.error("marketing-lead: notification failed after durable demo/trial capture", error);
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
