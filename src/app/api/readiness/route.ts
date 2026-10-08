import { and, count, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, contractors, employees, invoices, outbox, payrollEntries, subscriptions, users } from "@/db/schema";
import { bankEncryptionConfigured, bankEncryptionKeySource } from "@/lib/bank-account-crypto";
import { governmentIdEncryptionConfigured } from "@/lib/government-id-crypto";
import { describeEvidenceGap, findFilingForm } from "@/lib/filing-evidence";
import { filingEvidenceSummaries } from "@/lib/filing-evidence-store";
import { activeMailProvider, deliveryCapable } from "@/lib/mail-provider";
import { verifyPassword } from "@/lib/crypto";
import { constantTimeSecretEqual } from "@/lib/security-secret";
import { operationalSecret, operationalSecretConfigured, operationalSecretSource } from "@/lib/operational-secret";
import { documentUploadsEnabled, malwareScannerConfigured } from "@/lib/storage";
import { ensureCoreCompatibilitySchema } from "@/lib/core-schema-compat";
import { acceptedBankFileValidationCount } from "@/lib/bank-evidence-store";

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

export async function buildReadinessPayload() {
  await ensureCoreCompatibilitySchema();
  const [{ value: userCount }] = await db.select({ value: count() }).from(users);
  const [{ value: queuedMail }] = await db.select({ value: count() }).from(outbox).where(eq(outbox.status, "queued"));
  const [{ value: sentMail }] = await db.select({ value: count() }).from(outbox).where(eq(outbox.status, "sent"));
  const [{ value: deliveredMail }] = await db.select({ value: count() }).from(outbox).where(eq(outbox.deliveryStatus, "delivered"));
  const [{ value: failedMail }] = await db.select({ value: count() }).from(outbox).where(eq(outbox.status, "failed"));
  const [{ value: paidInvoices }] = await db.select({ value: count() }).from(invoices).where(eq(invoices.status, "paid"));
  const [{ value: activeSubs }] = await db.select({ value: count() }).from(subscriptions).where(eq(subscriptions.status, "active"));
  const [{ value: paymongoPreflightPasses }] = await db.select({ value: count() }).from(auditEvents)
    .where(eq(auditEvents.action, "PayMongo payroll preflight passed"));
  // The no-money bank preview milestone must NEVER satisfy the broad-launch
  // production pilot gate. Count only explicit completed-payout proof from the
  // newer sign-off route; legacy records without that mode need re-verification.
  const [{ value: productionPilotSignoffs }] = await db.select({ value: count() }).from(auditEvents)
    .where(and(
      eq(auditEvents.action, "Production payroll pilot signed off"),
      sql`${auditEvents.metadata} ->> 'payoutEvidenceMode' = 'completed-payout'`,
    ));
  const [{ value: noMoneyPilotReconciliations }] = await db.select({ value: count() }).from(auditEvents)
    .where(and(
      eq(auditEvents.action, "Production payroll pilot signed off"),
      sql`${auditEvents.metadata} ->> 'payoutEvidenceMode' = 'no-money-bank-file-dry-run'`,
    ));
  const acceptedBankFileValidations = await acceptedBankFileValidationCount();

  const [{ value: plaintextBankAccounts }] = await db.select({ value: count() }).from(employees)
    .where(and(
      isNotNull(employees.bankAccount),
      sql`${employees.bankAccount} <> ''`,
      sql`${employees.bankAccount} not like 'enc:v1:%'`,
    ));

  const [{ value: plaintextBankSnapshots }] = await db
    .select({ value: count() })
    .from(payrollEntries)
    .where(sql`${payrollEntries.trace} #>> '{payment,bankAccount}' is not null
      and ${payrollEntries.trace} #>> '{payment,bankAccount}' <> ''
      and ${payrollEntries.trace} #>> '{payment,bankAccount}' not like 'enc:v1:%'`);

  const [{ value: plaintextEmployeeGovernmentIds }] = await db.select({ value: count() }).from(employees)
    .where(sql`(
      (${employees.tin} is not null and ${employees.tin} <> '' and ${employees.tin} not like 'enc:govid:v1:%')
      or (${employees.tinBranchCode} is not null and ${employees.tinBranchCode} <> '' and ${employees.tinBranchCode} not like 'enc:govid:v1:%')
      or (${employees.sssNo} is not null and ${employees.sssNo} <> '' and ${employees.sssNo} not like 'enc:govid:v1:%')
      or (${employees.philHealthNo} is not null and ${employees.philHealthNo} <> '' and ${employees.philHealthNo} not like 'enc:govid:v1:%')
      or (${employees.pagIbigNo} is not null and ${employees.pagIbigNo} <> '' and ${employees.pagIbigNo} not like 'enc:govid:v1:%')
    )`);

  const [{ value: plaintextContractorTins }] = await db.select({ value: count() }).from(contractors)
    .where(sql`${contractors.tin} is not null
      and ${contractors.tin} <> ''
      and ${contractors.tin} not like 'enc:govid:v1:%'`);

  const [{ value: totalEmployees }] = await db.select({ value: count() }).from(employees);
  const [{ value: employeesMissingRestDay }] = await db.select({ value: count() }).from(employees)
    .where(sql`${employees.restDay} is null`);

  // SSS R-3 and the BIR Alphalist readiness come from recorded agency acceptance, not env flags.
  // The table can be missing on a database that has not been upgraded yet, and
  // that must read as "not proven" rather than taking readiness down.
  let filingEvidence: Awaited<ReturnType<typeof filingEvidenceSummaries>> = [];
  let filingEvidenceError: string | null = null;
  try {
    filingEvidence = await filingEvidenceSummaries();
  } catch {
    filingEvidenceError = "The filing evidence table is not available yet. Apply drizzle/0005_government_filing_validations.sql.";
  }
  const evidenceFor = (agency: string, form: string) =>
    filingEvidence.find((item) => item.definition.agency === agency && item.definition.form === form) ?? null;
  const sssEvidence = evidenceFor("SSS", "R-3");
  const bir1601Evidence = evidenceFor("BIR", "1601-C");
  const birEvidence = evidenceFor("BIR", "1604-C");
  const philhealthEvidence = evidenceFor("PhilHealth", "RF-1");
  const pagibigEvidence = evidenceFor("Pag-IBIG", "MCRF");

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
  const paymongoWebhookConfigured = configured("PAYMONGO_WEBHOOK_SECRET");
  const paymongoPreflightProven = Number(paymongoPreflightPasses) > 0;
  // The batch needs a source account, which Linaw reads from this wallet.
  const paymongoWalletConfigured = configured("PAYMONGO_WALLET_ID");
  const manualBankUatProven = acceptedBankFileValidations > 0;
  const bankReady =
    directBankConfigured
    || manualBankUatProven
    || (paymongoDisbursementEnabled && paymongoWalletConfigured && paymongoPreflightProven && paymongoWebhookConfigured);

  const bankKeyConfigured = bankEncryptionConfigured();
  const bankKeySource = bankEncryptionKeySource();
  const bankDataProtected =
    bankKeyConfigured
    && Number(plaintextBankAccounts) === 0
    && Number(plaintextBankSnapshots) === 0;

  const governmentIdKeyConfigured = governmentIdEncryptionConfigured();
  const governmentIdsProtected =
    governmentIdKeyConfigured
    && Number(plaintextEmployeeGovernmentIds) === 0
    && Number(plaintextContractorTins) === 0;

  // Government readiness is evidence-based. BIR Alphalist remains a strict
  // file-layout validation gate. SSS, PhilHealth and Pag-IBIG are portal-first
  // employer workflows, so an agency acknowledgement can prove the operational
  // filing even when the Linaw worksheet itself is not an agency upload file.
  const demoMode = enabled("DEMO_MODE");
  const bir1601cValidated = Boolean(bir1601Evidence?.operationallyProven);
  const birAlphalistValidated = Boolean(birEvidence?.proven);
  const sssR3Validated = Boolean(sssEvidence?.operationallyProven);
  const philhealthValidated = Boolean(philhealthEvidence?.operationallyProven);
  const pagibigValidated = Boolean(pagibigEvidence?.operationallyProven);
  const storageConfigured = configured("S3_BUCKET") || configured("R2_BUCKET");
  const storageIntegrated = false;
  const malwareEndpointConfigured = configured("MALWARE_SCAN_URL");
  const uploadsEnabled = documentUploadsEnabled();
  const malwareIntegrated = malwareScannerConfigured();
  const documentUploadSafetyReady = !uploadsEnabled || malwareIntegrated;
  const samlIntegrated = false;

  const appBaseUrl = process.env.APP_BASE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  const productionSecurityConfigured =
    process.env.NODE_ENV !== "production" ||
    (
      /^https:\/\//i.test(appBaseUrl) &&
      configured("TOTP_ENCRYPTION_KEY")
    );

  const gates: Gate[] = [
    {
      key: "production-security-config",
      label: "Production security configuration",
      ready: productionSecurityConfigured,
      detail: productionSecurityConfigured
        ? "Canonical HTTPS origin and the TOTP encryption key are configured. Optional operator endpoints may remain fail-closed."
        : "Configure HTTPS APP_BASE_URL and TOTP_ENCRYPTION_KEY before production launch.",
      blocks: productionSecurityConfigured ? "none" : "launch",
    },
    {
      key: "readiness-diagnostics-token",
      label: "Detailed readiness diagnostics token",
      ready: configured("READINESS_TOKEN"),
      detail: configured("READINESS_TOKEN")
        ? "Detailed readiness diagnostics are protected by a dedicated token."
        : "Detailed readiness diagnostics remain disabled with HTTP 503. The sanitized pilot-status endpoint can still verify launch state without exposing gate details.",
      blocks: "none",
    },
    {
      key: "remote-scheduler-token",
      label: "Remote scheduler token",
      ready: configured("WORKER_TOKEN"),
      detail: configured("WORKER_TOKEN")
        ? "The remote scheduler trigger is protected by a worker token."
        : "The remote scheduler trigger remains disabled with HTTP 503. Payroll processing and the dedicated worker do not depend on this endpoint.",
      blocks: "scale",
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
      ready: deliveryCapable() && Number(deliveredMail) > 0,
      detail: deliveryCapable()
        ? Number(deliveredMail) > 0
          ? `Active provider: ${provider}. ${deliveredMail} provider-confirmed delivered message(s), ${sentMail} accepted send(s), and ${failedMail} currently failed message(s).`
          : Number(sentMail) > 0
            ? `Provider ${provider} accepted ${sentMail} send(s), but this deployment has no provider-confirmed delivered webhook event yet.`
            : `Provider ${provider} is configured, but this deployment has not recorded a successful send or verified delivery yet.`
        : "No provider configured. Messages remain queued until a transactional email provider is connected.",
      blocks: deliveryCapable() && Number(deliveredMail) > 0 ? "none" : "launch",
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
          : manualBankUatProven
            ? `${acceptedBankFileValidations} exact Linaw-generated bank payroll file(s) have recorded corporate-portal acceptance evidence.`
            : `PayMongo Disbursements is enabled, a no-money payroll preflight (bank mappings and wallet funding) has passed (${paymongoPreflightPasses} recorded pass(es)), and signed transfer webhooks are configured.`
        : paymongoDisbursementEnabled
          ? !paymongoWalletConfigured
            ? "PayMongo Disbursements is enabled, but PAYMONGO_WALLET_ID is missing. PayMongo requires a source account on every transfer, and Linaw reads it from this wallet."
          : !paymongoWebhookConfigured
            ? "PayMongo Disbursements is enabled, but PAYMONGO_WEBHOOK_SECRET is missing. Configure signed transfer webhooks before treating automated payout settlement as production-ready."
            : "PayMongo Disbursements is enabled, but no no-money payroll preflight has proven credentials and employee bank mappings yet."
          : "Bank files remain available for manual upload. PayMongo batch-transfer code, signed transfer webhook handling, and a no-money preflight are implemented, but live disbursement is not enabled.",
      blocks: bankReady ? "none" : "launch",
      manualWorkaround: bankReady ? undefined : "Generate a bank validation record for a released payroll, upload that exact hashed file to the corporate bank portal, then record the portal acceptance under /api/compliance/bank-validations.",
    },
    {
      key: "bank-data-encryption",
      label: "Bank account numbers encrypted at rest",
      ready: bankDataProtected,
      detail: bankDataProtected
        ? `Bank data is encrypted at rest using the ${bankKeySource === "dedicated" ? "dedicated bank-data key" : "domain-separated key derived from the TOTP master"}; no employee account or payroll payment snapshot remains in plaintext.`
        : bankKeyConfigured
          ? `${plaintextBankAccounts} employee bank account number(s) and ${plaintextBankSnapshots} payroll payment snapshot(s) remain in plaintext. The compatibility upgrader will seal them automatically on the next authenticated/demo bootstrap.`
          : "No usable bank-data encryption key is available. Configure BANK_DATA_ENCRYPTION_KEY or the required TOTP_ENCRYPTION_KEY before launch.",
      blocks: bankDataProtected ? "none" : "launch",
    },
    {
      key: "government-id-encryption",
      label: "Government identifiers encrypted at rest",
      ready: governmentIdsProtected,
      detail: governmentIdsProtected
        ? "Employee TIN/SSS/PhilHealth/Pag-IBIG identifiers and contractor TINs are encrypted at rest; browser payloads use masked values by default."
        : governmentIdKeyConfigured
          ? `${plaintextEmployeeGovernmentIds} employee record(s) and ${plaintextContractorTins} contractor record(s) still contain plaintext government identifiers. Run the government-ID encryption migration before launch.`
          : "No usable PII encryption key is available. Configure PII_ENCRYPTION_KEY or a valid domain-separated fallback before launch.",
      blocks: governmentIdsProtected ? "none" : "launch",
    },
    {
      key: "production-pilot-signoff",
      label: "Independent completed-payout payroll pilot signed off",
      ready: Number(productionPilotSignoffs) > 0,
      detail: Number(productionPilotSignoffs) > 0
        ? `${productionPilotSignoffs} completed-payout payroll pilot sign-off(s) are recorded with independent reconciliation evidence.`
        : Number(noMoneyPilotReconciliations) > 0
          ? `${noMoneyPilotReconciliations} no-money payroll pilot reconciliation(s) recorded. Bank-file previews do not prove settlement and cannot clear the broad-launch pilot gate.`
          : "No Owner has signed off a completed-payout payroll against independently prepared expected figures yet.",
      blocks: Number(productionPilotSignoffs) > 0 ? "none" : "launch",
      manualWorkaround: Number(productionPilotSignoffs) > 0
        ? undefined
        : "A no-money pilot is a separate milestone. Complete and independently review a real settled payroll, then record the completed-payout sign-off before broad launch.",
    },
    {
      key: "gov-bir-1601c",
      label: "BIR 1601-C monthly filing workflow proven",
      ready: bir1601cValidated,
      detail: bir1601cValidated
        ? `BIR 1601-C operational filing evidence is recorded (${bir1601Evidence?.operationalProvingCount} accepted filing(s)${bir1601Evidence?.latestOperational?.agencyReference ? `, latest reference ${bir1601Evidence.latestOperational.agencyReference}` : ""}). This proves the monthly eBIRForms/eFPS filing workflow, not a PayrollPH upload-file format.`
        : filingEvidenceError
          ?? "No current-version BIR 1601-C filing acknowledgement is recorded yet. PayrollPH can generate the monthly withholding worksheet from the final cutoff, but launch readiness stays red until the employer files/pays through the applicable BIR channel and records BIR's own acknowledgement.",
      blocks: bir1601cValidated ? "none" : "launch",
      manualWorkaround: bir1601cValidated
        ? undefined
        : "Generate the BIR 1601-C worksheet from the month's final cutoff, file and pay through the employer's applicable eBIRForms/eFPS workflow, retain BIR's official acknowledgement/payment reference, then record that acceptance in Exports.",
    },
    {
      key: "gov-bir-alphalist",
      label: "BIR Alphalist / 2316 validated in ADES",
      ready: birAlphalistValidated,
      detail: birAlphalistValidated
        ? `BIR's ADES validated a Linaw-generated annual extract in the current layout (${birEvidence?.provingCount} recorded acceptance(s)${birEvidence?.latest?.agencyReference ? `, latest reference ${birEvidence.latest.agencyReference}` : ""}). The extract aggregates all released payrolls paid in the selected calendar year into one annual row per employee. Linaw still does not produce the final .DAT.`
        : filingEvidenceError
          ?? `${describeEvidenceGap(birEvidence, findFilingForm("BIR", "1604-C")!)} Employee middle name, TIN and employer TIN/branch fields are modeled and preflighted; Linaw does not produce ADES's final .DAT.`,
      blocks: birAlphalistValidated ? "none" : "launch",
      manualWorkaround: birAlphalistValidated ? undefined : "Enter the DRAFT figures into BIR's free ADES tool by hand and file via eAFS once it validates, or load the extract into ADES and record the result under /api/compliance/filing-validations.",
    },
    {
      key: "gov-sss-r3",
      label: "SSS e-CL / PRN workflow proven",
      ready: sssR3Validated,
      detail: sssR3Validated
        ? `SSS operational filing evidence is recorded (${sssEvidence?.operationalProvingCount} accepted filing(s)${sssEvidence?.latestOperational?.agencyReference ? `, latest PRN/reference ${sssEvidence.latestOperational.agencyReference}` : ""}). File-layout proof remains separate because the current employer workflow can be completed through My.SSS e-CL/PRN.`
        : filingEvidenceError
          ?? describeEvidenceGap(sssEvidence, findFilingForm("SSS", "R-3")!),
      blocks: sssR3Validated ? "none" : "launch",
      manualWorkaround: sssR3Validated ? undefined : "Use the DRAFT figures in the current My.SSS employer e-CL/PRN workflow, complete the remittance, then record the SSS PRN/acknowledgement under /api/compliance/filing-validations.",
    },
    {
      key: "gov-philhealth-rf1",
      label: "PhilHealth EPRS workflow proven",
      ready: philhealthValidated,
      detail: philhealthValidated
        ? `PhilHealth operational filing evidence is recorded (${philhealthEvidence?.operationalProvingCount} accepted filing(s)${philhealthEvidence?.latestOperational?.agencyReference ? `, latest EPRS/ePAR reference ${philhealthEvidence.latestOperational.agencyReference}` : ""}). File-import proof remains separate from successful EPRS reporting/payment.`
        : filingEvidenceError
          ?? `${describeEvidenceGap(philhealthEvidence, findFilingForm("PhilHealth", "RF-1")!)} The draft uses each employee's real PhilHealth PIN and recomputes full monthly premium shares; the CSV is a portal-entry aid, not a claimed EPRS import file.`,
      blocks: philhealthValidated ? "none" : "launch",
      manualWorkaround: philhealthValidated ? undefined : "Enter the DRAFT figures into PhilHealth's EPRS by hand (or their RF-1 Excel template, if you obtain the current column spec from PhilHealth directly), then record the acknowledgement receipt under /api/compliance/filing-validations.",
    },
    {
      key: "gov-pagibig-mcrf",
      label: "Pag-IBIG remittance workflow proven",
      ready: pagibigValidated,
      detail: pagibigValidated
        ? `Pag-IBIG operational remittance evidence is recorded (${pagibigEvidence?.operationalProvingCount} accepted filing(s)${pagibigEvidence?.latestOperational?.agencyReference ? `, latest reference ${pagibigEvidence.latestOperational.agencyReference}` : ""}). Workbook/file-format proof remains separate, and final member posting should still be retained as evidence.`
        : filingEvidenceError
          ?? `${describeEvidenceGap(pagibigEvidence, findFilingForm("Pag-IBIG", "MCRF")!)} The draft uses each employee's real Pag-IBIG MID and full monthly contributions; it is an eSRS/employer-portal entry aid until an acceptance is recorded.`,
      blocks: pagibigValidated ? "none" : "launch",
      manualWorkaround: pagibigValidated ? undefined : "Use the DRAFT figures in Pag-IBIG eSRS or the employer's current approved remittance channel, then record the payment instruction/confirmation and retain final posting evidence under /api/compliance/filing-validations.",
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
      label: "Document upload malware safety",
      ready: documentUploadSafetyReady,
      detail: !uploadsEnabled
        ? "Production document uploads are explicitly disabled. Malware scanning is not required until the upload feature is enabled."
        : malwareIntegrated
          ? "Malware scanning is wired into document uploads and production fails closed unless the scanner reports the file clean."
          : malwareEndpointConfigured
            ? "Document uploads are enabled, but production still needs a valid HTTPS MALWARE_SCAN_URL and MALWARE_SCAN_TOKEN."
            : "Document uploads are enabled without a configured malware scanner. Disable uploads or configure the scanner before launch.",
      blocks: documentUploadSafetyReady ? "none" : "launch",
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
    {
      key: "employee-rest-day-coverage",
      label: "Employee rest-day assignment",
      ready: employeesMissingRestDay === 0,
      detail: employeesMissingRestDay === 0
        ? `All ${totalEmployees} employee(s) have a designated weekly rest day, so rest-day premium pay can be computed for them.`
        : `${employeesMissingRestDay} of ${totalEmployees} employee(s) have no designated rest day, so Linaw cannot compute rest-day premium pay for those records. Exempt categories are not modeled, so this is informational rather than a precise compliance count.`,
      blocks: "scale",
      manualWorkaround: employeesMissingRestDay === 0 ? undefined : "Open People, select the employee, and set the weekly rest day in Work schedule before recalculating payroll.",
    },
  ];

  const launchBlockers = gates.filter((gate) => gate.blocks === "launch" && !gate.ready);
  const scaleBlockers = gates.filter((gate) => gate.blocks === "scale" && !gate.ready);
  const unworkaroundableBlockers = launchBlockers.filter((gate) => !gate.manualWorkaround);

  return {
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
    counts: { users: userCount, queuedMail, sentMail, deliveredMail, failedMail, paidInvoices, activeSubs, paymongoPreflightPasses, productionPilotSignoffs, noMoneyPilotReconciliations, plaintextBankAccounts, plaintextBankSnapshots },
    generatedAt: new Date().toISOString(),
  };
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    const expected = operationalSecret("readiness") ?? operationalSecret("worker");
    if (!expected) {
      return Response.json(
        { error: "Readiness diagnostics are disabled until an operational token or TOTP encryption master is configured." },
        { status: 503 },
      );
    }
    const supplied = request.headers.get("x-readiness-token") ?? request.headers.get("x-worker-token");
    if (!constantTimeSecretEqual(supplied, expected)) {
      return Response.json({ error: "A valid readiness token is required." }, { status: 401 });
    }
  }

  return Response.json(await buildReadinessPayload(), {
    headers: { "Cache-Control": "no-store" },
  });
}
