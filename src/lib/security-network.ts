import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const FORBIDDEN_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.internal",
]);

function ipv4ToInt(ip: string) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function inCidr(ip: string, base: string, prefix: number) {
  const value = ipv4ToInt(ip);
  const baseValue = ipv4ToInt(base);
  if (value == null || baseValue == null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

/** Reject non-routable, private, loopback, link-local, documentation and multicast ranges. */
export function isForbiddenIp(address: string): boolean {
  if (isIP(address) === 4) {
    return [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ].some(([base, prefix]) => inCidr(address, String(base), Number(prefix)));
  }

  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    if (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8:") ||
      normalized.startsWith("::ffff:") ||
      /^fe[c-f]/.test(normalized)
    ) return true;

    return false;
  }

  return true;
}

export async function resolveWebhookTarget(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Webhook URL is invalid.");
  }

  const production = process.env.NODE_ENV === "production";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && !production)) {
    throw new Error(production ? "Production webhooks must use HTTPS." : "Webhook URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) throw new Error("Webhook URLs cannot contain credentials.");
  if (url.port && !/^\d{1,5}$/.test(url.port)) throw new Error("Webhook port is invalid.");

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    FORBIDDEN_HOSTS.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Webhook target must be a public internet host.");
  }

  // Direct IP targets make private-network controls easier to bypass and are
  // unnecessary for normal webhook providers. Require a DNS hostname instead.
  if (isIP(hostname)) throw new Error("Webhook target must use a public DNS hostname, not an IP address.");

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Webhook hostname could not be resolved.");
  }

  if (addresses.length === 0 || addresses.some(({ address }) => isForbiddenIp(address))) {
    throw new Error("Webhook target resolves to a private or non-routable network.");
  }

  return {
    url: url.toString(),
    hostname,
    addresses: addresses.map(({ address }) => ({
      address,
      family: isIP(address) as 4 | 6,
    })),
  };
}

export async function validateWebhookTarget(raw: string) {
  return (await resolveWebhookTarget(raw)).url;
}

export async function postValidatedWebhook(input: {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs?: number;
}) {
  const target = await resolveWebhookTarget(input.url);
  const pinned = target.addresses[0];
  if (!pinned) throw new Error("Webhook target has no validated public address.");

  const url = new URL(target.url);
  const transport = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise<{ ok: boolean; status: number }>((resolve, reject) => {
    const request = transport(url, {
      method: "POST",
      headers: input.headers,
      // Pin the request to the exact public IP that passed validation. HTTPS
      // still uses the original URL hostname for Host + SNI/certificate checks.
      lookup: (_hostname, _options, callback) => {
        callback(null, pinned.address, pinned.family);
      },
      ...(url.protocol === "https:" ? { servername: target.hostname } : {}),
    }, (response) => {
      // We only need the status. Drain the body so the socket can close/reuse.
      response.resume();
      const status = response.statusCode ?? 0;
      resolve({ ok: status >= 200 && status < 300, status });
    });

    request.setTimeout(input.timeoutMs ?? 5_000, () => {
      request.destroy(new Error("Webhook delivery timed out."));
    });
    request.on("error", reject);
    request.end(input.body);
  });
}


export async function getValidatedJson<T = unknown>(input: {
  url: string;
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
}) {
  const target = await resolveWebhookTarget(input.url);
  const pinned = target.addresses[0];
  if (!pinned) throw new Error("Validated target has no public address.");

  const url = new URL(target.url);
  const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
  const maxBytes = input.maxBytes ?? 1_000_000;

  return new Promise<T>((resolve, reject) => {
    const request = transport(url, {
      method: "GET",
      headers: { Accept: "application/json", ...(input.headers ?? {}) },
      lookup: (_hostname, _options, callback) => {
        callback(null, pinned.address, pinned.family);
      },
      ...(url.protocol === "https:" ? { servername: target.hostname } : {}),
    }, (response) => {
      const status = response.statusCode ?? 0;
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          request.destroy(new Error("Validated JSON response exceeded the allowed size."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (status < 200 || status >= 300) {
          reject(new Error(`Validated JSON request failed with status ${status}.`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
        } catch {
          reject(new Error("Validated JSON response was not valid JSON."));
        }
      });
    });
    request.setTimeout(input.timeoutMs ?? 5_000, () => {
      request.destroy(new Error("Validated JSON request timed out."));
    });
    request.on("error", reject);
    request.end();
  });
}


export async function postValidatedForm<T = unknown>(input: {
  url: string;
  body: URLSearchParams;
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
}) {
  const target = await resolveWebhookTarget(input.url);
  const pinned = target.addresses[0];
  if (!pinned) throw new Error("Validated target has no public address.");

  const url = new URL(target.url);
  const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
  const encoded = input.body.toString();
  const maxBytes = input.maxBytes ?? 1_000_000;

  return new Promise<T>((resolve, reject) => {
    const request = transport(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(encoded).toString(),
        ...(input.headers ?? {}),
      },
      lookup: (_hostname, _options, callback) => {
        callback(null, pinned.address, pinned.family);
      },
      ...(url.protocol === "https:" ? { servername: target.hostname } : {}),
    }, (response) => {
      const status = response.statusCode ?? 0;
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          request.destroy(new Error("Validated form response exceeded the allowed size."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (status < 200 || status >= 300) {
          reject(new Error(`Validated form request failed with status ${status}.`));
          return;
        }
        try {
          resolve(JSON.parse(raw) as T);
        } catch {
          reject(new Error("Validated form response was not valid JSON."));
        }
      });
    });
    request.setTimeout(input.timeoutMs ?? 5_000, () => {
      request.destroy(new Error("Validated form request timed out."));
    });
    request.on("error", reject);
    request.end(encoded);
  });
}
