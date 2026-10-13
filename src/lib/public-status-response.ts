export function publicStatusResponse(latest: { ok: boolean } | null) {
  return { ok: latest?.ok ?? false };
}
