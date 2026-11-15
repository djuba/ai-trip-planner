// The request's `referenceDate`: the browser's local date (CLAUDE.md §4.6). Built from local
// fields, not `toISOString()`, which is UTC and gives tomorrow's date on a US evening (plan D2).
const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/** `YYYY-MM-DD` for `now` in the browser's time zone. The caller supplies the clock (§6.1). */
export function localDate(now: Date): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}
