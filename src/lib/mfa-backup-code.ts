/**
 * Find the stored one-time MFA recovery-code entry without changing it.
 *
 * New codes are SHA-256 digests; older accounts may contain plaintext recovery
 * codes. Keep legacy matching until those records are rotated, but consume the
 * returned entry with an atomic conditional database update.
 */
export function findMatchingBackupCode(
  storedCodes: unknown,
  normalizedCode: string,
  hashedCode: string,
): string | null {
  if (!normalizedCode || !Array.isArray(storedCodes)) return null;

  for (const stored of storedCodes) {
    if (typeof stored === "string" &&
        (stored === hashedCode || stored === normalizedCode)) {
      return stored;
    }
  }
  return null;
}
