/**
 * Read-only, review-only contractor quarterly EWT source schedule.
 * No certificate, QAP, 1604-E DAT, ATC legal validation or filing submission.
 * The 0011 contractor_payments source has organizationId, NOT legalEntityId:
 * refuse ambiguous multi-legal-employer attribution rather than guess.
 */
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { contractorPayments, contractors, legalEntities } from "@/db/schema";
import { assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { buildEwtQuarterSchedule, ewtQuarterPeriod } from "@/lib/contractor-ewt-quarter";
import { decryptGovernmentId } from "@/lib/government-id-crypto";
import { resolveExplicitEntitySelection } from "@/lib/multi-entity-selector-boundary";
import { assertEntityResource, resolveMultiEntityContext } from "@/lib/multi-entity-server";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "no-store", "Pragma": "no-cache" };

function fail(error: string, status: number, code?: string) {
  return Response.json({ error, ...(code ? { code } : {}), filingReady: false }, { status, headers: privateHeaders });
}
function requiredId(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (!session) return fail("Authentication required.", 401);

  const url = new URL(request.url);
  const params = url.searchParams;
  const allowed = new Set(["organizationId", "legalEntityId", "year", "quarter", "contractorId"]);
  if ([...params.keys()].some((key) => !allowed.has(key)) ||
      [...allowed].some((key) => params.getAll(key).length > 1)) {
    return fail("Unknown or repeated query selector.", 400);
  }

  const organizationId = requiredId(params.get("organizationId"));
  const legalEntityId = requiredId(params.get("legalEntityId"));
  const contractorRaw = params.get("contractorId");
  const contractorId = contractorRaw === null ? null : requiredId(contractorRaw);
  const year = params.get("year") ?? "";
  const quarter = params.get("quarter") ?? "";
  if (!organizationId || !legalEntityId ||
      (contractorRaw !== null && contractorId === null) ||
      !/^20\d{2}$/.test(year) || !/^[1-4]$/.test(quarter)) {
    return fail("organizationId, legalEntityId, year=20XX and quarter=1..4 are required; contractorId is optional.", 400);
  }

  const denied = await assertOrganizationRole(
    session.id, organizationId, PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can review contractor withholding.",
  );
  if (denied) return fail("Contractor EWT access denied.", denied.status);
  const access = await getAccess(session.id, organizationId);
  if (!access?.companyWide) {
    return fail("Contractor withholding reporting requires company-wide access.", 403);
  }

  // A forged header may not authorize employer A while the query consumes B.
  const selectors = resolveExplicitEntitySelection({
    requested: legalEntityId,
    header: request.headers.get("x-legal-entity-id"),
    queryValues: params.getAll("legalEntityId"),
  });
  if (!selectors.ok || selectors.requested !== legalEntityId) {
    return fail("Inconsistent or invalid legal-employer selectors.", 403, "ENTITY_SELECTOR_CONFLICT");
  }
  const contextResult = await resolveMultiEntityContext({
    userId: session.id, organizationId, request, requested: legalEntityId,
  });
  if (!contextResult.ok) return fail("Legal employer is not available to this account.", contextResult.response.status);
  const entityDenied = assertEntityResource(contextResult.context, legalEntityId);
  if (entityDenied) return fail("Legal employer is not available to this account.", entityDenied.status);

  // Proof of an ACTIVE owned employer is mandatory; never cross tenant by ID.
  const [legalEmployer] = await db.select({
    id: legalEntities.id, primaryEntity: legalEntities.primaryEntity,
  }).from(legalEntities).where(and(
    eq(legalEntities.id, legalEntityId),
    eq(legalEntities.organizationId, organizationId),
    eq(legalEntities.active, true),
  )).limit(1);
  if (!legalEmployer) return fail("Legal employer is not available to this workspace.", 403);

  // Existing contractor payments have no legalEntityId. In a multi-entity
  // organization, reporting them as one employer's EWT would be fabricated.
  const activeEmployers = await db.select({ id: legalEntities.id })
    .from(legalEntities).where(and(
      eq(legalEntities.organizationId, organizationId),
      eq(legalEntities.active, true),
    )).limit(2);
  if (activeEmployers.length !== 1 || !legalEmployer.primaryEntity) {
    return fail("Contractor EWT cannot be attributed to one legal employer without source-level allocation.", 409,
      "EWT_LEGAL_EMPLOYER_ATTRIBUTION_UNVERIFIED");
  }

  if (contractorId !== null) {
    const [payee] = await db.select({ id: contractors.id }).from(contractors)
      .where(and(eq(contractors.id, contractorId), eq(contractors.organizationId, organizationId))).limit(1);
    if (!payee) return fail("Contractor not found in this workspace.", 404);
  }

  const quarterLabel = year + "-Q" + quarter;
  const period = ewtQuarterPeriod(quarterLabel);
  const rows = await db.select({ payment: contractorPayments, contractor: contractors })
    .from(contractorPayments)
    .leftJoin(contractors, eq(contractorPayments.contractorId, contractors.id))
    .where(and(
      eq(contractorPayments.organizationId, organizationId),
      gte(contractorPayments.paymentDate, period.start),
      lte(contractorPayments.paymentDate, period.end),
    ))
    .orderBy(asc(contractorPayments.paymentDate), asc(contractorPayments.id));

  // 0011 has an FK to contractor ID but no composite employer FK. Check ALL
  // quarter rows before any optional payee filter, decryption or serialization.
  if (rows.some(({ contractor }) => !contractor || contractor.organizationId !== organizationId)) {
    return fail("Contractor payment attribution requires review.", 409, "EWT_PAYMENT_ATTRIBUTION_UNVERIFIED");
  }

  const selected = rows.filter(({ payment }) => contractorId === null || payment.contractorId === contractorId);
  const payees = new Map<number, { id: number; name: string; tin: string | null; country: string | null }>();
  for (const { contractor } of selected) {
    const own = contractor!;
    if (!payees.has(own.id)) {
      payees.set(own.id, {
        id: own.id, name: own.name, tin: decryptGovernmentId(own.tin), country: own.country,
      });
    }
  }
  const schedule = buildEwtQuarterSchedule({
    quarter: quarterLabel,
    payments: selected.map(({ payment }) => ({
      id: payment.id,
      contractorId: payment.contractorId,
      paymentDate: payment.paymentDate,
      grossAmountPhp: payment.grossAmountPhp,
      withholdingAtc: payment.withholdingAtc,
      withholdingRate: payment.withholdingRate,
      withholdingAmount: payment.withholdingAmount,
    })),
    payees: [...payees.values()],
  });

  return Response.json({
    ...schedule, organizationId, legalEntityId, sourceSchedule: true,
    filingReady: false,
    note: "Source schedule, not a BIR filing. ATCs/rates and official BIR layouts have not been certified.",
  }, { headers: privateHeaders });
}
