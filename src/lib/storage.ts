import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const ALLOWED: Record<string, { mime: string; ext: string[]; magic: number[][] }> = {
  pdf: { mime: "application/pdf", ext: [".pdf"], magic: [[0x25, 0x50, 0x44, 0x46]] },
  png: { mime: "image/png", ext: [".png"], magic: [[0x89, 0x50, 0x4e, 0x47]] },
  jpg: { mime: "image/jpeg", ext: [".jpg", ".jpeg"], magic: [[0xff, 0xd8, 0xff]] },
};

export const ALLOWED_KINDS = Object.keys(ALLOWED);

export type UploadCheck = { ok: true; kind: string; mime: string } | { ok: false; error: string };

export type MalwareScanResult = {
  scannedClean: boolean;
  note: string;
  engine?: string;
  threat?: string;
  unavailable?: boolean;
};

type ScannerResponse = {
  clean?: unknown;
  engine?: unknown;
  threat?: unknown;
  signature?: unknown;
};

/**
 * Content-sniffs the uploaded bytes against a magic-number allow-list.
 * The declared browser MIME type is never trusted on its own.
 */
export function validateUpload(bytes: Uint8Array, declaredMime: string, fileName: string): UploadCheck {
  if (bytes.byteLength === 0) return { ok: false, error: "File is empty." };
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `File exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.` };
  }

  const match = Object.entries(ALLOWED).find(([, spec]) =>
    spec.magic.some((signature) => signature.every((byte, index) => bytes[index] === byte)),
  );

  if (!match) {
    return { ok: false, error: "Only PDF, PNG and JPEG files are accepted (verified by content, not extension)." };
  }

  const [kind, spec] = match;
  if (declaredMime && declaredMime !== "application/octet-stream" && declaredMime !== spec.mime) {
    return { ok: false, error: `Declared type ${declaredMime} does not match detected ${spec.mime}.` };
  }

  const lower = fileName.toLowerCase();
  if (!spec.ext.some((ext) => lower.endsWith(ext))) {
    return { ok: false, error: `File name must end in ${spec.ext.join(" or ")}.` };
  }

  return { ok: true, kind, mime: spec.mime };
}

/** Strips directory traversal and control characters from a client-supplied name. */
export function safeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "upload";
  return base.replace(/[^\w.\-() ]+/g, "_").slice(0, 180) || "upload";
}

/**
 * Production document uploads are opt-in. A payroll pilot does not need to
 * accept arbitrary files, and leaving the feature off is safer than exposing a
 * route that depends on an unavailable malware scanner.
 */
export function documentUploadsEnabled() {
  return process.env.NODE_ENV !== "production" || criticalReleaseFlagEnabled("documentUploads");
}

export function malwareScannerConfigured() {
  const raw = process.env.MALWARE_SCAN_URL?.trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return false;
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (process.env.NODE_ENV === "production" && !process.env.MALWARE_SCAN_TOKEN?.trim()) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Sends validated upload bytes to the configured malware-scanning service.
 *
 * Contract:
 * - POST raw bytes to MALWARE_SCAN_URL
 * - Authorization: Bearer MALWARE_SCAN_TOKEN (required in production)
 * - scanner returns JSON: { clean: boolean, engine?: string, threat?: string, signature?: string }
 *
 * The caller must fail closed whenever unavailable=true or scannedClean=false.
 */
export async function scanUpload(
  bytes: Uint8Array,
  input: { fileName: string; mime: string },
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<MalwareScanResult> {
  const rawUrl = process.env.MALWARE_SCAN_URL?.trim();
  const token = process.env.MALWARE_SCAN_TOKEN?.trim();

  if (!rawUrl) {
    return {
      scannedClean: false,
      unavailable: true,
      note: "Malware scanner is not configured.",
    };
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      scannedClean: false,
      unavailable: true,
      note: "Malware scanner URL is invalid.",
    };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return {
      scannedClean: false,
      unavailable: true,
      note: "Malware scanner URL must use HTTP or HTTPS.",
    };
  }

  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    return {
      scannedClean: false,
      unavailable: true,
      note: "Production malware scanning must use HTTPS.",
    };
  }

  if (process.env.NODE_ENV === "production" && !token) {
    return {
      scannedClean: false,
      unavailable: true,
      note: "Production malware scanning requires MALWARE_SCAN_TOKEN.",
    };
  }

  const controller = new AbortController();
  const requestedTimeout = options.timeoutMs ?? Number(process.env.MALWARE_SCAN_TIMEOUT_MS ?? "8000");
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.min(20_000, Math.max(1_000, requestedTimeout))
    : 8_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = new Headers({
      "Content-Type": input.mime,
      "X-Upload-Filename": safeFileName(input.fileName),
      "X-Upload-Size": String(bytes.byteLength),
      "Accept": "application/json",
    });
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers,
      body: Buffer.from(bytes),
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        scannedClean: false,
        unavailable: true,
        note: `Malware scanner returned HTTP ${response.status}.`,
      };
    }

    const payload = await response.json().catch(() => null) as ScannerResponse | null;
    if (!payload || typeof payload.clean !== "boolean") {
      return {
        scannedClean: false,
        unavailable: true,
        note: "Malware scanner returned an invalid response.",
      };
    }

    const engine = typeof payload.engine === "string" ? payload.engine.slice(0, 120) : undefined;
    const threat = typeof payload.threat === "string"
      ? payload.threat.slice(0, 200)
      : typeof payload.signature === "string"
        ? payload.signature.slice(0, 200)
        : undefined;

    if (!payload.clean) {
      return {
        scannedClean: false,
        note: threat ? `Malware detected: ${threat}` : "Malware scanner rejected the file.",
        engine,
        threat,
      };
    }

    return {
      scannedClean: true,
      note: engine ? `Malware scan passed via ${engine}.` : "Malware scan passed.",
      engine,
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      scannedClean: false,
      unavailable: true,
      note: timedOut ? "Malware scan timed out." : "Malware scanner could not be reached.",
    };
  } finally {
    clearTimeout(timer);
  }
}
