export const OFFICIAL_PUBLIC_DEMO_HOST = "erwinmehehe-payrollph.vercel.app";
export const OFFICIAL_PUBLIC_DEMO_HOSTS = new Set([OFFICIAL_PUBLIC_DEMO_HOST, "payrollph-three.vercel.app"]);

export function publicDemoHostAllowed(
  hostname: string,
  options: {
    productionHost?: string | null;
    configuredHosts?: string | null;
  } = {},
) {
  const normalized = hostname.trim().toLowerCase();
  const productionHost = (options.productionHost ?? "").trim().toLowerCase();
  const configuredHosts = (options.configuredHosts ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return (
    OFFICIAL_PUBLIC_DEMO_HOSTS.has(normalized) ||
    Boolean(productionHost && normalized === productionHost) ||
    configuredHosts.includes(normalized)
  );
}
