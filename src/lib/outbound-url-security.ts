import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function blockedIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 0 && parts[2] === 2) return true;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
  if (a === 203 && b === 0 && parts[2] === 113) return true;
  if (a >= 224) return true;
  return false;
}

function blockedIpv6(address: string) {
  const value = address.toLowerCase();
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("fc") || value.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(value)) return true;
  if (value.startsWith("2001:db8:")) return true;
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice("::ffff:".length);
    return isIP(mapped) === 4 ? blockedIpv4(mapped) : true;
  }
  return false;
}

export function isBlockedOutboundAddress(address: string) {
  const kind = isIP(address);
  if (kind === 4) return blockedIpv4(address);
  if (kind === 6) return blockedIpv6(address);
  return true;
}

export async function validateOutboundWebhookUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Webhook URL is invalid.");
  }

  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error("Webhook URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Webhook URLs must not contain embedded credentials.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("Production webhook endpoints must use HTTPS.");
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
    throw new Error("Webhook URL must not target a local or internal host.");
  }

  if (isIP(host)) {
    if (isBlockedOutboundAddress(host)) {
      throw new Error("Webhook URL must not target a private, loopback, link-local, or reserved address.");
    }
    return url.toString();
  }

  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("Webhook hostname could not be resolved.");
  }
  if (resolved.length === 0 || resolved.some((entry) => isBlockedOutboundAddress(entry.address))) {
    throw new Error("Webhook hostname resolves to a private, loopback, link-local, or reserved address.");
  }

  return url.toString();
}
