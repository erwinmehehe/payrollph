import { receiptPilotAllowed, validReceiptId } from "./workforce-schedule-receipt";
import { DEMAND_METRICS, operationalDemandPilotAllowed } from "./workforce-operational-demand-import";
import type { IssueScope } from "./workforce-issued-demand-evidence";

export type IssueDemandRequest = IssueScope & { idempotencyKey: string; acknowledged: true };
export type ScoreDemandRequest = {
  organizationId: number; issueId: number; acknowledged: true;
};

const SOURCE = /^[a-z][a-z0-9._-]{2,63}$/;
const KEY = /^[a-zA-Z0-9_-]{12,64}$/;

function obj(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, expected: readonly string[]) {
  return Object.keys(value).length === expected.length &&
    expected.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

export function parseIssueDemandRequest(value: unknown): IssueDemandRequest {
  if (!obj(value) || !exact(value, [
    "organizationId","worksiteId","sourceKey","metricKind",
    "intervalMinutes","horizonDays","idempotencyKey","acknowledged",
  ]) || !validReceiptId(value.organizationId) || !validReceiptId(value.worksiteId)
    || typeof value.sourceKey !== "string" || !SOURCE.test(value.sourceKey)
    || !DEMAND_METRICS.includes(value.metricKind as IssueScope["metricKind"])
    || ![15, 30, 60].includes(value.intervalMinutes as number)
    || ![7, 14].includes(value.horizonDays as number)
    || typeof value.idempotencyKey !== "string" || !KEY.test(value.idempotencyKey)
    || value.acknowledged !== true) {
    throw new Error("A scoped, acknowledged aggregate-demand issue request is required.");
  }
  return value as IssueDemandRequest;
}

export function parseScoreDemandRequest(value: unknown): ScoreDemandRequest {
  if (!obj(value) || !exact(value, ["organizationId","issueId","acknowledged"])
    || !validReceiptId(value.organizationId) || !validReceiptId(value.issueId)
    || value.acknowledged !== true) {
    throw new Error("A valid employer, issue and explicit score acknowledgement are required.");
  }
  return value as ScoreDemandRequest;
}

export function issuedDemandPilotAllowed(organizationId: number) {
  return operationalDemandPilotAllowed(organizationId)
    && receiptPilotAllowed(
      organizationId,
      process.env.WFM_ISSUED_DEMAND_FORECASTS_ENABLED,
      process.env.WFM_ISSUED_DEMAND_FORECASTS_ALLOWED_ORGANIZATION_IDS,
    );
}
