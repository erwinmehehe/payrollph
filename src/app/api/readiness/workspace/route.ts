import { buildReadinessPayload } from "@/app/api/readiness/route";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, ORG_ADMIN_ROLES } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    ORG_ADMIN_ROLES,
    "Only company-wide administrators and bookkeepers can view rollout readiness.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Rollout readiness requires company-wide access." }, { status: 403 });
  }

  const payload = await buildReadinessPayload();

  return Response.json({
    status: payload.status,
    launchBlockersRemaining: payload.launchBlockersRemaining,
    scaleGapsRemaining: payload.scaleGapsRemaining,
    summary: payload.summary,
    manualLaunch: payload.manualLaunch,
    generatedAt: payload.generatedAt,
    gates: payload.gates.map((gate) => ({
      key: gate.key,
      label: gate.label,
      ready: gate.ready,
      detail: gate.detail,
      blocks: gate.blocks,
      manualWorkaround: gate.manualWorkaround ?? null,
    })),
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
