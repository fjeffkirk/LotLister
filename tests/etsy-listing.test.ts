import { describe, expect, it } from 'vitest';
import { buildMarginCatalog, etsyAdCost, etsyErrorText, etsyRangeProfit, etsySalesProfit, etsyTags, etsyTitle, plainDescription, shopFromEtsyPayload, whenMadeFromYear } from '../lib/etsy-listing';

describe('etsy listing fields', () => {
  it('maps a card year onto an Etsy era', () => {
    expect(whenMadeFromYear(2024)).toBe('2020_2026');
    expect(whenMadeFromYear(1998)).toBe('1990s');
    expect(whenMadeFromYear(1952)).toBe('1950s');
    expect(whenMadeFromYear(null)).toBe('2020_2026');
  });

  it('keeps titles and tags inside Etsy limits', () => {
    expect(etsyTitle(`${'A'.repeat(200)}`)).toHaveLength(140);
    expect(etsyTags(['2024 Topps', 'Shohei Ohtani', 'Shohei Ohtani', 'trading card'])).toEqual([
      '2024 Topps',
      'Shohei Ohtani',
      'trading card',
    ]);
  });

  it('reads the shop Etsy returns directly, not only a list', () => {
    expect(shopFromEtsyPayload({ shop_id: 555, shop_name: 'OBDprints' })).toEqual({
      shopId: '555',
      shopName: 'OBDprints',
    });
    expect(shopFromEtsyPayload({ results: [{ shop_id: 9, shop_name: 'Other' }] })?.shopId).toBe('9');
    expect(shopFromEtsyPayload({})).toBeNull();
  });

  it('counts Etsy ads only, and ignores listing fees and bank deposits', () => {
    expect(etsyAdCost([
      { amount: 18212, ledger_type: 'transaction' },
      { amount: -3244, ledger_type: 'offsite_ads_fee' },
      { amount: -100, ledger_type: 'googleads' },
      { amount: -800, ledger_type: 'transaction_fee' },
      { amount: -200, ledger_type: 'renew_sold' },
      { amount: 500, ledger_type: 'prolist_refund' },
      { amount: -15000, ledger_type: 'DISBURSE2' },
    ])).toBe(28.44);
  });

  it('keeps a day with no sales at zero unless Etsy charged ads', () => {
    expect(etsySalesProfit(0, 0.35, 0)).toEqual({ profit: 0, itemCost: 0 });
    expect(etsySalesProfit(0, 0.35, 32.44)).toEqual({ profit: -32.44, itemCost: 0 });
  });

  it('subtracts item cost from the margin, then ads', () => {
    expect(etsySalesProfit(100, 0.35, 10)).toEqual({ profit: 25, itemCost: 65 });
    expect(etsySalesProfit(39.55, 0.379, 8.24).profit).toBe(6.75);
    expect(etsySalesProfit(39.55, 0.6, 8.24).profit).toBe(15.49);
  });

  it('uses a product margin of 60% instead of the default that produced $6.75', () => {
    const catalog = buildMarginCatalog([
      { sku: 'CADDY-MEGA', title: 'Card Caddy Daddy MEGA', marginPercent: 60 },
    ]);
    const atDefault = etsyRangeProfit(
      [{ merchandise: 39.55, lines: [{ amount: 39.55, sku: 'OTHER', title: 'Something else' }] }],
      catalog,
      0.379,
      8.24,
    );
    expect(atDefault.profit).toBe(6.75);
    expect(atDefault.marginSource).toBe('default');
    const atProduct = etsyRangeProfit(
      [{ merchandise: 39.55, lines: [{ amount: 39.55, sku: 'caddy-mega', title: 'Original Card Caddy Daddy MEGA holder' }] }],
      catalog,
      0.379,
      8.24,
    );
    expect(atProduct.profit).toBe(15.49);
    expect(atProduct.marginPercent).toBe(60);
    expect(atProduct.marginSource).toBe('product');
    expect(atProduct.itemCost).toBe(15.82);
  });

  it('turns a description template into plain text and keeps the Etsy error', () => {
    expect(plainDescription('<p>PSA 10<br>Ohtani</p>', 'fallback')).toBe('PSA 10\nOhtani');
    expect(etsyErrorText(400, JSON.stringify({ error: 'Shipping profile is incomplete' }))).toBe(
      'Etsy error 400: Shipping profile is incomplete'
    );
  });
});
