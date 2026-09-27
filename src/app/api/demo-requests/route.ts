import { queueMessage } from "@/lib/mailer";
import { activeMailProvider, deliveryCapable } from "@/lib/mail-provider";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { normalizeEmail, validEmail } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * Book-a-demo intake for the public site.
 *
 * The request is written to the same `outbox` table every other message uses,
 * addressed to the operator inbox, never to an address the visitor typed, so
 * this endpoint cannot be used to make the deployment send mail to strangers.
 * With no mail provider configured the row stays `queued` and the response says
 * so; it is never reported as sent.
 */
const OPERATOR_INBOX = process.env.DEMO_REQUEST_INBOX ?? "demo-requests@linaw.invalid";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limited = await rateLimitDistributed(`demo-request:${ip}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  if (!limited.allowed) {
    return Response.json({ error: "Too many demo requests from this address. Try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 120);
  const email = normalizeEmail(body.email);
  const company = String(body.company ?? "").trim().slice(0, 160);
  const headcount = String(body.headcount ?? "").trim().slice(0, 40);
  const notes = String(body.notes ?? "").trim().slice(0, 1000);

  const problems: string[] = [];
  if (name.length < 2) problems.push("Your name is required.");
  if (!validEmail(email)) problems.push("A valid work email is required.");
  if (company.length < 2) problems.push("Company or practice name is required.");
  if (problems.length) return Response.json({ error: "Validation failed.", problems }, { status: 422 });

  // The outbox row *is* the record of the request, so a failed write is a real
  // failure. Say so, rather than letting an unhandled error return a bare 500
  // and leaving the visitor believing the request landed somewhere.
  let result: Awaited<ReturnType<typeof queueMessage>>;
  try {
    result = await queueMessage({
      recipient: OPERATOR_INBOX,
      subject: `Demo request: ${company}`,
      purpose: "demo-request",
      body: [
        "A demo was requested from the public site.",
        "",
        `Name:      ${name}`,
        `Email:     ${email}`,
        `Company:   ${company}`,
        `Headcount: ${headcount || "not stated"}`,
        "",
        "Notes:",
        notes || "(none)",
      ].join("\n"),
    });
  } catch (error) {
    console.error("demo-request: could not write to the outbox", error);
    return Response.json(
      {
        error:
          "We could not record your request right now. Please try again shortly, or explore the workspace preview in the meantime.",
      },
      { status: 503 },
    );
  }

  const provider = activeMailProvider();

  return Response.json(
    {
      ok: true,
      // The distinction matters: queued means it is sitting in the outbox.
      queued: result.queued,
      delivered: result.delivered,
      provider,
      deliveryCapable: deliveryCapable(),
      message: result.delivered
        ? `Request sent to the Linaw team via ${provider}.`
        : "Request recorded in the outbox. This deployment has no mail provider configured, so nothing has actually been emailed yet.",
      reason: result.reason ?? null,
    },
    { status: 201 },
  );
}
