import { enforceSameOriginMutation } from "@/lib/security-request";
import { queueMessage } from "@/lib/mailer";
import { activeMailProvider, deliveryCapable } from "@/lib/mail-provider";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { normalizeEmail, validEmail } from "@/lib/validation";

export const dynamic = "force-dynamic";

const OPERATOR_INBOX =
  process.env.PAYROLL_OUTSOURCING_INBOX ??
  process.env.DEMO_REQUEST_INBOX ??
  "payroll-outsourcing@linaw.invalid";

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

  let result: Awaited<ReturnType<typeof queueMessage>>;
  try {
    result = await queueMessage({
      recipient: OPERATOR_INBOX,
      subject: `Payroll outsourcing enquiry: ${company}`,
      purpose: "payroll-outsourcing-enquiry",
      body: [
        "A payroll outsourcing enquiry was submitted from the public site.",
        "",
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
  } catch (error) {
    console.error("payroll-outsourcing: could not write to the outbox", error);
    return Response.json(
      { error: "We could not record your request right now. Please try again shortly." },
      { status: 503 },
    );
  }

  const provider = activeMailProvider();

  return Response.json(
    {
      ok: true,
      queued: result.queued,
      delivered: result.delivered,
      provider,
      deliveryCapable: deliveryCapable(),
      message: result.delivered
        ? `Payroll outsourcing enquiry sent to the Linaw team via ${provider}.`
        : "Payroll outsourcing enquiry recorded in the outbox. No email provider is configured, so it has not been emailed yet.",
      reason: result.reason ?? null,
    },
    { status: 201 },
  );
}
