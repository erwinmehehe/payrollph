const configuredPublicSiteUrl = process.env.PUBLIC_SITE_URL?.trim();

export const PUBLIC_SITE_URL = (
  configuredPublicSiteUrl && /^https:\/\//i.test(configuredPublicSiteUrl)
    ? configuredPublicSiteUrl
    : "https://payrollsoftware.ph"
).replace(/\/+$/, "");

export function absolutePublicUrl(path = "/") {
  return new URL(path, `${PUBLIC_SITE_URL}/`).toString();
}
