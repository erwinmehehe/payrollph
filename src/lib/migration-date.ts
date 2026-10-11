/** Calendar dates from imports must never pass through local-time parsing. */
export function parseMigrationDate(value: string | undefined): string | null {
  const raw = (value ?? "").trim();
  let year: number, month: number, day: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const numeric = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  const named = /^(\d{1,2})[- ]([A-Za-z]{3,9})[- ](\d{4})$/.exec(raw);
  if (iso) {
    [, year, month, day] = iso.map(Number);
  } else if (numeric) {
    const first = Number(numeric[1]), second = Number(numeric[2]);
    // Both interpretations are plausible. Require an unambiguous ISO date.
    if (first <= 12 && second <= 12 && first !== second) return null;
    year = Number(numeric[3]);
    [month, day] = first > 12 ? [second, first] : [first, second];
  } else if (named) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const fullMonths = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    const name = named[2].toLowerCase();
    month = (name.length === 3 ? months.indexOf(name) : fullMonths.indexOf(name)) + 1;
    year = Number(named[3]); day = Number(named[1]);
    if (!month) return null;
  } else return null;
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}
