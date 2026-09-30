import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, invoices, outbox, subscriptions, users } from "@/db/schema";
import { activeMailProvider, deliveryCapable } from "@/lib/mail-provider";
import { verifyPassword } from "@/lib/crypto";
import { constantTimeSecretEqual } from "@/lib/security-secret";
import { malwareScannerConfigured } from "@/lib/storage";

export const dynamic = "force-dynamic";

type Gate = { key: string; label: string; ready: boolean; detail: string; blocks: "launch" | "scale" | "none"; manualWorkaround?: string };

/**
 * Two different questions were being asked through one helper. A credential or
 * endpoint is configured when it holds any value at all, but a yes/no gate has
 * to say "true": treating a non-empty string as true meant SSS_R3_VALIDATED=false
 * read as validated, and DEMO_MODE=false read as demo mode being on.
 */
const configured = (name: string) => Boolean(process.env[name]);
const enabled = (name: string) => process.env[name] === "true";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    const expected = process.env.READINESS_TOKEN ?? process.env.WORKER_TOKEN;
    if (!expected) {
      return Response.json({ error: "Readiness diagnostics are disabled until READINESS_TOKEN or WORKER_TOKEN is configured." }, { status: 503 });
    }
    const supplied = request.headers.get("x-readiness-token") ?? request.headers.get("x-worker-token");
    if (!constantTimeSecretEqual(supplied, expected)) {
      return Response.json({ error: "A valid readiness token is required." }, { status: 401 });
    }
  }

  const [{ value: userCount }] = await db.select({ value: count() }).from(users);
  const [{ value: queuedMail }] = await db.select({ value: count() }).from(outbox).where(eq(outbox.status, "queued"));
  const [{ value: sentMail }] = await db.select({ value: count() }).from(outbox).where(eq(outbox.status, "sent"));
  const [{ value: failedMail }] = await db.select({ value: count() }).from(outbox).where(eq(outbox.status, "failed"));
  const [{ value: paidInvoices }] = await db.select({ value: count() }).from(invoices).where(eq(invoices.status, "paid"));
  const [{ value: activeSubs }] = await db.select({ value: count() }).from(subscriptions).where(eq(subscriptions.status, "active"));
  const [{ value: paymongoPreflightPasses }] = await db.select({ value: count() }).from(auditEvents)
    .where(eq(auditEvents.action, "PayMongo payroll preflight passed"));

  const provider = activeMailProvider();

  // A review account with a publicly known password must never survive into a
  // customer deployment. Detect it by hashing the known value rather than
  // storing the plaintext anywhere.
  const reviewEmail = "celine@linaw.ph";
  const [reviewAccount] = await db.select({
    id: users.id,
    passwordHash: users.passwordHash,
  }).from(users).where(eq(users.email, reviewEmail)).limit(1);
  const reviewCredentialLive = Boolean(reviewAccount) && verifyPassword("LinawDemo2026!", reviewAccount!.passwordHash);

  // Billing is proven by ledger state, regardless of whether the customer paid
  // through a processor or the operator recorded a confirmed bank/GCash payment.
  // Provider configuration answers "can we charge online?", while paid invoices
  // and active subscriptions answer "does billing actually enforce entitlements?"
  const billingConfigured = configured("PAYMONGO_SECRET_KEY") || configured("MAYA_SECRET_KEY") || configured("STRIPE_SECRET_KEY");
  const billingProven = paidInvoices > 0 || activeSubs > 0;

  const directBankConfigured = configured("BANK_HOST_TO_HOST_URL") || configured("INSTAPAY_API_KEY");
  const paymongoDisbursementEnabled = configured("PAYMONGO_SECRET_KEY") && enabled("PAYMONGO_DISBURSEMENTS_ENABLED");
  const paymongoPreflightProven = Number(paymongoPreflightPasses) > 0;
  const bankReady = directBankConfigured || (paymongoDisbursementEnabled && paymongoPreflightProven);

  // Government filing does not require vendor accreditation for standard
  // file-based submission, BIR publishes the Alphalist .DAT layout and
  // provides the ADES validation module free; SSS similarly publishes the
  // R-3 electronic format and a free R3 File Generator. The actual gate is
  // "has a human run our DRAFT output through the agency's own free
  // validator and confirmed it passes", that's what each flag below
  // records, set by whoever does that check, not by us detecting it.
  const demoMode = enabled("DEMO_MODE");
  const birAlphalistValidated = enabled("BIR_ALPHALIST_VALIDATED");
  const sssR3Validated = enabled("SSS_R3_VALIDATED");
  const philhealthValidated = enabled("PHILHEALTH_RF1_VALIDATED");
  const pagibigValidated = enabled("PAGIBIG_MCRF_VALIDATED");
  const storageConfigured = configured("S3_BUCKET") || configured("R2_BUCKET");
  const storageIntegrated = false;
  const malwareEndpointConfigured = configured("MALWARE_SCAN_URL");
  const malwareIntegrated = malwareScannerConfigured();
  const samlIntegrated = false;

  const appBaseUrl = process.env.APP_BASE_URL ?? "";
  const productionSecurityConfigured =
    process.env.NODE_ENV !== "production" ||
    (
      /^https:\/\//i.test(appBaseUrl) &&
      configured("WORKER_TOKEN") &&
      configured("TOTP_ENCRYPTION_KEY") &&
      configured("READINESS_TOKEN")
    );

  const gates: Gate[] = [
    {
      key: "production-security-config",
      label: "Production security configuration",
      ready: productionSecurityConfigured,
      detail: productionSecurityConfigured
        ? "Canonical HTTPS origin, worker token, TOTP encryption key and readiness token are configured."
        : "Configure HTTPS APP_BASE_URL, WORKER_TOKEN, TOTP_ENCRYPTION_KEY and READINESS_TOKEN before production launch.",
      blocks: productionSecurityConfigured ? "none" : "launch",
    },
    {
      key: "review-credential",
      label: "No publicly known review password",
      ready: !reviewCredentialLive,
      detail: reviewCredentialLive
        ? `${reviewEmail} still uses the shared review password. Rotate it before taking real customers.`
        : "No account is using the shared review password.",
      blocks: reviewCredentialLive ? "launch" : "none",
    },
    {
      key: "seeded-credentials",
      label: "No hardcoded demo credentials",
      ready: !demoMode,
      detail: demoMode
        ? "DEMO_MODE=true is seeding the shared demo account. Disable it before taking real customers."
        : "Demo seeding is off; accounts are created through setup or invitation.",
      blocks: userCount > 0 && demoMode ? "launch" : "none",
    },
    {
      key: "email-delivery",
      label: "Transactional email provider",
      ready: deliveryCapable() && Number(sentMail) > 0,
      detail: deliveryCapable()
        ? Number(sentMail) > 0
          ? `Active provider: ${provider}. ${sentMail} successful delivery record(s); ${failedMail} message(s) currently failed and visible in the outbox.`
          : `Provider ${provider} is configured, but this deployment has not recorded a successful delivery yet.`
        : "No provider configured. Messages remain queued until a transactional email provider is connected.",
      blocks: deliveryCapable() && Number(sentMail) > 0 ? "none" : "launch",
    },
    {
      key: "billing",
      label: "Subscription billing",
      ready: billingProven,
      detail: billingProven
        ? `Billing ledger proven: ${paidInvoices} paid invoice(s), ${activeSubs} active subscription(s). Online processor configured: ${billingConfigured ? "yes" : "no, current proof is manual/off-platform"}.`
        : "Checkout flow, subscriptions, and invoice ledger are built and enforce plan entitlements. Complete one real checkout, or use scripts/manual-activate-subscription.ts only after confirming an actual GCash/bank transfer.",
      blocks: billingProven ? "none" : "launch",
      manualWorkaround: billingProven ? undefined : "Run scripts/manual-activate-subscription.ts after confirming payment yourself (GCash/bank transfer).",
    },
    {
      key: "bank-validation",
      label: "Payroll disbursement validation",
      ready: bankReady,
      detail: bankReady
        ? directBankConfigured
          ? "A direct bank payout endpoint is configured."
          : `PayMongo Disbursements is enabled and a no-money payroll preflight has passed (${paymongoPreflightPasses} recorded pass(es)).`
        : paymongoDisbursementEnabled
          ? "PayMongo Disbursements is enabled, but no no-money payroll preflight has proven credentials and employee bank mappings yet."
          : "Bank files remain available for manual upload. PayMongo batch-transfer code and a no-money preflight are implemented, but live disbursement is not enabled.",
      blocks: bankReady ? "none" : "launch",
      manualWorkaround: bankReady ? undefined : "Download the bank file from a released payroll run and upload it manually through the bank or e-wallet business portal.",
    },
    {
      key: "gov-bir-alphalist",
      label: "BIR Alphalist / 2316 validated in ADES",
      ready: birAlphalistValidated,
      detail: birAlphalistValidated
        ? "A generated annual extract has been validated in the current BIR Alphalist module."
        : "Employee middle name, employee TIN, and employer TIN/branch fields are now modeled and preflighted. Exact current 1604-C/ADES DAT generation and an actual ADES acceptance result are still required before filing-ready status.",
      blocks: birAlphalistValidated ? "none" : "launch",
      manualWorkaround: birAlphalistValidated ? undefined : "Enter the DRAFT figures into BIR's free ADES tool by hand and file via eAFS once it validates.",
    },
    {
      key: "gov-sss-r3",
      label: "SSS R-3 validated",
      ready: sssR3Validated,
      detail: sssR3Validated
        ? "A generated R-3 dataset has been accepted by the SSS employer workflow."
        : "The R-3 draft now uses each employee's real SSS number and full monthly employee/employer/EC amounts. Acceptance in the official R3 File Generator / My.SSS employer workflow is still pending.",
      blocks: sssR3Validated ? "none" : "launch",
      manualWorkaround: sssR3Validated ? undefined : "Enter the DRAFT figures into SSS's free R3 File Generator or My.SSS upload by hand.",
    },
    {
      key: "gov-philhealth-rf1",
      label: "PhilHealth RF-1 validated",
      ready: philhealthValidated,
      detail: philhealthValidated
        ? "A generated remittance dataset has been accepted through PhilHealth's employer reporting workflow."
        : "The draft now uses each employee's real PhilHealth PIN and recomputes full monthly employee/employer premium shares. PhilHealth EPRS acknowledgement is still required; the current CSV is a portal-entry aid, not a claimed EPRS import file.",
      blocks: philhealthValidated ? "none" : "launch",
      manualWorkaround: philhealthValidated ? undefined : "Enter the DRAFT figures into PhilHealth's EPRS by hand (or their RF-1 Excel template, if you obtain the current column spec from PhilHealth directly).",
    },
    {
      key: "gov-pagibig-mcrf",
      label: "Pag-IBIG MCRF validated",
      ready: pagibigValidated,
      detail: pagibigValidated
        ? "A generated remittance schedule has been accepted through Pag-IBIG employer e-services."
        : "The draft now uses each employee's real Pag-IBIG MID and full monthly employee/employer contribution. It remains an eSRS/employer-portal entry aid until a real employer acknowledgement is recorded.",
      blocks: pagibigValidated ? "none" : "launch",
      manualWorkaround: pagibigValidated ? undefined : "Enter the DRAFT figures by hand into eSRS (employers with at most 30 employees) or Pag-IBIG's Virtual employer e-services portal.",
    },
    {
      key: "object-storage",
      label: "Object storage for documents",
      ready: storageIntegrated,
      detail: storageConfigured
        ? "S3/R2 bucket configuration is present, but the document request path still stores file content in Postgres. Object storage is not integrated yet."
        : "Uploads are validated and stored in Postgres. S3/R2 integration remains a scale task.",
      blocks: "scale",
    },
    {
      key: "malware-scanning",
      label: "Malware scanning on upload",
      ready: malwareIntegrated,
      detail: malwareIntegrated
        ? "Malware scanning is wired into document uploads and production fails closed unless the scanner reports the file clean."
        : malwareEndpointConfigured
          ? "Malware scanning is wired in, but production still needs a valid HTTPS MALWARE_SCAN_URL and MALWARE_SCAN_TOKEN."
          : "Content-type, magic-byte and size checks run, but production uploads stay disabled until MALWARE_SCAN_URL and MALWARE_SCAN_TOKEN are configured.",
      blocks: malwareIntegrated ? "none" : "launch",
    },
    {
      key: "sso",
      label: "SSO / SAML",
      ready: samlIntegrated,
      detail: configured("SAML_METADATA_URL")
        ? "SAML metadata is configured, but no SAML callback/session implementation exists yet. Keep this disabled until an enterprise IdP is actually required."
        : "Deferred by design. Password + TOTP is the supported auth path until an enterprise customer requires SSO/SAML.",
      blocks: "scale",
    },
    {
      key: "background-worker",
      label: "Dedicated background worker",
      ready: enabled("WORKER_ENABLED"),
      detail: enabled("WORKER_ENABLED")
        ? "Dedicated worker is enabled; scripts/worker.ts drains payroll jobs and webhook retries."
        : "Dedicated worker code exists at scripts/worker.ts. Set WORKER_ENABLED=true and run npm run worker in a persistent worker service to activate it.",
      blocks: "scale",
    },
  ];

  const launchBlockers = gates.filter((gate) => gate.blocks === "launch" && !gate.ready);
  const scaleBlockers = gates.filter((gate) => gate.blocks === "scale" && !gate.ready);
  const unworkaroundableBlockers = launchBlockers.filter((gate) => !gate.manualWorkaround);

  return Response.json({
    status: launchBlockers.length === 0 ? "launch-ready" : "not-launch-ready",
    launchBlockersRemaining: launchBlockers.length,
    scaleGapsRemaining: scaleBlockers.length,
    summary:
      launchBlockers.length === 0
        ? "All launch-blocking gates are green. Remaining items only affect enterprise scale."
        : `${launchBlockers.length} launch blocker(s) remain. Review each gate separately: some need external proof and some still require implementation work.`,
    manualLaunch: {
      ready: unworkaroundableBlockers.length === 0,
      summary:
        unworkaroundableBlockers.length === 0
          ? `Ready for a manual-ops pilot: ${launchBlockers.length} gate(s) are unautomated but have a documented manual workaround (see each gate's manualWorkaround field).`
          : `${unworkaroundableBlockers.length} blocker(s) have no manual workaround and must be fixed even for a manual-ops pilot: ${unworkaroundableBlockers.map((g) => g.label).join(", ")}.`,
    },
    gates,
    counts: { users: userCount, queuedMail, sentMail, failedMail, paidInvoices, activeSubs, paymongoPreflightPasses },
    generatedAt: new Date().toISOString(),
  });
}
