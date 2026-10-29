export const PUBLIC_SITE_URL = "https://payrollsoftware.ph";

/**
 * Internal absolute URLs (robots, sitemap, canonical links) must never
 * resolve to an attacker-controlled host or carry embedded credentials.
 */
export function absolutePublicUrl(path = "/") {
  const result = new URL(path, `${PUBLIC_SITE_URL}/`);
  if (result.origin !== PUBLIC_SITE_URL || result.username || result.password) {
    throw new Error("Public URL must use the canonical site origin.");
  }
  return result.toString();
}
