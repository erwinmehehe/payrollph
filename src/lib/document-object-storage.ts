import { createHash, createHmac, randomUUID } from "node:crypto";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

/** Private S3-compatible object store. Browser never receives write credentials. */
export type DocumentStorageConfig = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, c =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

export function documentObjectKey(organizationId: number, employeeId: number | null): string {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
    (employeeId !== null && (!Number.isSafeInteger(employeeId) || employeeId <= 0))) {
    throw new Error("A valid organization and employee identity are required.");
  }
  return "private-documents/" + organizationId + "/" + (employeeId ?? "company") + "/" + randomUUID();
}

export function documentStorageConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DocumentStorageConfig {
  const endpoint = (env.DOCUMENT_OBJECT_STORAGE_ENDPOINT ?? "").trim();
  const bucket = (env.DOCUMENT_OBJECT_STORAGE_BUCKET ?? "").trim();
  const region = (env.DOCUMENT_OBJECT_STORAGE_REGION ?? "").trim();
  const accessKeyId = (env.DOCUMENT_OBJECT_STORAGE_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = (env.DOCUMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY ?? "").trim();
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error("Private document storage endpoint is not configured."); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password
    || url.search || url.hash || url.pathname !== "/") throw new Error("Invalid document storage endpoint.");
  // Financial/201 files may exist in staging too. Never send signed requests
  // to a remote HTTP object endpoint; only local test emulators are allowed.
  const localEmulator = env.NODE_ENV !== "production"
    && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !localEmulator) {
    throw new Error("Private document storage requires HTTPS except local test emulators.");
  }
  if (!/^[a-z0-9][a-z0-9.-]{2,62}$/.test(bucket) || !/^[a-z0-9-]{3,40}$/.test(region)
    || !accessKeyId || !secretAccessKey) throw new Error("Private document storage credentials are missing.");
  return { endpoint: url.origin, bucket, region, accessKeyId, secretAccessKey };
}

function hmac(key: Uint8Array | string, body: string) {
  return createHmac("sha256", key).update(body).digest();
}

export function signedDocumentObjectUrl(
  key: string,
  method: "GET" | "PUT" | "DELETE",
  config: DocumentStorageConfig,
  options: { now?: Date; expirySeconds?: number } = {},
): URL {
  if (!/^private-documents\/[1-9]\d*\/(?:[1-9]\d*|company)\/[0-9a-f-]{36}$/.test(key)) {
    throw new Error("Untrusted document object key.");
  }
  const now = options.now ?? new Date();
  const expires = options.expirySeconds ?? 60;
  if (!Number.isSafeInteger(expires) || expires < 1 || expires > 300) throw new Error("Invalid signed URL expiry.");
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const ymd = iso.slice(0, 8);
  const scope = ymd + "/" + config.region + "/s3/aws4_request";
  const uri = "/" + [config.bucket, ...key.split("/")].map(encodeSegment).join("/");
  const host = new URL(config.endpoint).host;
  const query = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": config.accessKeyId + "/" + scope,
    "X-Amz-Date": iso,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
  });
  const canonicalQuery = [...query.entries()].map(([k,v])=>encodeSegment(k)+"="+encodeSegment(v)).sort().join("&");
  const canonicalRequest = [method, uri, canonicalQuery, "host:" + host + "\n", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const hash = createHash("sha256").update(canonicalRequest).digest("hex");
  const stringToSign = ["AWS4-HMAC-SHA256", iso, scope, hash].join("\n");
  const keyDate = hmac("AWS4" + config.secretAccessKey, ymd);
  const keyRegion = hmac(keyDate, config.region);
  const keyService = hmac(keyRegion, "s3");
  const signingKey = hmac(keyService, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return new URL(config.endpoint + uri + "?" + canonicalQuery + "&X-Amz-Signature=" + signature);
}

/** Server-side upload, never a publicly accessible browser PUT. */
export async function putDocumentObject(key: string, bytes: Uint8Array, mime: string,
  options: { fetchImpl?: typeof fetch; config?: DocumentStorageConfig } = {}) {
  if (!criticalReleaseFlagEnabled("employeeDocumentVault")) {
    throw new Error("Employee document object storage is disabled.");
  }
  const config = options.config ?? documentStorageConfig();
  const url = signedDocumentObjectUrl(key, "PUT", config);
  const response = await (options.fetchImpl ?? fetch)(url, {
    method: "PUT", body: Buffer.from(bytes),
    // Conditional PUT prevents a later writer from silently replacing
    // malware-scanned bytes at an existing private object key.
    headers: { "Content-Type": mime, "Cache-Control": "private, no-store",
      "If-None-Match": "*" },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error("Private document upload failed with HTTP " + response.status);
}

export async function deleteDocumentObject(key: string,
  options: { fetchImpl?: typeof fetch; config?: DocumentStorageConfig } = {}) {
  const config = options.config ?? documentStorageConfig();
  const url = signedDocumentObjectUrl(key, "DELETE", config);
  const response = await (options.fetchImpl ?? fetch)(url, {
    method: "DELETE", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000),
  });
  if (!response.ok && response.status !== 404) throw new Error("Private document deletion failed.");
}
