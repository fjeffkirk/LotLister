import { describe, expect, it } from 'vitest';
import { adBudgetWrites, effectiveAdAmount } from '../lib/ad-budget';
import { itemCostFromMargins, salesProfit } from '../lib/profit';

describe('ad spend on a past day', () => {
  it('changes only that day and leaves the following days on the old amount', () => {
    const entries = [{ date: '2026-10-01', amount: 50 }];
    expect(adBudgetWrites(entries, '2026-10-07', 80, '2026-10-09')).toEqual([
      { date: '2026-10-07', amount: 80 },
      { date: '2026-10-08', amount: 50 },
    ]);
  });

  it('does not overwrite a later day that already has its own amount', () => {
    const entries = [
      { date: '2026-10-01', amount: 50 },
      { date: '2026-10-09', amount: 60 },
    ];
    expect(adBudgetWrites(entries, '2026-10-08', 40, '2026-10-09')).toEqual([
      { date: '2026-10-08', amount: 40 },
    ]);
    expect(effectiveAdAmount(entries, '2026-10-09')).toBe(60);
  });

  it('lets today carry forward without pinning tomorrow', () => {
    expect(adBudgetWrites([{ date: '2026-10-01', amount: 50 }], '2026-10-09', 70, '2026-10-09')).toEqual([
      { date: '2026-10-09', amount: 70 },
    ]);
  });
});

describe('sales profit', () => {
  it('subtracts shipping already removed from merchandise, ads, item cost, and postage', () => {
    expect(salesProfit(90, 58.5, 10, 15)).toBe(6.5);
  });

  it('prices item cost from LotLister margins, including a product override', () => {
    expect(itemCostFromMargins(100, 100, 65, 0.35)).toBe(65);
    expect(itemCostFromMargins(80, 100, 65, 0.35)).toBe(52);
    expect(itemCostFromMargins(100, 0, 0, 0.35)).toBe(65);
  });
});
