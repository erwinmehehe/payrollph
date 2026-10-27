import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { effectiveCorrectionAccess } from "@/lib/hcm-effective-correction-access";
import { returnEffectiveChangeForCorrection } from "@/lib/hcm-effective-corrections";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const origin = enforceSameOriginMutation(request); if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demo = publicDemoMutationDenied(user.email, "Governed HCM correction"); if (demo) return demo;
  const body = await request.json().catch(() => null);
  if (!body || !Number.isSafeInteger(body.organizationId) || body.organizationId <= 0
    || !Number.isSafeInteger(body.changeId) || body.changeId <= 0) return Response.json({ error: "Positive organizationId and changeId required." }, { status: 400 });
  const denied = await effectiveCorrectionAccess(user.id, body.organizationId); if (denied) return denied;
  const mfa = requireSensitiveActionMfa(user); if (mfa) return mfa;
  const limited = await enforceSensitiveActionRateLimit(request, { userId: user.id, action: "hcm-correction-return", resourceId: body.changeId, limit: 8, windowMs: 900000 });
  if (limited) return limited;
  try {
    return Response.json(await returnEffectiveChangeForCorrection({ organizationId: body.organizationId, changeId: body.changeId,
      userId: user.id, name: user.name, note: body.note }), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "The change is unavailable for correction or its review authority changed. Refresh and retry." }, { status: 409 });
  }
}
