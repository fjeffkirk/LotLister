import { toZonedTime } from "date-fns-tz";
import { tryPrisma } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { fillDaySeries, eachLocalDateStr } from "@/lib/dates";

const DAY_MS = 24 * 60 * 60 * 1000;

// Must match the timezone used in lib/dates.ts so day boundaries align.
const TZ = "America/New_York";

/**
 * Convert a Date to the YYYY-MM-DD string it represents in the app timezone.
 * This is the key fix: "Today 11:59 PM EDT" is still June 24, not June 25 UTC.
 */
function toLocalDateStr(d: Date): string {
  const z = toZonedTime(d, TZ);
  const y = z.getFullYear();
  const m = String(z.getMonth() + 1).padStart(2, "0");
  const day = String(z.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD string as a UTC-midnight timestamp (how entries are stored in DB). */
function dateStrToMs(s: string): number {
  return new Date(`${s}T00:00:00.000Z`).getTime();
}

/** Number of inclusive local calendar days between from and to. */
function countLocalDays(from: Date, to: Date): number {
  const fromMs = dateStrToMs(toLocalDateStr(from));
  const toMs = dateStrToMs(toLocalDateStr(to));
  return Math.max(1, Math.round((toMs - fromMs) / DAY_MS) + 1);
}

/**
 * Total ad spend for [from, to] using carry-forward logic.
 * Days are counted in the app's local timezone so a range like
 * "Today" (midnight–23:59 EDT) is always exactly 1 day, even though
 * it crosses a UTC date boundary.
 */
export async function getAdSpendForRange(from: Date, to: Date): Promise<number> {
  const fromLocalStr = toLocalDateStr(from);
  const toLocalStr = toLocalDateStr(to);
  const toLocalMs = dateStrToMs(toLocalStr);

  const entries = await tryPrisma((db) =>
    db.dailyAdBudget.findMany({
      // Only load entries up to and including the last local day in the range
      where: { date: { lte: new Date(toLocalMs) } },
      orderBy: { date: "asc" },
      select: { date: true, amount: true },
    })
  );

  if (!entries || entries.length === 0) return 0;

  const numDays = countLocalDays(from, to);
  const fromLocalMs = dateStrToMs(fromLocalStr);
  let total = 0;

  for (let i = 0; i < numDays; i++) {
    const dayMs = fromLocalMs + i * DAY_MS;
    // Carry-forward: latest entry whose stored UTC-midnight date <= this local day
    let effective: { amount: unknown } | null = null;
    for (const e of entries) {
      if (e.date.getTime() <= dayMs) effective = e;
      else break;
    }
    if (effective) total += toNumber(effective.amount as never);
  }

  return total;
}

/**
 * The currently effective daily budget (carry-forward from the most recent entry).
 * Returns null if no budget has ever been set.
 */
export async function getEffectiveDailyBudget(asOf?: Date): Promise<number | null> {
  const dayStr = toLocalDateStr(asOf ?? new Date());
  const dayMs = dateStrToMs(dayStr);
  const entry = await tryPrisma((db) =>
    db.dailyAdBudget.findFirst({
      where: { date: { lte: new Date(dayMs) } },
      orderBy: { date: "desc" },
      select: { amount: true },
    })
  );
  return entry ? toNumber(entry.amount as never) : null;
}

/**
 * Recent budget entries for display in the editor (most recent first).
 */
export async function getRecentAdBudgets(take = 10) {
  return (await tryPrisma((db) =>
    db.dailyAdBudget.findMany({
      orderBy: { date: "desc" },
      take,
    })
  )) ?? [];
}

// ---------------------------------------------------------------------------
// Consolidated single-query fetch for everything the dashboard needs from the
// DailyAdBudget table (replaces 4 separate round-trips).
// ---------------------------------------------------------------------------
export type AdBudgetPageData = {
  currentSpend: number;
  prevSpend:    number;
  dailyBudget:  number | null;
  recentEntries: { id: string; date: string; amount: string }[];
  /** Carry-forward ad spend per local calendar day in the current range. */
  dailySpend: { name: string; value: number }[];
};

function carryForwardAmount(raw: { date: Date; amount: unknown }[], dayMs: number): number {
  let effective: { amount: unknown } | null = null;
  for (const e of raw) {
    if (e.date.getTime() <= dayMs) effective = e;
    else break;
  }
  return effective ? toNumber(effective.amount as never) : 0;
}

function dailySpendSeries(
  rangeFrom: Date,
  rangeTo: Date,
  raw: { date: Date; amount: unknown }[],
): { name: string; value: number }[] {
  const points = eachLocalDateStr(rangeFrom, rangeTo).map((name) => ({
    name,
    value: carryForwardAmount(raw, dateStrToMs(name)),
  }));
  return fillDaySeries(rangeFrom, rangeTo, points);
}

export async function getAllAdBudgetData(
  prevFrom: Date, prevTo: Date,
  from: Date, to: Date,
  recentCount = 10,
): Promise<AdBudgetPageData> {
  const toLocalMs = dateStrToMs(toLocalDateStr(to));

  // Single query: all entries up to the last day of the current period.
  // We then perform all carry-forward math in memory — no extra round-trips.
  const raw = await tryPrisma((db) =>
    db.dailyAdBudget.findMany({
      where: { date: { lte: new Date(toLocalMs) } },
      orderBy: { date: "asc" },
      select: { id: true, date: true, amount: true },
    })
  ) ?? [];

  /** Carry-forward sum of ad spend for [rangeFrom, rangeTo]. */
  function computeSpend(rangeFrom: Date, rangeTo: Date): number {
    return dailySpendSeries(rangeFrom, rangeTo, raw).reduce((sum, d) => sum + d.value, 0);
  }

  /** Most-recent entry whose date ≤ asOf local date. */
  function computeDailyBudget(asOf: Date): number | null {
    const asOfMs = dateStrToMs(toLocalDateStr(asOf));
    let found: { amount: unknown } | null = null;
    for (const e of raw) {
      if (e.date.getTime() <= asOfMs) found = e;
      else break;
    }
    return found ? toNumber(found.amount as never) : null;
  }

  const recentEntries = [...raw]
    .reverse()
    .slice(0, recentCount)
    .map((e) => ({ id: e.id, date: e.date.toISOString(), amount: e.amount.toString() }));

  return {
    currentSpend:  computeSpend(from, to),
    prevSpend:     computeSpend(prevFrom, prevTo),
    dailyBudget:   computeDailyBudget(to),
    recentEntries,
    dailySpend:    dailySpendSeries(from, to, raw),
  };
}
