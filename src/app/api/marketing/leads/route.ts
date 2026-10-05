import { getSessionUser } from "@/lib/auth";
import { marketingLeadReport } from "@/lib/marketing-report";
import { requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";

function allowedEmails() {
  return new Set(
    (process.env.MARKETING_REPORT_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const allowed = allowedEmails();
  if (allowed.size === 0) {
    return Response.json(
      { error: "Marketing reporting is disabled until MARKETING_REPORT_EMAILS is configured." },
      { status: 503 },
    );
  }

  if (!allowed.has(user.email.toLowerCase())) {
    return Response.json({ error: "You do not have access to marketing reporting." }, { status: 403 });
  }

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  const daysParam = Number(new URL(request.url).searchParams.get("days") ?? "90");
  const report = await marketingLeadReport(Number.isFinite(daysParam) ? daysParam : 90);

  return Response.json({
    ...report,
    privacy:
      "Aggregated report only. Names, emails, company names, notes and message bodies are not returned by this endpoint.",
  });
}
