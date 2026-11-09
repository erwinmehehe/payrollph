/** TypeScript contract for the guarded synthetic PG16 lifecycle proof. */
export declare function requireDisposableLifecycleBoundary(env?: Record<string, string | undefined>): true;
export declare function requirePrivateNoLeak(
  response: {
    status: number;
    json?: { error?: string; [key: string]: unknown } | null;
    text?: string;
    headers: Headers;
  },
  input: { status: number; forbidden?: string[]; label: string },
): unknown;
export declare function requireOneTaskTransition(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  id: number,
  action: string,
  actor: { name: string },
): { task: Record<string, unknown>; event: Record<string, unknown>; audit: Record<string, unknown> };
