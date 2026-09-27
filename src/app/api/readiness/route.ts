import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices, outbox, subscriptions, users } from "@/db/schema";
import { activeMailProvider, deliveryCapable } from "@/lib/mail-provider";
import { verifyPassword } from "@/lib/crypto";

export const dynamic = "force-dynamic";

type Gate = { key: string; label: string; ready: boolean; detail: string; blocks: "launch" | "scale" | "none"; manualWorkaround?: string };

const flag = (name: string) => process.env[name] === "true" || Boolean(process.env[name]);

export async function GET() {
  const [{ value: userCount }] = await db.select({ value: count() }).from(users);
  const [{ value: queuedMail }] = await db.select({ value: count() }).from(outbox).where(eq(outbox.status, "queued"));
  const [{ value: paidInvoices }] = await db.select({ value: count() }).from(invoices).where(eq(invoices.status, "paid"));
  const [{ value: activeSubs }] = await db.select({ value: count() }).from(subscriptions).where(eq(subscriptions.status, "active"));

  const provider = activeMailProvider();

  // The public demo intentionally keeps a seeded review identity, but password
  // login for demo identities is blocked and sessions are issued only through
  // the rate-limited sandbox launcher. verifyPassword is used here because
  // scrypt hashes contain random salts and cannot be compared as raw strings.
  const reviewEmail = "celine@linaw.ph";
  const [reviewAccount] = await db.select({
    id: users.id,
    passwordHash: users.passwordHash,
  }).from(users).where(eq(users.email, reviewEmail)).limit(1);
  const reviewCredentialSeeded = Boolean(reviewAccount)
    && verifyPassword("LinawDemo2026!", reviewAccount!.passwordHash);

  // Billing provider is considered wired when a live key is present OR real paid
  // invoices exist in the ledger (the checkout path already writes them).
  const billingConfigured = flag("PAYMONGO_SECRET_KEY") || flag("MAYA_SECRET_KEY") || flag("STRIPE_SECRET_KEY");
  const billingProven = billingConfigured && (paidInvoices > 0 || activeSubs > 0);

  const bankConfigured = flag("BANK_HOST_TO_HOST_URL") || flag("INSTAPAY_API_KEY")
    || (flag("PAYMONGO_SECRET_KEY") && process.env.PAYMONGO_DISBURSEMENTS_ENABLED === "true");

  // Government filing does not require vendor accreditation for standard
  // file-based submission — BIR publishes the Alphalist .DAT layout and
  // provides the ADES validation module free; SSS similarly publishes the
  // R-3 electronic format and a free R3 File Generator. The actual gate is
  // "has a human run our DRAFT output through the agency's own free
  // validator and confirmed it passes" — that's what each flag below
  // records, set by whoever does that check, not by us detecting it.
  const birAlphalistValidated = flag("BIR_ALPHALIST_VALIDATED");
  const sssR3Validated = flag("SSS_R3_VALIDATED");
  const philhealthValidated = flag("PHILHEALTH_RF1_VALIDATED");
  const pagibigValidated = flag("PAGIBIG_MCRF_VALIDATED");
  const storageConfigured = flag("S3_BUCKET") || flag("R2_BUCKET");

  const gates: Gate[] = [
    {
      key: "code-audit",
      label: "Payroll and authorization launch audit",
      ready: false,
      detail: "Core code-level blockers are hardened: explicit payroll periods and scope, period-limited attendance, side-effect-free recalculation, atomic release settlement, permission-based RBAC, managed-payroll client approval, release-before-disbursement, and tenant-scoped exports. Real payroll remains a controlled pilot until a clean production build/test run, migration rehearsal, final-pay tax handling, agency-format validation, and independent payroll reconciliation are complete.",
      blocks: "launch",
    },
    {
      key: "public-demo",
      label: "Public demo sandbox isolation",
      ready: true,
      detail: process.env.DEMO_MODE === "true"
        ? `Public demo is enabled. ${reviewCredentialSeeded ? "Seed identity is present, but normal password login is blocked;" : "Seed identity will be created on demo initialization;"} demo sessions are rate-limited and restricted to fixed demo organizations. Real payouts, invitations, billing, API keys, webhooks, and account changes are blocked for demo sessions.`
        : "Public demo is disabled. Customer accounts use normal authentication.",
      blocks: "none",
    },
    {
      key: "email-delivery",
      label: "Transactional email provider",
      ready: deliveryCapable(),
      detail: deliveryCapable()
        ? `Active provider: ${provider}. Password resets and invitations send immediately.`
        : "No provider configured. Set RESEND_API_KEY, POSTMARK_SERVER_TOKEN, or SMTP_URL — the adapter is already wired; messages queue in the outbox until then.",
      blocks: deliveryCapable() ? "none" : "launch",
    },
    {
      key: "billing",
      label: "Subscription billing",
      ready: billingProven,
      detail: billingProven
        ? `Billing live via configured provider. ${paidInvoices} paid invoice(s), ${activeSubs} active subscription(s) on record.`
        : "Checkout flow, subscriptions, and invoice ledger are built and enforce plan entitlements. Set PAYMONGO_SECRET_KEY / MAYA_SECRET_KEY to charge real cards, or use `scripts/manual-activate-subscription.ts` to record an off-platform payment (GCash/bank transfer) — entitlements behave identically either way.",
      blocks: billingProven ? "none" : "launch",
      manualWorkaround: billingProven ? undefined : "Run scripts/manual-activate-subscription.ts after confirming payment yourself (GCash/bank transfer).",
    },
    {
      key: "bank-validation",
      label: "Bank file validation with live banks",
      ready: bankConfigured,
      detail: bankConfigured
        ? "Host-to-host / InstaPay / PayMongo Disbursements endpoint configured."
        : "BDO/BPI/GCash files are generated and dry-run validated. A bookkeeper can upload these by hand to online banking / GCash for Business today. Or: PayMongo Disbursements (already integrated for billing) can submit payroll via InstaPay/PESONet with no per-bank negotiation — see src/lib/paymongo-disbursements.ts — once the Wallet is verified as a Registered Business and PAYMONGO_DISBURSEMENTS_ENABLED=true is set.",
      blocks: bankConfigured ? "none" : "launch",
      manualWorkaround: bankConfigured ? undefined : "Download the generated bank file from a payroll run and upload it by hand to online banking / GCash for Business.",
    },
    {
      key: "gov-bir-alphalist",
      label: "BIR Alphalist / 2316 validated in ADES",
      ready: birAlphalistValidated,
      detail: birAlphalistValidated
        ? "Output has been run through BIR's free Alphalist Data Entry and Validation Module (ADES) and passed."
        : "No BIR accreditation is required for standard filing — BIR publishes the Alphalist .DAT layout and provides ADES free. Our DRAFT export is a plain CSV of the right figures, not yet the exact ADES-importable layout (it's missing a middle-name field and precise TIN/branch-code splitting). Someone needs to enter the DRAFT figures into ADES by hand (or finish matching the exact layout) and confirm it validates clean, then set BIR_ALPHALIST_VALIDATED=true.",
      blocks: birAlphalistValidated ? "none" : "launch",
      manualWorkaround: birAlphalistValidated ? undefined : "Enter the DRAFT figures into BIR's free ADES tool by hand and file via eAFS once it validates.",
    },
    {
      key: "gov-sss-r3",
      label: "SSS R-3 validated",
      ready: sssR3Validated,
      detail: sssR3Validated
        ? "Output has been run through SSS's own R3 File Generator / My.SSS upload and confirmed accepted."
        : "No SSS accreditation is required either — SSS publishes the R-3 electronic format and provides a free R3 File Generator. Enter the DRAFT figures there, confirm it's accepted, then set SSS_R3_VALIDATED=true.",
      blocks: sssR3Validated ? "none" : "launch",
      manualWorkaround: sssR3Validated ? undefined : "Enter the DRAFT figures into SSS's free R3 File Generator or My.SSS upload by hand.",
    },
    {
      key: "gov-philhealth-rf1",
      label: "PhilHealth RF-1 validated",
      ready: philhealthValidated,
      detail: philhealthValidated
        ? "Output has been confirmed accepted through PhilHealth's electronic remittance system."
        : "PhilHealth also has a file-based path: an \"RF-1 Excel Format\" template they provide, filled in and saved as a delimited textfile, submitted through EPRS or a partner bank's upload facility — not just manual UI entry. We haven't built a generator for that exact template (haven't confirmed its column layout), so for now enter the DRAFT figures directly into EPRS by hand, confirm accepted, then set PHILHEALTH_RF1_VALIDATED=true.",
      blocks: philhealthValidated ? "none" : "launch",
      manualWorkaround: philhealthValidated ? undefined : "Enter the DRAFT figures into PhilHealth's EPRS by hand (or their RF-1 Excel template, if you obtain the current column spec from PhilHealth directly).",
    },
    {
      key: "gov-pagibig-mcrf",
      label: "Pag-IBIG MCRF validated",
      ready: pagibigValidated,
      detail: pagibigValidated
        ? "Output has been confirmed accepted through Pag-IBIG's employer e-services portal."
        : "Unlike BIR/SSS/PhilHealth, I could not confirm a published batch-file upload spec for Pag-IBIG's MCRF — other PH payroll tools appear to only generate a filled PDF form for this one, not a machine-importable file. Treat this as portal data entry (Virtual Pag-IBIG employer e-services) until someone confirms otherwise directly with Pag-IBIG.",
      blocks: pagibigValidated ? "none" : "launch",
      manualWorkaround: pagibigValidated ? undefined : "Enter the DRAFT figures into Pag-IBIG's Virtual employer e-services portal by hand.",
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
      ready: flag("MALWARE_SCAN_URL"),
      detail: flag("MALWARE_SCAN_URL")
        ? "Signature/AV scanning endpoint configured."
        : "Content-type, magic-byte and size checks run on the request path. Wire MALWARE_SCAN_URL for a full AV engine.",
      blocks: "scale",
    },
    {
      key: "sso",
      label: "SSO / SAML",
      ready: flag("SAML_METADATA_URL"),
      detail: flag("SAML_METADATA_URL")
        ? "SAML identity provider configured."
        : "Password + TOTP only. Auth is pluggable; add a SAML method when an enterprise IdP is available.",
      blocks: "scale",
    },
    {
      key: "background-worker",
      label: "Dedicated background worker",
      ready: flag("WORKER_ENABLED"),
      detail: flag("WORKER_ENABLED")
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
        : `${launchBlockers.length} launch blocker(s) remain. This includes code-level gates as well as provider and government-validation gates.`,
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
