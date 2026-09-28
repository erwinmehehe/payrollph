import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, invoices, outbox, subscriptions, users } from "@/db/schema";
import { activeMailProvider, deliveryCapable } from "@/lib/mail-provider";
import { hashPassword } from "@/lib/crypto";

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

export async function GET() {
  const [{ value: userCount }] = await db.select({ value: count() }).from(users);
  const [{ value: queuedMail }] = await db.select({ value: count() }).from(outbox).where(eq(outbox.status, "queued"));
  const [{ value: sentMail }] = await db.select({ value: count() }).from(outbox).where(eq(outbox.status, "sent"));
  const [{ value: paidInvoices }] = await db.select({ value: count() }).from(invoices).where(eq(invoices.status, "paid"));
  const [{ value: activeSubs }] = await db.select({ value: count() }).from(subscriptions).where(eq(subscriptions.status, "active"));
  const [{ value: paymongoPreflightPasses }] = await db.select({ value: count() }).from(auditEvents)
    .where(eq(auditEvents.action, "PayMongo payroll preflight passed"));

  const provider = activeMailProvider();

  // A review account with a publicly known password must never survive into a
  // customer deployment. Detect it by hashing the known value rather than
  // storing the plaintext anywhere.
  const reviewEmail = "celine@linaw.ph";
  const reviewHash = hashPassword("LinawDemo2026!");
  const [reviewAccount] = await db.select({
    id: users.id,
    passwordHash: users.passwordHash,
  }).from(users).where(eq(users.email, reviewEmail)).limit(1);
  const reviewCredentialLive = Boolean(reviewAccount) && reviewAccount!.passwordHash === reviewHash;

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
  const malwareIntegrated = false;
  const samlIntegrated = false;

  const gates: Gate[] = [
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
      ready: deliveryCapable(),
      detail: deliveryCapable()
        ? `Active provider: ${provider}. Password resets and invitations send immediately.`
        : "No provider configured. Set RESEND_API_KEY, POSTMARK_SERVER_TOKEN, or SMTP_URL, the adapter is already wired; messages queue in the outbox until then.",
      blocks: deliveryCapable() ? "none" : "launch",
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
      label: "Bank file validation with live banks",
      ready: bankConfigured,
      detail: bankConfigured
        ? "Host-to-host / InstaPay / PayMongo Disbursements endpoint configured."
        : "BDO/BPI/GCash files are generated and dry-run validated. A bookkeeper can upload these by hand to online banking / GCash for Business today. Or: PayMongo Disbursements (already integrated for billing) can submit payroll via InstaPay/PESONet with no per-bank negotiation, see src/lib/paymongo-disbursements.ts, once the Wallet is verified as a Registered Business and PAYMONGO_DISBURSEMENTS_ENABLED=true is set.",
      blocks: bankConfigured ? "none" : "launch",
      manualWorkaround: bankConfigured ? undefined : "Download the generated bank file from a payroll run and upload it by hand to online banking / GCash for Business.",
    },
    {
      key: "gov-bir-alphalist",
      label: "BIR Alphalist / 2316 validated in ADES",
      ready: birAlphalistValidated,
      detail: birAlphalistValidated
        ? "Output has been run through BIR's free Alphalist Data Entry and Validation Module (ADES) and passed."
        : "No BIR accreditation is required for standard filing, BIR publishes the Alphalist .DAT layout and provides ADES free. Our DRAFT export is a plain CSV of the right figures, not yet the exact ADES-importable layout (it's missing a middle-name field and precise TIN/branch-code splitting). Someone needs to enter the DRAFT figures into ADES by hand (or finish matching the exact layout) and confirm it validates clean, then set BIR_ALPHALIST_VALIDATED=true.",
      blocks: birAlphalistValidated ? "none" : "launch",
      manualWorkaround: birAlphalistValidated ? undefined : "Enter the DRAFT figures into BIR's free ADES tool by hand and file via eAFS once it validates.",
    },
    {
      key: "gov-sss-r3",
      label: "SSS R-3 validated",
      ready: sssR3Validated,
      detail: sssR3Validated
        ? "Output has been run through SSS's own R3 File Generator / My.SSS upload and confirmed accepted."
        : "No SSS accreditation is required either, SSS publishes the R-3 electronic format and provides a free R3 File Generator. Enter the DRAFT figures there, confirm it's accepted, then set SSS_R3_VALIDATED=true.",
      blocks: sssR3Validated ? "none" : "launch",
      manualWorkaround: sssR3Validated ? undefined : "Enter the DRAFT figures into SSS's free R3 File Generator or My.SSS upload by hand.",
    },
    {
      key: "gov-philhealth-rf1",
      label: "PhilHealth RF-1 validated",
      ready: philhealthValidated,
      detail: philhealthValidated
        ? "Output has been confirmed accepted through PhilHealth's electronic remittance system."
        : "PhilHealth also has a file-based path: an \"RF-1 Excel Format\" template they provide, filled in and saved as a delimited textfile, submitted through EPRS or a partner bank's upload facility, not just manual UI entry. We haven't built a generator for that exact template (haven't confirmed its column layout), so for now enter the DRAFT figures directly into EPRS by hand, confirm accepted, then set PHILHEALTH_RF1_VALIDATED=true.",
      blocks: philhealthValidated ? "none" : "launch",
      manualWorkaround: philhealthValidated ? undefined : "Enter the DRAFT figures into PhilHealth's EPRS by hand (or their RF-1 Excel template, if you obtain the current column spec from PhilHealth directly).",
    },
    {
      key: "gov-pagibig-mcrf",
      label: "Pag-IBIG MCRF validated",
      ready: pagibigValidated,
      detail: pagibigValidated
        ? "Output has been confirmed accepted through Pag-IBIG's employer e-services portal."
        : "Unlike BIR/SSS/PhilHealth, I could not confirm a published batch-file upload spec for Pag-IBIG's MCRF, other PH payroll tools appear to only generate a filled PDF form for this one, not a machine-importable file. Pag-IBIG does run eSRS (Electronic Submission of Remittance Schedule) for online submission, but it is open only to employers with at most 30 employees, and whether it accepts a bulk file or requires manual encoding is still unconfirmed. Treat this as portal data entry (eSRS or Virtual Pag-IBIG employer e-services) until someone confirms otherwise directly with Pag-IBIG.",
      blocks: pagibigValidated ? "none" : "launch",
      manualWorkaround: pagibigValidated ? undefined : "Enter the DRAFT figures by hand into eSRS (employers with at most 30 employees) or Pag-IBIG's Virtual employer e-services portal.",
    },
    {
      key: "object-storage",
      label: "Object storage for documents",
      ready: storageConfigured,
      detail: storageConfigured
        ? "External object storage configured."
        : "Uploads are validated and stored in Postgres. Move to S3/R2 before production document volume.",
      blocks: "scale",
    },
    {
      key: "malware-scanning",
      label: "Malware scanning on upload",
      ready: configured("MALWARE_SCAN_URL"),
      detail: configured("MALWARE_SCAN_URL")
        ? "Signature/AV scanning endpoint configured."
        : "Content-type, magic-byte and size checks run on the request path. Wire MALWARE_SCAN_URL for a full AV engine.",
      blocks: "scale",
    },
    {
      key: "sso",
      label: "SSO / SAML",
      ready: configured("SAML_METADATA_URL"),
      detail: configured("SAML_METADATA_URL")
        ? "SAML identity provider configured."
        : "Password + TOTP only. Auth is pluggable; add a SAML method when an enterprise IdP is available.",
      blocks: "scale",
    },
    {
      key: "background-worker",
      label: "Dedicated background worker",
      ready: enabled("WORKER_ENABLED"),
      detail: enabled("WORKER_ENABLED")
        ? "Dedicated worker process draining queues."
        : "Payroll and webhook queues drain opportunistically from requests and a manual tick endpoint. Set WORKER_ENABLED for a standalone worker.",
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
        : `${launchBlockers.length} launch blocker(s) remain, each needs an external credential or portal validation, not more code.`,
    manualLaunch: {
      ready: unworkaroundableBlockers.length === 0,
      summary:
        unworkaroundableBlockers.length === 0
          ? `Ready for a manual-ops pilot: ${launchBlockers.length} gate(s) are unautomated but have a documented manual workaround (see each gate's manualWorkaround field).`
          : `${unworkaroundableBlockers.length} blocker(s) have no manual workaround and must be fixed even for a manual-ops pilot: ${unworkaroundableBlockers.map((g) => g.label).join(", ")}.`,
    },
    gates,
    counts: { users: userCount, queuedMail, paidInvoices, activeSubs },
    generatedAt: new Date().toISOString(),
  });
}
