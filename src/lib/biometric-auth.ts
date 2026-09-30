import { createHmac, timingSafeEqual } from "node:crypto";

export function biometricDeviceCredential(master: string, organizationId: number, deviceSerial: string) {
  if (!master || master.length < 32) {
    throw new Error("BIOMETRIC_INGEST_SECRET must be at least 32 characters.");
  }
  if (!Number.isInteger(organizationId)) {
    throw new Error("organizationId must be an integer.");
  }
  const normalizedSerial = deviceSerial.trim().toUpperCase();
  if (!normalizedSerial) {
    throw new Error("deviceSerial is required.");
  }

  const binding = `${organizationId}:${normalizedSerial}`;
  return `bio_${createHmac("sha256", master).update(binding).digest("hex")}`;
}

export function verifyBiometricDeviceCredential(
  supplied: string,
  master: string | null | undefined,
  organizationId: number,
  deviceSerial: string,
) {
  if (!master || master.length < 32 || !supplied) return false;

  let expected: string;
  try {
    expected = biometricDeviceCredential(master, organizationId, deviceSerial);
  } catch {
    return false;
  }

  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}
