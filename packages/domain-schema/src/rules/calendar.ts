// Calendar-date check, as an algorithm rather than a library call (rules.md, "Calendar date"):
// `Date` rolls Feb 30 over to March, and languages disagree on what their parsers accept.
const DATE_SHAPE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const isLeapYear = (year: number): boolean =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isCalendarDate(value: string): boolean {
  if (!DATE_SHAPE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}
