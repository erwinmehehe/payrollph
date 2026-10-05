const configuredBaseUrl = process.env.APP_BASE_URL?.trim();

export const PUBLIC_SITE_URL = (
  configuredBaseUrl && /^https:\/\//i.test(configuredBaseUrl)
    ? configuredBaseUrl
    : "https://erwinmehehe-payrollph.vercel.app"
).replace(/\/+$/, "");

export function absolutePublicUrl(path = "/") {
  return new URL(path, `${PUBLIC_SITE_URL}/`).toString();
}
