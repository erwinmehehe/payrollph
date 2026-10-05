import { createHmac } from "node:crypto";

const MIN_ANONYMITY_KEY_BYTES = 32;
const DEFAULT_PRIVACY_THRESHOLD = 5;

export function engagementAnonymityConfigured() {
  const key = process.env.ENGAGEMENT_ANONYMITY_KEY ?? "";
  return Buffer.byteLength(key, "utf8") >= MIN_ANONYMITY_KEY_BYTES;
}

export function anonymousRespondentKey(input: { surveyId: number; organizationId: number; employeeId: number }) {
  const key = process.env.ENGAGEMENT_ANONYMITY_KEY ?? "";
  if (Buffer.byteLength(key, "utf8") < MIN_ANONYMITY_KEY_BYTES) {
    throw new Error("ENGAGEMENT_ANONYMITY_KEY must be at least 32 bytes before anonymous surveys can collect responses.");
  }
  return createHmac("sha256", key)
    .update(`organization:${input.organizationId}|survey:${input.surveyId}|employee:${input.employeeId}`)
    .digest("hex");
}

export function identifiableRespondentKey(input: { surveyId: number; employeeId: number }) {
  return `identified:${input.surveyId}:employee:${input.employeeId}`;
}

export function normalizedPrivacyThreshold(value: unknown) {
  const number = Number(value);
  if (!Number.isInteger(number)) return DEFAULT_PRIVACY_THRESHOLD;
  return Math.max(DEFAULT_PRIVACY_THRESHOLD, Math.min(50, number));
}

export function enpsSummary(values: number[]) {
  if (values.length === 0) {
    return { score: null as number | null, promoters: 0, passives: 0, detractors: 0, responses: 0 };
  }
  const promoters = values.filter((value) => value >= 9).length;
  const detractors = values.filter((value) => value <= 6).length;
  const passives = values.length - promoters - detractors;
  const score = Math.round(((promoters - detractors) / values.length) * 100);
  return { score, promoters, passives, detractors, responses: values.length };
}

export function average(values: number[]) {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

export function reportableCohort(responseCount: number, threshold: number) {
  return responseCount >= normalizedPrivacyThreshold(threshold);
}
