import { validEmail } from "@/lib/validation";

/**
 * SSO discovery is anonymous. Accept an email address, never an object or
 * coercible value, and use only its canonical domain for provider selection.
 * Never allow an untrusted caller to supply an employer or provider ID here.
 */
export function ssoDiscoveryEmail(value: unknown): { email: string; domain: string } | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > 180 || !validEmail(email)) return null;

  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return null;
  const domain = email.slice(at + 1);
  if (domain.length > 180 || !domain.includes(".")) return null;

  // No whitespace, wildcard, URL encoding, or invalid DNS label can select a
  // verified organization domain. Punycode labels remain permitted.
  const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (!domain.split(".").every((part) => label.test(part))) return null;
  return { email, domain };
}
