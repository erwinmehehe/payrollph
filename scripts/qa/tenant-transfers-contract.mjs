import assert from "node:assert/strict";
import { requireDisposableApprovalTask } from "./tenant-approval-task-contract.mjs";

export const TRANSFERS_POST_METHOD = "POST multi-entity/transfers";
export const TRANSFERS_PATCH_METHOD = "PATCH multi-entity/transfers";
export const TRANSFERS_TITLE = "tenant-multi-entity-transfers-isolation";
export const TRANSFER_PATH = "/api/multi-entity/transfers";

/**
 * The shared disposable-target contract, plus: the two multi-entity flags must be ON (the route is a 404 without
 * them, which would make every refusal meaningless) and no payout or notification provider may be reachable.
 * This proof moves a fictional worker between two fictional legal employers of the SAME fictional tenant. No money moves.
 */
export function requireDisposableTransfers(env = process.env) {
  requireDisposableApprovalTask(env);
  for (const name of ["MULTI_ENTITY_ENABLED", "MULTI_ENTITY_TRANSFERS_ENABLED"]) {
    if (env[name] !== "true") throw new Error("TRANSFERS_PROOF_REFUSED: " + name + " must be true or the route answers 404 to everyone");
  }
  for (const name of ["PAYMONGO_SECRET_KEY", "PAYMONGO_WALLET_ID", "XENDIT_PAYOUT_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY"]) {
    if (env[name]) throw new Error("TRANSFERS_PROOF_REFUSED: " + name + " must be empty");
  }
  if (env.XENDIT_PAYOUTS_LIVE_APPROVED === "true" || env.PAYMONGO_DISBURSEMENTS_ENABLED === "true" || env.XENDIT_PAYOUTS_ENABLED === "true") {
    throw new Error("TRANSFERS_PROOF_REFUSED: payout providers must stay disabled");
  }
  return true;
}

/** Today in Asia/Manila as YYYY-MM-DD, the clock the route itself uses for "future or current effective date". */
export function manilaToday(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return parts.year + "-" + parts.month + "-" + parts.day;
}

/** The calendar day before a YYYY-MM-DD date, computed in UTC so no local zone can shift it. */
export function dayBefore(ymd) {
  assert.match(ymd, /^\d{4}-\d{2}-\d{2}$/);
  const date = new Date(ymd + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** A refusal must be the expected status and leak none of the forbidden victim markers. */
export function assertRefusal(response, status, forbidden = []) {
  assert.equal(response?.status, status, "incorrect refusal status " + response?.status + ": " + response?.text?.slice(0, 300));
  const body = response.text + "\n" + [...(response.headers ?? [])].map(([name, value]) => name + ":" + value).join("\n");
  for (const marker of forbidden) {
    assert.ok(typeof marker === "string" && marker.length > 0, "missing forbidden marker");
    assert.ok(!body.includes(marker), "a forbidden victim value leaked into a response");
  }
  return response.json;
}

/** Two refusals are the same answer: a foreign ID must be indistinguishable from an absent one. */
export function assertSameAnswer(foreign, absent, label) {
  assert.equal(foreign.status, absent.status, label + ": status differs between a foreign and an absent ID");
  assert.equal(foreign.text, absent.text, label + ": body differs between a foreign and an absent ID");
}

/** Named row sets must be identical (JSON) before and after. */
export function assertRowsUnchanged(before, after, label) {
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), label + ": table set changed");
  for (const name of Object.keys(before)) assert.deepEqual(after[name], before[name], label + ": " + name + " changed");
}
