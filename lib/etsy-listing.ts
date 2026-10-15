/** Pure Etsy listing helpers. Kept out of the API client so tests do not load Prisma. */

const WHEN_MADE: { min: number; value: string }[] = [
  { min: 2020, value: '2020_2026' },
  { min: 2010, value: '2010_2019' },
  { min: 2007, value: '2007_2009' },
  { min: 2000, value: '2000_2006' },
  { min: 1990, value: '1990s' },
  { min: 1980, value: '1980s' },
  { min: 1970, value: '1970s' },
  { min: 1960, value: '1960s' },
  { min: 1950, value: '1950s' },
  { min: 1940, value: '1940s' },
  { min: 1930, value: '1930s' },
  { min: 1920, value: '1920s' },
  { min: 1910, value: '1910s' },
  { min: 1900, value: '1900s' },
  { min: 1800, value: '1800s' },
  { min: 1700, value: '1700s' },
];

export function whenMadeFromYear(year: number | null | undefined): string {
  if (year === null || year === undefined || !Number.isFinite(year)) return '2020_2026';
  return WHEN_MADE.find((era) => year >= era.min)?.value ?? 'before_1700';
}

export function etsyTitle(title: string): string {
  const cleaned = title
    .replace(/[^\p{L}\p{N}\p{P}\p{Zs}™©®]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'Trading card').slice(0, 140);
}

export function plainDescription(html: string, fallback: string): string {
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return (text || fallback).slice(0, 5000);
}

/** Etsy allows 13 tags, each up to 20 characters, letters, numbers, spaces, and a few marks. */
export function etsyTags(parts: Array<string | number | null | undefined>): string[] {
  const tags: string[] = [];
  for (const part of parts) {
    if (part === null || part === undefined) continue;
    const tag = String(part)
      .replace(/[^\p{L}\p{N}\p{Zs}\-'™©®]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 20);
    if (!tag) continue;
    if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) continue;
    tags.push(tag);
    if (tags.length === 13) break;
  }
  return tags;
}

export function shopFromEtsyPayload(body: unknown): { shopId: string; shopName: string } | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as {
    shop_id?: number | string;
    shop_name?: string;
    results?: { shop_id?: number | string; shop_name?: string }[];
  };
  const shop = record.shop_id ? record : record.results?.find((item) => item.shop_id);
  if (!shop?.shop_id) return null;
  return { shopId: String(shop.shop_id), shopName: shop.shop_name?.trim() || 'Etsy shop' };
}

const ETSY_AD = /offsite_ads|prolist|googleads|search_ads|advertis/i;

/** Etsy Ads and Offsite Ads charged in this window, in dollars. Listing fees are not included. */
export function etsyAdCost(entries: { amount?: number; ledger_type?: string }[]): number {
  let cost = 0;
  for (const entry of entries) {
    if (!ETSY_AD.test(entry.ledger_type ?? '')) continue;
    const minor = Number(entry.amount);
    if (!Number.isFinite(minor)) continue;
    cost -= minor / 100;
  }
  return Math.round(cost * 100) / 100;
}

/** Item sales times the margin, minus Etsy ad cost. Shipping is not part of item sales. */
export function etsySalesProfit(merchandise: number, marginRate: number, adCost: number): { profit: number; itemCost: number } {
  const itemCost = Math.round(Math.max(0, merchandise) * (1 - marginRate) * 100) / 100;
  const profit = Math.round((merchandise - itemCost - adCost) * 100) / 100;
  return { profit, itemCost };
}

export interface EtsyMarginLine {
  amount: number;
  sku?: string | null;
  title?: string | null;
}

export interface MarginCatalog {
  bySku: Map<string, number>;
  titles: { key: string; rate: number }[];
}

export function normalizeMatchKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Product margin overrides, as rates from 0 to 1. Products left blank are not in the catalog. */
export function buildMarginCatalog(
  products: { sku?: string | null; title?: string | null; marginPercent?: number | null }[],
): MarginCatalog {
  const bySku = new Map<string, number>();
  const titles: { key: string; rate: number }[] = [];
  for (const product of products) {
    if (product.marginPercent == null || !Number.isFinite(product.marginPercent)) continue;
    const rate = product.marginPercent / 100;
    if (product.sku?.trim()) bySku.set(normalizeMatchKey(product.sku), rate);
    const title = product.title ? normalizeMatchKey(product.title) : '';
    if (title) titles.push({ key: title, rate });
  }
  titles.sort((a, b) => b.key.length - a.key.length);
  return { bySku, titles };
}

export function marginRateForLine(
  line: { sku?: string | null; title?: string | null },
  catalog: MarginCatalog,
  fallbackRate: number,
): { rate: number; matched: boolean } {
  const sku = line.sku ? normalizeMatchKey(line.sku) : '';
  if (sku && catalog.bySku.has(sku)) return { rate: catalog.bySku.get(sku) ?? fallbackRate, matched: true };
  const title = line.title ? normalizeMatchKey(line.title) : '';
  if (!title) return { rate: fallbackRate, matched: false };
  const exact = catalog.titles.find((item) => item.key === title);
  if (exact) return { rate: exact.rate, matched: true };
  const contained = catalog.titles.find((item) => item.key.length >= 12 && title.includes(item.key));
  if (contained) return { rate: contained.rate, matched: true };
  return { rate: fallbackRate, matched: false };
}

/**
 * Item sales times each line's product margin, otherwise the default margin, then minus ads.
 * A 60% product margin on a $39.55 item minus $8.24 ads is $15.49, not the default-margin result.
 */
export function etsyRangeProfit(
  receipts: { merchandise: number; lines: EtsyMarginLine[] }[],
  catalog: MarginCatalog,
  fallbackRate: number,
  adCost: number,
): { profit: number; itemCost: number; marginPercent: number; marginSource: 'product' | 'default' | 'mixed' } {
  let merchandise = 0;
  let gross = 0;
  let matched = false;
  let unmatched = false;
  for (const receipt of receipts) {
    const base = Math.max(0, receipt.merchandise);
    if (base === 0) continue;
    merchandise += base;
    const priced = receipt.lines.filter((line) => line.amount > 0);
    const source = priced.length > 0 ? priced : [{ amount: base, sku: receipt.lines[0]?.sku, title: receipt.lines[0]?.title }];
    const sum = source.reduce((total, line) => total + line.amount, 0) || base;
    for (const line of source) {
      const found = marginRateForLine(line, catalog, fallbackRate);
      gross += base * (line.amount / sum) * found.rate;
      if (found.matched) matched = true;
      else unmatched = true;
    }
  }
  const itemCost = Math.round((merchandise - gross) * 100) / 100;
  const profit = Math.round((gross - adCost) * 100) / 100;
  const marginPercent = merchandise > 0 ? Math.round((gross / merchandise) * 1000) / 10 : Math.round(fallbackRate * 1000) / 10;
  const marginSource = matched && unmatched ? 'mixed' : matched ? 'product' : 'default';
  return { profit, itemCost, marginPercent, marginSource };
}

export function etsyMoney(value: { amount?: number; divisor?: number } | null | undefined): number {
  if (!value || !value.divisor) return 0;
  const amount = Number(value.amount);
  const divisor = Number(value.divisor);
  if (!Number.isFinite(amount) || !Number.isFinite(divisor) || divisor === 0) return 0;
  return amount / divisor;
}

export function etsyErrorText(status: number, body: string): string {
  let message = '';
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === 'string') message = parsed.error;
    else if (Array.isArray(parsed.error)) {
      message = parsed.error
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object' && 'message' in item) return String((item as { message: unknown }).message);
          return '';
        })
        .filter(Boolean)
        .join(' ');
    } else if (typeof parsed.message === 'string') message = parsed.message;
  } catch {
    message = '';
  }
  const text = (message || body).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? `Etsy error ${status}: ${text.slice(0, 400)}` : `Etsy request failed (${status})`;
}
