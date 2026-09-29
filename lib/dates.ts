import { format, subDays, subYears } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";

export type DateRangeKey = "1d" | "yesterday" | "7d" | "30d" | "90d" | "180d" | "365d" | "2y";

const valid: DateRangeKey[] = ["1d", "yesterday", "7d", "30d", "90d", "180d", "365d", "2y"];

const TZ = "America/New_York";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight today in EST/EDT, returned as a UTC Date for DB queries */
export function estStartOfToday(): Date {
  const nowEst = toZonedTime(new Date(), TZ);
  nowEst.setHours(0, 0, 0, 0);
  return fromZonedTime(nowEst, TZ);
}

/** End of today (23:59:59.999) in EST/EDT, as UTC */
function estEndOfToday(): Date {
  const nowEst = toZonedTime(new Date(), TZ);
  nowEst.setHours(23, 59, 59, 999);
  return fromZonedTime(nowEst, TZ);
}

export function parseRangeKey(raw: string | undefined, fallback: DateRangeKey = "1d"): DateRangeKey {
  if (raw && valid.includes(raw as DateRangeKey)) return raw as DateRangeKey;
  return fallback;
}

export function rangeToDates(key: DateRangeKey): { from: Date; to: Date } {
  const to = estEndOfToday();
  const start = estStartOfToday();
  switch (key) {
    case "1d":
      return { from: start, to };
    case "yesterday":
      return { from: subDays(start, 1), to: new Date(start.getTime() - 1) };
    // subDays(start, N-1) so the range is exactly N calendar days inclusive of today
    case "7d":
      return { from: subDays(start, 6), to };
    case "30d":
      return { from: subDays(start, 29), to };
    case "90d":
      return { from: subDays(start, 89), to };
    case "180d":
      return { from: subDays(start, 179), to };
    case "365d":
      return { from: subDays(start, 364), to };
    case "2y":
      return { from: subYears(start, 2), to };
    default:
      return { from: subDays(start, 29), to };
  }
}

/**
 * Returns the comparison (prior) period for trend % calculations.
 *
 * For "Today" we compare the same elapsed window from yesterday (fair
 * mid-day comparison). For all other presets we shift back by the same
 * number of calendar days so both windows have an equal number of full days.
 * For custom date ranges the caller should not pass a key and the function
 * falls back to shifting by duration.
 */
export function getComparisonDates(
  key: DateRangeKey | null,
  from: Date,
  to: Date,
): { prevFrom: Date; prevTo: Date } {
  if (key === "1d") {
    // Compare to the same elapsed window yesterday so a 3 pm reading is
    // compared against 3 pm yesterday, not all of yesterday.
    const now = new Date();
    return {
      prevFrom: new Date(from.getTime() - DAY_MS),
      prevTo: new Date(now.getTime() - DAY_MS),
    };
  }
  if (key === "yesterday") {
    return {
      prevFrom: new Date(from.getTime() - DAY_MS),
      prevTo: new Date(to.getTime() - DAY_MS),
    };
  }
  if (key === "7d") {
    return { prevFrom: subDays(from, 7), prevTo: new Date(from.getTime() - 1) };
  }
  if (key === "30d") {
    return { prevFrom: subDays(from, 30), prevTo: new Date(from.getTime() - 1) };
  }
  if (key === "90d") {
    return { prevFrom: subDays(from, 90), prevTo: new Date(from.getTime() - 1) };
  }
  if (key === "180d") {
    return { prevFrom: subDays(from, 180), prevTo: new Date(from.getTime() - 1) };
  }
  if (key === "365d") {
    return { prevFrom: subDays(from, 365), prevTo: new Date(from.getTime() - 1) };
  }
  if (key === "2y") {
    return {
      prevFrom: subYears(from, 2),
      prevTo: new Date(from.getTime() - 1),
    };
  }
  // Custom range: shift by the same duration
  const duration = to.getTime() - from.getTime();
  return {
    prevFrom: new Date(from.getTime() - duration),
    prevTo: new Date(from.getTime() - 1),
  };
}

export const rangeLabels: Record<DateRangeKey, string> = {
  "1d": "Today",
  "yesterday": "Yesterday",
  "7d": "7D",
  "30d": "30D",
  "90d": "90D",
  "180d": "180D",
  "365d": "365D",
  "2y": "2Y",
};

/** Chips shown in the date bar. Longer presets remain valid via URL. */
export const rangeChipKeys: DateRangeKey[] = ["1d", "yesterday", "7d", "30d", "90d"];

/** Chart window — skip 1-day presets; a single-day line is not useful. */
export const chartChipKeys: DateRangeKey[] = ["7d", "30d", "90d"];

/** Inclusive America/New_York calendar days in `[from, to]`. Always at least 1. */
export function inclusiveLocalDays(from: Date, to: Date): number {
  return Math.max(1, eachLocalDateStr(from, to).length);
}

/** Scale a range total to a 365-day run rate using inclusive local days. */
export function annualizeFromRange(value: number, from: Date, to: Date): number {
  return (value / inclusiveLocalDays(from, to)) * 365;
}

/** Local (America/New_York) calendar dates from `from` through `to`, inclusive. */
export function eachLocalDateStr(from: Date, to: Date): string[] {
  const start = toZonedTime(from, TZ);
  start.setHours(0, 0, 0, 0);
  const end = toZonedTime(to, TZ);
  end.setHours(0, 0, 0, 0);
  const out: string[] = [];
  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
    out.push(format(d, "yyyy-MM-dd"));
  }
  return out;
}

export function fillDaySeries(
  from: Date,
  to: Date,
  points: { name: string | Date; value: number }[],
): { name: string; value: number }[] {
  const map = new Map<string, number>();
  for (const p of points) {
    const key = asLocalDayName(p.name);
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + p.value);
  }
  return eachLocalDateStr(from, to).map((name) => ({ name, value: map.get(name) ?? 0 }));
}

/**
 * Prisma DateTime is stored as UTC-naive `timestamp`. Treat as UTC, then
 * take the America/New_York calendar date — same day the KPI range uses.
 */
export function asLocalDayName(value: string | Date): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return format(toZonedTime(value, TZ), "yyyy-MM-dd");
  }
  const s = String(value ?? "").trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ?? "";
}
