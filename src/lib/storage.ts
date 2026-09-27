export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const ALLOWED: Record<string, { mime: string; ext: string[]; magic: number[][] }> = {
  pdf: { mime: "application/pdf", ext: [".pdf"], magic: [[0x25, 0x50, 0x44, 0x46]] },
  png: { mime: "image/png", ext: [".png"], magic: [[0x89, 0x50, 0x4e, 0x47]] },
  jpg: { mime: "image/jpeg", ext: [".jpg", ".jpeg"], magic: [[0xff, 0xd8, 0xff]] },
};

export const ALLOWED_KINDS = Object.keys(ALLOWED);

export type UploadCheck = { ok: true; kind: string; mime: string } | { ok: false; error: string };

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
 * Malware scanning status is honest: without a scanning engine wired up there
 * is no clean bill of health, so `scannedClean` stays false and the note says
 * exactly what was and was not checked.
 */
export function scanStatus() {
  const engine = process.env.MALWARE_SCAN_URL;
  return engine
    ? { scannedClean: false, note: "Scanner endpoint configured but not yet integrated." }
    : { scannedClean: false, note: "Signature/AV scanning not configured. Only content-type and size checks ran." };
}
