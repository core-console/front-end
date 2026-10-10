export function localFinanceDate(now = new Date()) {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

export function daysInMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year!, monthNumber!, 0);
  return date.getUTCDate();
}

export function dateInMonth(month: string, day: number) {
  return `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, "0")}`;
}

export function resolveOverviewDate(month?: string, date?: string) {
  const today = localFinanceDate();
  const selectedMonth = month ?? date?.slice(0, 7) ?? today.slice(0, 7);
  const selectedDay = Number((date ?? today).slice(8, 10));
  return {
    month: selectedMonth,
    date: dateInMonth(selectedMonth, selectedDay),
  };
}

export function adjacentMonth(month: string, offset: -1 | 1) {
  const [year, monthNumber] = month.split("-").map(Number);
  const next = year! * 12 + monthNumber! - 1 + offset;
  if (next < 0 || next >= 120000) return null;
  return `${String(Math.floor(next / 12)).padStart(4, "0")}-${String((next % 12) + 1).padStart(2, "0")}`;
}

export function weekday(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(0);
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCFullYear(year!, month! - 1, day!);
  return value.getUTCDay();
}

export function formatOverviewDate(date: string, locale?: string) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(0);
  value.setUTCFullYear(year!, month! - 1, day!);
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
  }).format(value);
}

export function formatOverviewMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const value = new Date(0);
  value.setUTCFullYear(year!, monthNumber! - 1, 1);
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(value);
}
