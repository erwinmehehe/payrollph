/**
 * Type contract for the source-sealed MJS six-page proof generator.
 * Declarations do not execute or grant any coverage credit. Runtime proof,
 * immutable page/source pins and exact-head PostgreSQL gates remain mandatory.
 */
export interface SixPageTarget {
  key: string;
  path: string;
  pageSha: string;
  proof: string;
  proofSha: string;
  contract: string;
  contractSha: string;
  anchors: readonly string[];
  notTested: string;
}

export const MANIFEST: string;
export const SELECTION: string;
export const WORKFLOW: string;
export const TARGETS: readonly SixPageTarget[];

export function selectedTargets(): SixPageTarget[];
export function verifySixPageCredits(manifest: unknown): number;
export function historicSixPageView<T>(manifest: T): T;
