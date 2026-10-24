type Assert = {
  equal(actual: unknown, expected: unknown, message?: string): void;
  ok(value: unknown, message?: string): void;
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
};
type Tally = {
  routeFiles: number; methods: number; coveredAfter: number; publicByDesign: number; gap: number;
  byKey: Map<string, { key: string; status: string; path: string }>;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Manifest = any;
export function tallyTenantManifest(manifest: Manifest): Tally;
export function baseTenantManifest(env?: Record<string, string | undefined>): { ref: string; manifest: Manifest } | null;
export function assertLiveTenantCounts(
  assert: Assert, manifest: Manifest, env?: Record<string, string | undefined>,
  injectedBase?: { ref: string; manifest: Manifest } | null,
): { live: Tally; base: Tally | null };
