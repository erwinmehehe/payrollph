import { timingSafeEqual } from "node:crypto";

export function constantTimeSecretEqual(supplied: string | null | undefined, expected: string | null | undefined) {
  if (!supplied || !expected) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
