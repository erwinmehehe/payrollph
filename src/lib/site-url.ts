export const PUBLIC_SITE_URL = "https://payrollsoftware.ph";

export function absolutePublicUrl(path = "/") {
  return new URL(path, `${PUBLIC_SITE_URL}/`).toString();
}
