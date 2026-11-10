/** Optional employee selector for prior-employer SSR. Null means no selection; false is invalid. */
export function canonicalPriorReviewWorkerId(value: unknown): number | null | false {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return false;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : false;
}
