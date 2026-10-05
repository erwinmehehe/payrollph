import { queueMessage } from "@/lib/mailer";
import { deliveryCapable } from "@/lib/mail-provider";
import {
  recordMarketingLead,
  updateMarketingLeadNotification,
  type MarketingLeadNotificationStatus,
} from "@/lib/marketing-leads";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { normalizeEmail, validEmail } from "@/lib/validation";

export const dynamic = "force-dynamic";

const OPERATOR_INBOX =
  process.env.PAYROLL_OUTSOURCING_INBOX?.trim()
  || process.env.DEMO_REQUEST_INBOX?.trim()
  || null;

function notificationStatus(result: Awaited<ReturnType<typeof queueMessage>>): MarketingLeadNotificationStatus {
  if (result.delivered) return "sent";
  if (result.queued) return "queued";
  return "failed";
}

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

  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 120);
  const email = normalizeEmail(body.email);
  const company = String(body.company ?? "").trim().slice(0, 160);
  const headcount = String(body.headcount ?? "").trim().slice(0, 40);
  const frequency = String(body.frequency ?? "").trim().slice(0, 40);
  const entities = String(body.entities ?? "").trim().slice(0, 40);
  const notes = String(body.notes ?? "").trim().slice(0, 1000);

  const problems: string[] = [];
  if (name.length < 2) problems.push("Your name is required.");
  if (!validEmail(email)) problems.push("A valid work email is required.");
  if (company.length < 2) problems.push("Company name is required.");
  if (!headcount) problems.push("Payroll headcount is required.");
  if (problems.length) {
    return Response.json({ error: "Validation failed.", problems }, { status: 422 });
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
    });
  } catch (error) {
    console.error("marketing-lead: could not persist payroll outsourcing request", error);
    return Response.json(
      { error: "We could not record your request right now. Please try again shortly." },
      { status: 503 },
    );
  }

  let status: MarketingLeadNotificationStatus = "not-configured";
  if (OPERATOR_INBOX && deliveryCapable()) {
    try {
      const result = await queueMessage({
        recipient: OPERATOR_INBOX,
        subject: `Payroll outsourcing enquiry: ${company}`,
        purpose: "payroll-outsourcing-enquiry",
        dedupeKey: `marketing-lead:${lead.id}`,
        body: [
          "A payroll outsourcing enquiry was submitted from the public site.",
          "",
          `Lead ID:   ${lead.id}`,
          `Name:      ${name}`,
          `Email:     ${email}`,
          `Company:   ${company}`,
          `Headcount: ${headcount}`,
          `Frequency: ${frequency || "not stated"}`,
          `Entities:  ${entities || "not stated"}`,
          "",
          "Requested scope / notes:",
          notes || "(none)",
        ].join("\n"),
      });
      status = notificationStatus(result);
      await updateMarketingLeadNotification({
        id: lead.id,
        status,
        provider: result.provider,
        outboxId: result.id,
      });
    } catch (error) {
      console.error("marketing-lead: notification failed after durable outsourcing capture", error);
      status = "failed";
      await updateMarketingLeadNotification({ id: lead.id, status }).catch(() => {});
    }
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
