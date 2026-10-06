import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { statutoryPostingEvidenceArtifacts } from "@/db/schema";
import { getAccess, PAYROLL_OPERATOR_ROLES, roleAllowed } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import {
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

function safeFileName(value: string) {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "posting-evidence.csv";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const artifactId = Number(id);
  if (!Number.isInteger(artifactId) || artifactId <= 0) {
    return Response.json({ error: "Invalid posting evidence artifact." }, { status: 400 });
  }

  const [artifact] = await db.select().from(statutoryPostingEvidenceArtifacts)
    .where(eq(statutoryPostingEvidenceArtifacts.id, artifactId))
    .limit(1);
  if (!artifact) return Response.json({ error: "Posting evidence artifact not found." }, { status: 404 });

  const access = await getAccess(user.id, artifact.organizationId);
  if (!access?.companyWide || !roleAllowed(access.role, PAYROLL_OPERATOR_ROLES)) {
    return Response.json({
      error: "Only company-wide payroll operators can download source posting evidence.",
    }, { status: 403 });
  }

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "statutory-posting-evidence-download",
    resourceId: artifact.organizationId,
    limit: 20,
    windowMs: 60 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (artifact.sourceType !== "csv_import" || !artifact.fileDataBase64) {
    return Response.json({
      error: "This posting evidence record has no downloadable source file.",
    }, { status: 409 });
  }

  const bytes = Buffer.from(artifact.fileDataBase64, "base64");
  if (bytes.byteLength !== artifact.byteSize) {
    return Response.json({
      error: "Stored posting evidence failed byte-size verification.",
    }, { status: 500 });
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": artifact.mimeType || "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${safeFileName(artifact.fileName ?? "posting-evidence.csv")}"`,
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
    },
  });
}
