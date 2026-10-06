import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function normalizeOrigin(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function configuredOrigins(request: Request) {
  const origins = new Set<string>();
  const app = normalizeOrigin(process.env.APP_BASE_URL);
  if (app) origins.add(app);

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? normalizeOrigin(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
    : null;
  if (vercel) origins.add(vercel);

  for (const raw of (process.env.TRUSTED_APP_ORIGINS ?? "").split(",")) {
    const origin = normalizeOrigin(raw.trim());
    if (origin) origins.add(origin);
  }

  if (process.env.NODE_ENV !== "production") {
    origins.add(new URL(request.url).origin);
  }

  return origins;
}

function requestTargetOrigins(request: Request) {
  const origins = new Set<string>();
  const direct = normalizeOrigin(request.url);
  if (direct) origins.add(direct);

  // Vercel may normalize request.url to an internal/canonical host while the
  // browser is using another production alias. Treat that forwarded alias as
  // the request target, but only for a browser request that also reports
  // Sec-Fetch-Site: same-origin below.
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProtoHeader = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwardedHost) {
    const directProtocol = new URL(request.url).protocol.replace(":", "").toLowerCase();
    const protocol =
      forwardedProtoHeader === "https" || forwardedProtoHeader === "http"
        ? forwardedProtoHeader
        : directProtocol;
    const forwarded = normalizeOrigin(`${protocol}://${forwardedHost}`);
    if (forwarded) origins.add(forwarded);
  }

  return origins;
}

export function enforceSameOriginMutation(request: Request) {
  if (!MUTATION_METHODS.has(request.method.toUpperCase())) return null;

  // Do not infer trust from the mere presence of auth-looking headers here.
  // Routes that support server-to-server credentials must validate those
  // credentials themselves before deciding whether browser-origin checks apply.
  // This prevents a forged x-api-key/Authorization header from weakening a
  // cookie-authenticated mutation endpoint.

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") {
    return Response.json({ error: "Cross-site mutation blocked." }, { status: 403 });
  }

  const origin = normalizeOrigin(request.headers.get("origin"));
  const allowed = configuredOrigins(request);

  if (!origin) {
    if (process.env.NODE_ENV === "production" && fetchSite !== "same-origin") {
      return Response.json({ error: "A same-origin request is required." }, { status: 403 });
    }
    return null;
  }

  const browserSameOrigin =
    fetchSite === "same-origin" && requestTargetOrigins(request).has(origin);

  if (!allowed.has(origin) && !browserSameOrigin) {
    return Response.json({ error: "Request origin is not allowed." }, { status: 403 });
  }

  return null;
}

export async function enforceSensitiveActionRateLimit(
  request: Request,
  input: {
    userId: number;
    action: string;
    resourceId?: string | number | null;
    limit?: number;
    windowMs?: number;
  },
) {
  const resource = input.resourceId == null ? "global" : String(input.resourceId);
  const bucket = `sensitive:${input.action}:user:${input.userId}:resource:${resource}:ip:${clientIp(request)}`;
  const result = await rateLimitDistributed(bucket, {
    limit: input.limit ?? 8,
    windowMs: input.windowMs ?? 5 * 60_000,
  });
  if (result.allowed) return null;

  const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  return Response.json(
    {
      error: "Too many sensitive-action attempts. Retry after the cooldown.",
      code: "SENSITIVE_ACTION_RATE_LIMITED",
      retryAfterSeconds,
    },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    },
  );
}

export function requireSensitiveActionMfa(user: {
  totpEnabled: boolean;
  mfaVerifiedAt?: Date | string | null;
  authMethod?: string | null;
}) {
  if (process.env.NODE_ENV !== "production" || process.env.REQUIRE_PRIVILEGED_MFA === "false") {
    return null;
  }

  const verifiedAt = user.mfaVerifiedAt ? new Date(user.mfaVerifiedAt).getTime() : 0;
  const configuredHours = Number(process.env.PRIVILEGED_MFA_MAX_AGE_HOURS ?? "12");
  const maxAgeHours = Number.isFinite(configuredHours)
    ? Math.min(24, Math.max(1, configuredHours))
    : 12;
  const recent = verifiedAt > 0 && Date.now() - verifiedAt <= maxAgeHours * 60 * 60 * 1000;

  const factorAvailable = user.totpEnabled || user.authMethod === "oidc";
  if (!factorAvailable || !recent) {
    return Response.json(
      {
        error: factorAvailable
          ? "Re-authenticate with multi-factor authentication before this sensitive action."
          : "Multi-factor authentication is required for this sensitive action.",
        code: "MFA_REQUIRED",
        maxAgeHours,
      },
      { status: 403 },
    );
  }

  return null;
}

export function canonicalAppOrigin(request: Request) {
  const configured = normalizeOrigin(process.env.APP_BASE_URL);
  if (configured) {
    if (process.env.NODE_ENV === "production" && !configured.startsWith("https://")) {
      throw new Error("APP_BASE_URL must use HTTPS in production.");
    }
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_BASE_URL must be configured in production.");
  }

  return new URL(request.url).origin;
}
