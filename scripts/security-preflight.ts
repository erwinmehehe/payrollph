import { operationalSecretSource } from "../src/lib/operational-secret";
import { Buffer } from "node:buffer";

type Check = { key: string; ok: boolean; detail: string };

const env = process.env as Record<string, string | undefined>;

function strongSecret(name: string, minimumBytes = 32): Check {
  const value = env[name]?.trim() ?? "";
  return {
    key: name,
    ok: Buffer.byteLength(value) >= minimumBytes,
    detail: value
      ? `${Buffer.byteLength(value)} byte(s); minimum ${minimumBytes}`
      : "missing",
  };
}

function validTotpKey(): Check {
  const raw = env.TOTP_ENCRYPTION_KEY?.trim() ?? "";
  let valid = false;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    valid = true;
  } else if (raw) {
    try {
      valid = Buffer.from(raw, "base64").length === 32;
    } catch {
      valid = false;
    }
  }
  return {
    key: "TOTP_ENCRYPTION_KEY",
    ok: valid,
    detail: valid ? "valid 32-byte key" : "must be exactly 32 bytes as 64 hex characters or base64",
  };
}

function httpsUrl(name: string): Check {
  const raw = env[name]?.trim() ?? "";
  let ok = false;
  try {
    ok = new URL(raw).protocol === "https:";
  } catch {
    ok = false;
  }
  return { key: name, ok, detail: ok ? raw : "must be a valid HTTPS URL" };
}

const checks: Check[] = [
  httpsUrl("APP_BASE_URL"),
  httpsUrl("MALWARE_SCAN_URL"),
  optionalStrongSecret("WORKER_TOKEN", "not configured; remote scheduler endpoint remains disabled"),
  optionalStrongSecret("READINESS_TOKEN", "not configured; detailed readiness endpoint remains disabled"),
  strongSecret("SETUP_TOKEN"),
  strongSecret("MALWARE_SCAN_TOKEN"),
  validTotpKey(),
  {
    key: "DATABASE_URL",
    ok: Boolean(env.DATABASE_URL?.trim()),
    detail: env.DATABASE_URL?.trim() ? "configured" : "missing",
  },
  {
    key: "DEMO_MODE",
    ok: env.DEMO_MODE === "false",
    detail: env.DEMO_MODE === "false" ? "false" : "must be exactly false in production",
  },
  {
    key: "REQUIRE_PRIVILEGED_MFA",
    ok: env.REQUIRE_PRIVILEGED_MFA !== "false",
    detail: env.REQUIRE_PRIVILEGED_MFA === "false" ? "must not be disabled" : env.REQUIRE_PRIVILEGED_MFA ?? "defaults secure",
  },
];

const failures = checks.filter((check) => !check.ok);

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.key}: ${check.detail}`);
}

if (failures.length > 0) {
  console.error(`\nProduction security preflight failed: ${failures.length} check(s) need attention.`);
  process.exit(1);
}

console.log("\nProduction security preflight passed.");
