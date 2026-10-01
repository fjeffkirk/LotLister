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

const BANK_LEDGER = /disburse|recoup/i;

/** Sum of Etsy payment-ledger amounts in minor units, excluding bank deposits. */
export function etsyLedgerProfit(entries: { amount?: number; ledger_type?: string }[]): { profit: number; fees: number } {
  let profit = 0;
  let fees = 0;
  for (const entry of entries) {
    if (BANK_LEDGER.test(entry.ledger_type ?? '')) continue;
    const minor = Number(entry.amount);
    if (!Number.isFinite(minor)) continue;
    const dollars = minor / 100;
    profit += dollars;
    if (dollars < 0) fees += -dollars;
  }
  return { profit: Math.round(profit * 100) / 100, fees: Math.round(fees * 100) / 100 };
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
