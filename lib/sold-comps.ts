import { graderShortLabel } from './card-fields';
import { isCardGraded } from './card-completeness';
import { getEbayApplicationToken } from './ebay';
import { CardItemWithImages, getCategoryEbayId } from './types';

const INSIGHTS_SCOPE = 'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights';
const INSIGHTS_URL = 'https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search';
const CACHE_MS = 10 * 60 * 1000;

export interface SoldComp {
  title: string;
  price: number;
  soldAt: string | null;
  url: string | null;
}

export interface SoldCompLookup {
  sales: SoldComp[];
  searchUrl: string;
  message?: string;
}

interface SearchPlan {
  /** Comma-separated keywords. Marketplace Insights treats commas as AND. */
  keywords: string;
  /** Spaces, for the public eBay sold-search link. */
  phrase: string;
}

function words(value: string | number | null | undefined): string[] {
  if (value === null || value === undefined) return [];
  return String(value)
    .replace(/#/g, ' ')
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 1 || /^\d+$/.test(part));
}

/** Strict search first, then a looser one if the grade or parallel filters out every sale. */
export function compSearchPlans(card: CardItemWithImages): SearchPlan[] {
  const identity = [
    ...words(card.year),
    ...words(card.brand),
    ...words(card.setName),
    ...words(card.name),
    ...words(card.cardNumber),
  ];
  const parallel = words(card.subsetParallel);
  const grade = isCardGraded(card) ? [...words(card.grader ? graderShortLabel(card.grader) : ''), ...words(card.grade)] : [];

  const plans = [
    [...identity, ...parallel, ...grade],
    [...identity, ...grade],
    identity,
  ];

  const seen = new Set<string>();
  return plans.flatMap((tokens) => {
    const unique = [...new Set(tokens)].slice(0, 12);
    if (unique.length < 2) return [];
    const keywords = unique.join(',');
    if (seen.has(keywords)) return [];
    seen.add(keywords);
    return [{ keywords, phrase: unique.join(' ') }];
  });
}

export function ebaySoldSearchUrl(phrase: string): string {
  const params = new URLSearchParams({
    _nkw: phrase,
    LH_Sold: '1',
    LH_Complete: '1',
    _sop: '13',
  });
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

interface InsightsItem {
  title?: string;
  itemWebUrl?: string;
  lastSoldDate?: string;
  lastSoldPrice?: { value?: string };
}

const cache = new Map<string, { at: number; sales: SoldComp[] }>();

function parseSales(items: InsightsItem[]): SoldComp[] {
  return items
    .map((item) => {
      const price = Number(item.lastSoldPrice?.value);
      if (!item.title || !Number.isFinite(price)) return null;
      return {
        title: item.title,
        price,
        soldAt: item.lastSoldDate ?? null,
        url: item.itemWebUrl ?? null,
      };
    })
    .filter((sale): sale is SoldComp => sale !== null)
    .sort((a, b) => Date.parse(b.soldAt ?? '') - Date.parse(a.soldAt ?? ''));
}

async function fetchInsights(token: string, keywords: string, categoryId: string): Promise<SoldComp[]> {
  const key = `${categoryId}:${keywords}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.sales;

  const url = new URL(INSIGHTS_URL);
  url.searchParams.set('q', keywords);
  url.searchParams.set('category_ids', categoryId);
  url.searchParams.set('limit', '20');
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('eBay has not enabled sold-price search for this app yet.');
  }
  if (!response.ok) {
    throw new Error('eBay could not search recent sales.');
  }
  const body = (await response.json()) as { itemSales?: InsightsItem[]; items?: InsightsItem[] };
  const sales = parseSales(body.itemSales ?? body.items ?? []);
  cache.set(key, { at: Date.now(), sales });
  return sales;
}

export async function searchRecentSales(card: CardItemWithImages): Promise<SoldCompLookup> {
  const plans = compSearchPlans(card);
  const phrase = plans[0]?.phrase || [card.year, card.brand, card.name].filter(Boolean).join(' ');
  const searchUrl = ebaySoldSearchUrl(phrase);
  if (plans.length === 0) return { sales: [], searchUrl, message: 'Not enough card details to search.' };

  let token: string;
  try {
    token = await getEbayApplicationToken(INSIGHTS_SCOPE);
  } catch {
    return { sales: [], searchUrl, message: 'eBay has not enabled sold-price search for this app yet.' };
  }

  const categoryId = getCategoryEbayId(card.category || '');
  try {
    for (const plan of plans) {
      const sales = await fetchInsights(token, plan.keywords, categoryId);
      if (sales.length > 0) return { sales: sales.slice(0, 3), searchUrl: ebaySoldSearchUrl(plan.phrase) };
    }
    return { sales: [], searchUrl };
  } catch (error) {
    return {
      sales: [],
      searchUrl,
      message: error instanceof Error ? error.message : 'eBay could not search recent sales.',
    };
  }
}
