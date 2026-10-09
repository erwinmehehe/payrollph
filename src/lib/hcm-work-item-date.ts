/** Parse an SLA deadline only when a real date and UTC offset are explicit. */
export function parseHcmSlaInstant(input: unknown): Date | null | undefined {
  if (input === null) return null;
  if (typeof input !== "string" || input.length > 48) return undefined;
  const pattern = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
  const parts = pattern.exec(input);
  if (!parts) return undefined;
  const day = Date.parse(parts[1] + "T00:00:00Z");
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== parts[1]) return undefined;
  const zone = parts[2];
  if (zone !== "Z") {
    const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(4, 6));
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return undefined;
  }
  const instant = Date.parse(input);
  return Number.isFinite(instant) ? new Date(instant) : undefined;
}
