import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { parseBankEncryptionKey } from "./bank-account-crypto";
const PREFIX = "enc:wfmpunch:v1:";
const PURPOSE = "payrollph:wfm:punch:photo:v1";
function key(env: Readonly<Record<string,string|undefined>> = process.env, previous = false) {
  const raw = env[previous ? "PII_ENCRYPTION_KEY_PREVIOUS" : "PII_ENCRYPTION_KEY"];
  if (!raw) return null;
  const secret = parseBankEncryptionKey(raw);
  if (!secret) throw new Error("PII_ENCRYPTION_KEY must be 32-byte hex/base64.");
  return createHmac("sha256", secret).update(PURPOSE).digest();
}
export function encryptPunchPhoto(bytes: Uint8Array, env: Readonly<Record<string,string|undefined>> = process.env) {
  const secret = key(env);
  if (!secret) throw new Error("Punch image encryption is unavailable.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  const content = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), content].map(part => part.toString("base64url")).join(":");
}
export function decryptPunchPhoto(sealed: string, env: Readonly<Record<string,string|undefined>> = process.env) {
  if (!sealed.startsWith(PREFIX)) throw new Error("Invalid punch photo envelope.");
  const parts = sealed.slice(PREFIX.length).split(":").map(v => Buffer.from(v, "base64url"));
  if (parts.length !== 3 || parts[0].length !== 12 || parts[1].length !== 16 || !parts[2].length) throw new Error("Invalid punch photo.");
  for (const secret of [key(env), key(env, true)]) {
    if (!secret) continue;
    try {
      const cipher = createDecipheriv("aes-256-gcm", secret, parts[0]);
      cipher.setAuthTag(parts[1]);
      return Buffer.concat([cipher.update(parts[2]), cipher.final()]);
    } catch { /* old key may be in use */ }
  }
  throw new Error("Punch image key unavailable.");
}

/** Reject images with metadata rather than storing EXIF/GPS. Browser capture uses canvas JPEG.
 * Strict minimal JPEG segments: only SOI, essential image segments, SOS and EOI are retained.
 * JPEG APPn/COM segments are removed, including EXIF/XMP/GPS.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("Only JPEG capture is supported.");
  const out: Uint8Array[] = [bytes.slice(0, 2)];
  let i = 2;
  let ended = false;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error("Malformed JPEG marker.");
    const marker = bytes[i+1];
    if (marker === 0xda) {
      // Entropy-coded data may contain escaped markers; require an EOI at the end.
      if (bytes[bytes.length-2] !== 0xff || bytes[bytes.length-1] !== 0xd9) throw new Error("Incomplete JPEG.");
      out.push(bytes.slice(i)); ended = true; break;
    }
    if (marker === 0xd9) { ended = true; out.push(bytes.slice(i,i+2)); break; }
    if (i+4 > bytes.length) throw new Error("Invalid JPEG segment.");
    const length = (bytes[i+2] << 8) | bytes[i+3];
    if (length < 2 || i + 2 + length > bytes.length) throw new Error("Invalid JPEG length.");
    if (!((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe)) out.push(bytes.slice(i, i+2+length));
    i += 2 + length;
  }
  if (!ended) throw new Error("Incomplete JPEG.");
  return Buffer.concat(out);
}
