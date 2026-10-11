export const OFFICIAL_PUBLIC_DEMO_HOST = "erwinmehehe-payrollph.vercel.app";
export const OFFICIAL_PUBLIC_DEMO_HOSTS = new Set([
  OFFICIAL_PUBLIC_DEMO_HOST,
  "payrollph-three.vercel.app",
]);

export type PublicDemoHostOptions = {
  configuredHosts?: string | null;
  appBaseUrl?: string | null;
  vercelEnv?: string | null;
  vercelUrl?: string | null;
  vercelProductionUrl?: string | null;
};

function normalizeHost(value: string | null | undefined) {
  if (!value) return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .replace(/:\d+$/, "");
}

export function publicDemoHostAllowed(
  hostname: string,
  options: PublicDemoHostOptions = {},
) {
  const normalized = normalizeHost(hostname);
  const configuredHosts = (options.configuredHosts ?? "")
    .split(",")
    .map(normalizeHost)
    .filter(Boolean);
  const canonicalAppHost = normalizeHost(options.appBaseUrl);

  if (
    OFFICIAL_PUBLIC_DEMO_HOSTS.has(normalized) ||
    configuredHosts.includes(normalized) ||
    (canonicalAppHost && canonicalAppHost === normalized)
  ) {
    return true;
  }

  // Vercel production aliases can change over time. Trust only URLs Vercel says
  // belong to the current *production* deployment, never arbitrary preview URLs.
  if ((options.vercelEnv ?? "").trim().toLowerCase() !== "production") {
    return false;
  }

  const productionHosts = [
    normalizeHost(options.vercelUrl),
    normalizeHost(options.vercelProductionUrl),
  ].filter(Boolean);

  return productionHosts.includes(normalized);
}


export function publicDemoRequestAllowed(
  request: Request,
  options: PublicDemoHostOptions = {},
) {
  // The framework's resolved request URL is the only host input here.
  // Caller-supplied Host and X-Forwarded-Host must never independently authorize
  // demo-account provisioning on another production/customer deployment.
  const verifiedHost = normalizeHost(new URL(request.url).hostname);
  return publicDemoHostAllowed(verifiedHost, options);
}
