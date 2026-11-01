import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { payoutBatches, payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { requireRunEmployer } from "@/lib/multi-entity-run-guard";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { assertOrganizationUnitAccess } from "@/lib/access";
import { configuredPayrollPayoutProvider, xenditPayrollLiveReadiness } from "@/lib/payroll-payout-provider";
import { authorizeTreasuryOperation } from "@/lib/treasury-controls";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import {
  preflightXenditPayroll, submitXenditPayroll,
  reconcileXenditPayroll, resolveUnknownXenditPayroll,
} from "@/lib/xendit-payroll-operations";
import { xenditPayoutLedger } from "@/lib/xendit-payout-ledger";

export const dynamic = "force-dynamic";

async function context(request: Request, params: Promise<{ id: string }>, mutation: boolean, action: string) {
  if (mutation) {
    const originDenied = enforceSameOriginMutation(request);
    if (originDenied) return { response: originDenied } as const;
  }
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isSafeInteger(runId) || runId <= 0) {
    return { response: Response.json({ error: "Invalid payroll run." }, { status: 400 }) } as const;
  }
  const user = await getSessionUser();
  if (!user) return { response: Response.json({ error: "Authentication required." }, { status: 401 }) } as const;
  if (mutation) {
    const denied = publicDemoMutationDenied(user.email, "Xendit payroll disbursement");
    if (denied) return { response: denied } as const;
  }
  const [run] = await db.select().from(payrollRuns)
    .where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return { response: Response.json({ error: "Payroll run not found." }, { status: 404 }) } as const;
  const treasury = await authorizeTreasuryOperation({
    organizationId: run.organizationId, runId: run.id,
    userId: user.id, userName: user.name,
    requireReleaseSeparation: action === "submit" || action === "resolve-unknown",
  });
  if (treasury.response) return { response: treasury.response } as const;
  const scopeDenied = await assertOrganizationUnitAccess(user.id, run.organizationId,
    run.scopeOrgUnitId, "This payroll run is outside your authorized organization unit.");
  if (scopeDenied) return { response: scopeDenied } as const;
  // Apply the resource's real legal employer to BOTH status reads and payout actions.
  const entityDenied = await requireRunEmployer({
    request, userId: user.id, organizationId: run.organizationId,
    legalEntityId: run.legalEntityId,
  });
  if (entityDenied) return { response: entityDenied } as const;
  if (mutation) {
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return { response: mfaDenied } as const;
    const rateDenied = await enforceSensitiveActionRateLimit(request, {
      userId: user.id, action: `xendit-payroll-${action}`,
      resourceId: run.id,
      limit: action === "submit" ? 100 : 20, windowMs: 10 * 60_000,
    });
    if (rateDenied) return { response: rateDenied } as const;
  }
  return { run, user } as const;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const checked = await context(request, params, false, "status");
  if ("response" in checked) return checked.response;
  const { run } = checked;
  try {
    const [existing] = await db.select({ provider: payoutBatches.provider })
      .from(payoutBatches).where(and(
        eq(payoutBatches.organizationId, run.organizationId),
        eq(payoutBatches.payrollRunId, run.id),
      )).limit(1);
    // A historical PayMongo batch belongs to its original provider. Do not
    // present it as a broken Xendit ledger or offer cross-provider retry.
    const ledger = existing?.provider === "paymongo"
      ? null : await xenditPayoutLedger(run.organizationId, run.id);
    return Response.json({
      provider: "xendit",
      selectedProvider: configuredPayrollPayoutProvider(),
      claimedProvider: existing?.provider ?? null,
      readiness: xenditPayrollLiveReadiness({
        organizationId: run.organizationId, legalEntityId: run.legalEntityId,
      }),
      ledger,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Xendit ledger unavailable." },
      { status: 409 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "");
  if (!["preflight", "submit", "reconcile", "resolve-unknown"].includes(action)) {
    return Response.json({ error: "Invalid Xendit payout operation." }, { status: 400 });
  }
  const checked = await context(request, params, true, action);
  if ("response" in checked) return checked.response;
  const { run, user } = checked;
  if (configuredPayrollPayoutProvider() !== "xendit") {
    // A previously submitted Xendit payroll may still require *read-only*
    // reconciliation after configuration changes. Never allow new sends.
    const isExistingReadOnly = (action === "reconcile" || action === "resolve-unknown")
      && Boolean(await xenditPayoutLedger(run.organizationId, run.id).catch(() => null));
    if (!isExistingReadOnly) {
      return Response.json({ error: "Xendit is not the selected payroll payment provider." },
        { status: 409 });
    }
  }
  try {
    if (action === "preflight") {
      return Response.json(await preflightXenditPayroll(run, user.name));
    }
    if (action === "submit") {
      if (body.confirm !== true) return Response.json({
        error: "Confirm actual money movement before submitting Xendit salary transfers.",
      }, { status: 400 });
      return Response.json(await submitXenditPayroll(run, user.name));
    }
    if (action === "reconcile") {
      return Response.json(await reconcileXenditPayroll(run, user.name, body.cursor === undefined ? 0 : Number(body.cursor)));
    }
    if (typeof body.referenceNumber !== "string" || typeof body.payoutId !== "string"
      || body.confirm !== true) {
      return Response.json({ error: "Confirm provider reference and payout ID for read-only recovery." },
        { status: 400 });
    }
    return Response.json({ ledger: await resolveUnknownXenditPayroll({
      run, actor: user.name, referenceNumber: body.referenceNumber, payoutId: body.payoutId,
    }) });
  } catch (error) {
    // Never tell the operator a failed HTTP request means the bank did not pay.
    return Response.json({
      error: error instanceof Error ? error.message : "Xendit operation requires investigation.",
      moneyMoved: "unknown; verify individual payout references with Xendit",
    }, { status: 409 });
  }
}
