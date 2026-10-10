export interface AdBudgetPoint {
  date: string;
  amount: number;
}

/** Amount counted on a calendar day: that day's entry, or the latest one before it. */
export function effectiveAdAmount(entries: AdBudgetPoint[], date: string): number {
  let amount = 0;
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  for (const entry of sorted) {
    if (entry.date <= date) amount = entry.amount;
    else break;
  }
  return amount;
}

export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/**
 * Saving today (or a later day) carries that amount forward.
 * Saving an earlier day changes only that day: the next day keeps the amount it already had.
 */
export function adBudgetWrites(
  entries: AdBudgetPoint[],
  date: string,
  amount: number,
  today: string,
): AdBudgetPoint[] {
  const writes: AdBudgetPoint[] = [{ date, amount }];
  if (date < today) {
    const next = addCalendarDays(date, 1);
    if (!entries.some((entry) => entry.date === next)) {
      writes.push({ date: next, amount: effectiveAdAmount(entries, next) });
    }
  }
  return writes;
}
