/**
 * A fetched private receipt must still belong to the same claim, employer and
 * employee after remote object-storage I/O. A deleted, reassigned or replaced
 * receipt is not eligible for return on an earlier authorization snapshot.
 */
export type PrivateReceiptReadBinding = {
  id: number;
  organizationId: number;
  employeeId: number;
  receiptStorageKey: string | null;
  receiptSha256: string | null;
};

export function receiptReadBindingUnchanged(
  expected: PrivateReceiptReadBinding,
  current: PrivateReceiptReadBinding | null | undefined,
): boolean {
  return Boolean(
    current
    && expected.receiptStorageKey
    && expected.receiptSha256
    && current.id === expected.id
    && current.organizationId === expected.organizationId
    && current.employeeId === expected.employeeId
    && current.receiptStorageKey === expected.receiptStorageKey
    && current.receiptSha256 === expected.receiptSha256
  );
}
