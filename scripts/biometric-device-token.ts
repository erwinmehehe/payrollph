import "dotenv/config";
import { biometricDeviceCredential } from "../src/lib/biometric-auth";

const organizationId = Number(process.argv[2]);
const deviceSerial = String(process.argv[3] ?? "").trim();
const master = process.env.BIOMETRIC_INGEST_SECRET ?? "";

if (!Number.isInteger(organizationId) || !deviceSerial) {
  console.error("Usage: npx tsx scripts/biometric-device-token.ts <organizationId> <deviceSerial>");
  process.exit(1);
}

try {
  process.stdout.write(biometricDeviceCredential(master, organizationId, deviceSerial) + "\n");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not generate biometric device credential.");
  process.exit(1);
}
