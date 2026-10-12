import { assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import {
  buildCompanyLoanSchedule, previewDiscretionaryLoanDeduction,
  validateAgencyAmortizationSchedule,
} from "@/lib/payroll-loan-schedule";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" } as const;

/** Read-only finance planning. Never registers, approves or deducts a loan. */
export async function POST(request: Request) {
  if (!criticalReleaseFlagEnabled("loanSchedulePreview")) {
    return Response.json({ error: "Loan schedule preview disabled." }, { status: 404, headers });
  }
  const origin = enforceSameOriginMutation(request);
  if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers });
  const body = await request.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Object request required." }, { status: 400, headers });
  }
  const organizationId = body.organizationId;
  if (typeof organizationId !== "number" || !Number.isSafeInteger(organizationId) || organizationId < 1) {
    return Response.json({ error: "Valid organization required." }, { status: 400, headers });
  }
  const denied = await assertOrganizationRole(user.id, organizationId, PAYROLL_OPERATOR_ROLES,
    "Company-wide payroll operator access required.");
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) return Response.json({ error: "Company-wide payroll scope required." }, { status: 403, headers });
  const mfa = requireSensitiveActionMfa(user);
  if (mfa) return mfa;
  const rate = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "loan-schedule-preview", resourceId: organizationId,
    limit: 12, windowMs: 15 * 60_000,
  });
  if (rate) return rate;
  try {
    if (body.kind === "company") {
      return Response.json({
        mode: "preview_only",
        interestBasis: "explicit flat simple interest; NOT automatic payroll deduction",
        schedule: buildCompanyLoanSchedule({
          principal: body.principal,
          months: body.months,
          installmentsPerMonth: body.installmentsPerMonth,
          annualFlatInterestBasisPoints: body.annualFlatInterestBasisPoints,
        }),
      }, { headers });
    }
    if (body.kind === "agency") {
      // Agency schedules must be imported as received; never synthesize their
      // periods, interest or remittance posting dates from local defaults.
      return Response.json({
        mode: "preview_only",
        imported: validateAgencyAmortizationSchedule(
          Array.isArray(body.rows) ? body.rows : [],
          body.agency, body.loanReference,
        ),
      }, { headers });
    }
    if (body.kind === "floor") {
      // A preview has no authority to apply an override. An override requires
      // a separately persisted, independently reviewed legal + audit record.
      return Response.json({
        mode: "preview_only",
        ...previewDiscretionaryLoanDeduction({
          disposablePayCents: body.disposablePayCents,
          minimumNetPayCents: body.minimumNetPayCents,
          remainingLoanCents: body.remainingLoanCents,
          requestedCents: body.requestedCents,
        }),
      }, { headers });
    }
    return Response.json({ error: "Unsupported schedule preview." }, { status: 422, headers });
  } catch {
    return Response.json({ error: "Invalid schedule, cents, dates or authority evidence." }, { status: 422, headers });
  }
}
