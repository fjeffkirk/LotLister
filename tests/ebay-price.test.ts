import { describe, expect, it } from 'vitest';
import { listingArgsSchema } from '../lib/mcp/tools/ebay';
import {
  centsFromUsd,
  classifyCardCategory,
  meetsMinimum,
  nextPageCursor,
  pageFromCursor,
  parseActiveListingsXml,
  proposePriceChanges,
  reducedCents,
  reviseInventoryStatusXml,
  type ActiveListing,
} from '../lib/ebay-price';
import { applyStoredPrices, type PriceGateway, type PriceLineStore, type StoredPriceLine } from '../lib/ebay-price-apply';

const LISTING_XML = `<?xml version="1.0"?>
<GetMyeBaySellingResponse><Ack>Success</Ack>
<ActiveList>
  <PaginationResult><TotalNumberOfPages>3</TotalNumberOfPages><TotalNumberOfEntries>250</TotalNumberOfEntries></PaginationResult>
  <Item>
    <ItemID>111</ItemID>
    <Title>Shohei Ohtani</Title>
    <SKU>CARD-1</SKU>
    <ListingType>FixedPriceItem</ListingType>
    <SellingStatus><CurrentPrice currencyID="USD">30.00</CurrentPrice></SellingStatus>
    <PrimaryCategory><CategoryID>261328</CategoryID><CategoryName>Sports Trading Cards</CategoryName></PrimaryCategory>
  </Item>
  <Item>
    <ItemID>222</ItemID>
    <Title>Oak stand</Title>
    <ListingType>Chinese</ListingType>
    <SellingStatus><CurrentPrice currencyID="USD">40.00</CurrentPrice></SellingStatus>
    <PrimaryCategory><CategoryID>99</CategoryID><CategoryName>Home Decor</CategoryName></PrimaryCategory>
  </Item>
</ActiveList>
</GetMyeBaySellingResponse>`;

function card(price: number, extra: Partial<ActiveListing> = {}): ActiveListing {
  return {
    itemId: extra.itemId ?? '111',
    title: extra.title ?? 'Card',
    price,
    currency: 'USD',
    format: 'FixedPriceItem',
    categoryId: '261328',
    categoryName: 'Sports Trading Cards',
    sku: 'CARD-1',
    variations: [],
    url: 'https://www.ebay.com/itm/111',
    ...extra,
  };
}

function line(partial: Partial<StoredPriceLine> & Pick<StoredPriceLine, 'id' | 'itemId' | 'originalCents' | 'proposedCents'>): StoredPriceLine {
  return {
    previewId: 'price_test',
    variationSku: null,
    listingSku: 'CARD-1',
    title: 'Card',
    currency: 'USD',
    originalPrice: partial.originalCents / 100,
    proposedPrice: partial.proposedCents / 100,
    status: 'pending',
    reason: null,
    verifiedCents: null,
    ...partial,
  };
}

function memoryStore(rows: StoredPriceLine[]): PriceLineStore {
  return {
    async create() {},
    async list(previewId) {
      const found = rows.filter((row) => row.previewId === previewId);
      return found.length ? found : [];
    },
    async claim(id) {
      const row = rows.find((item) => item.id === id);
      if (!row || (row.status !== 'pending' && row.status !== 'failed')) return false;
      row.status = 'applying';
      return true;
    },
    async finish(id, status, reason, verifiedCents) {
      const row = rows.find((item) => item.id === id);
      if (!row) return;
      row.status = status;
      row.reason = reason;
      row.verifiedCents = verifiedCents ?? null;
    },
  };
}

describe('eBay price changes', () => {
  it('accepts a page of 100 listings and a cursor', () => {
    expect(listingArgsSchema.parse({ limit: 100 })).toEqual({ limit: 100 });
    expect(listingArgsSchema.parse({ limit: '100', cursor: '2' })).toMatchObject({ limit: 100, cursor: '2' });
    expect(pageFromCursor(null)).toBe(1);
    expect(pageFromCursor('2')).toBe(2);
    expect(() => pageFromCursor('next')).toThrow(/cursor/);
  });

  it('returns a cursor while more listing pages remain', () => {
    const parsed = parseActiveListingsXml(LISTING_XML);
    expect(parsed.total).toBe(250);
    expect(parsed.listings[0]).toMatchObject({
      itemId: '111',
      title: 'Shohei Ohtani',
      price: 30,
      currency: 'USD',
      format: 'FixedPriceItem',
      categoryId: '261328',
      categoryName: 'Sports Trading Cards',
      sku: 'CARD-1',
      url: 'https://www.ebay.com/itm/111',
    });
    expect(nextPageCursor(1, parsed.totalPages)).toEqual({ hasMore: true, cursor: '2' });
    expect(nextPageCursor(3, parsed.totalPages)).toEqual({ hasMore: false, cursor: null });
  });

  it('includes $30 and excludes anything below it before discounting', () => {
    const minimumCents = centsFromUsd(30);
    expect(meetsMinimum(centsFromUsd(30), minimumCents)).toBe(true);
    expect(meetsMinimum(centsFromUsd(29.99), minimumCents)).toBe(false);
    const proposed = proposePriceChanges(
      [card(30, { itemId: '30' }), card(29.99, { itemId: 'low' }), card(40, { itemId: 'auc', format: 'Chinese' })],
      { percentOff: 10, minimumCents, tradingCardsOnly: true }
    );
    expect(proposed.changes.map((change) => change.itemId)).toEqual(['30']);
    expect(proposed.changes[0]).toMatchObject({ originalPrice: 30, proposedPrice: 27 });
    expect(proposed.exclusions.map((row) => row.reason).join(' ')).toMatch(/below the minimum/);
    expect(proposed.exclusions.map((row) => row.reason).join(' ')).toMatch(/Auction/);
  });

  it('rounds a 10 percent reduction to the nearest cent', () => {
    expect(reducedCents(3333, 10)).toBe(3000);
    expect(reducedCents(1005, 10)).toBe(905);
  });

  it('flags uncertain card categories and keeps known trading-card categories', () => {
    expect(classifyCardCategory('261328', 'Something else')).toBe('card');
    expect(classifyCardCategory('555', 'Sports Trading Cards')).toBe('card');
    expect(classifyCardCategory('555', 'Baseball Cards')).toBe('uncertain');
    expect(classifyCardCategory('555', 'Laptop Stands')).toBe('other');
    const proposed = proposePriceChanges(
      [card(40, { itemId: 'maybe', categoryId: '555', categoryName: 'Baseball Cards' })],
      { percentOff: 10, minimumCents: 3000, tradingCardsOnly: true }
    );
    expect(proposed.changes).toHaveLength(0);
    expect(proposed.exclusions[0].reason).toMatch(/Uncertain category/);
  });

  it('reports a variation that has no SKU instead of changing the parent price', () => {
    const proposed = proposePriceChanges(
      [card(40, {
        variations: [{ id: '111#1', sku: null, price: 40, currency: 'USD' }],
      })],
      { percentOff: 10, minimumCents: 3000, tradingCardsOnly: true }
    );
    expect(proposed.changes).toHaveLength(0);
    expect(proposed.exclusions[0].reason).toMatch(/cannot be revised individually/);
  });

  it('sends only the new price to eBay', () => {
    const xml = reviseInventoryStatusXml([{ itemId: '111', sku: null, priceCents: 2700 }]);
    expect(xml).toContain('<StartPrice currencyID="USD">27.00</StartPrice>');
    expect(xml).not.toContain('Quantity');
    expect(xml).not.toContain('Description');
    expect(xml).not.toContain('Shipping');
  });

  it('skips a listing whose price changed after the preview', async () => {
    const rows = [line({ id: 'a', itemId: '111', originalCents: 3000, proposedCents: 2700 })];
    const revised: string[] = [];
    const gateway: PriceGateway = {
      async readPrice() {
        return { cents: 3500, currency: 'USD', format: 'FixedPriceItem' };
      },
      async reviseTrading(itemId) {
        revised.push(itemId);
        return { ok: true };
      },
      async reviseInventory() {
        return { ok: false, error: 'not used' };
      },
    };
    const result = await applyStoredPrices(memoryStore(rows), gateway, 'price_test', 'seller', { info() {} }, async () => {});
    expect(revised).toEqual([]);
    expect(result.skipped).toBe(1);
    expect(result.results[0].reason).toMatch(/not the previewed/);
  });

  it('does not discount a preview twice', async () => {
    const rows = [line({ id: 'a', itemId: '111', originalCents: 3000, proposedCents: 2700 })];
    let cents = 3000;
    const revised: string[] = [];
    const gateway: PriceGateway = {
      async readPrice() {
        return { cents, currency: 'USD', format: 'FixedPriceItem' };
      },
      async reviseTrading() {
        revised.push('111');
        cents = 2700;
        return { ok: true };
      },
      async reviseInventory() {
        return { ok: false };
      },
    };
    const store = memoryStore(rows);
    const pause = async () => {};
    const first = await applyStoredPrices(store, gateway, 'price_test', 'seller', { info() {} }, pause);
    const second = await applyStoredPrices(store, gateway, 'price_test', 'seller', { info() {} }, pause);
    expect(first.updated).toBe(1);
    expect(first.verified).toBe(1);
    expect(revised).toEqual(['111']);
    expect(second.updated).toBe(0);
    expect(second.verified).toBe(1);
  });

  it('retries only the listing that failed', async () => {
    const rows = [
      line({ id: 'a', itemId: '111', originalCents: 3000, proposedCents: 2700 }),
      line({ id: 'b', itemId: '222', originalCents: 5000, proposedCents: 4500 }),
    ];
    const prices = new Map([['111', 3000], ['222', 5000]]);
    const revised: string[] = [];
    let fail = true;
    const gateway: PriceGateway = {
      async readPrice(itemId) {
        return { cents: prices.get(itemId) ?? 0, currency: 'USD', format: 'FixedPriceItem' };
      },
      async reviseTrading(itemId, _sku, priceCents) {
        revised.push(itemId);
        if (itemId === '222' && fail) return { ok: false, error: 'eBay timed out' };
        prices.set(itemId, priceCents);
        return { ok: true };
      },
      async reviseInventory() {
        return { ok: false };
      },
    };
    const store = memoryStore(rows);
    const pause = async () => {};
    const first = await applyStoredPrices(store, gateway, 'price_test', 'seller', { info() {} }, pause);
    expect(first.updated).toBe(1);
    expect(first.failed).toBe(1);
    fail = false;
    const second = await applyStoredPrices(store, gateway, 'price_test', 'seller', { info() {} }, pause);
    expect(revised.filter((id) => id === '111')).toHaveLength(1);
    expect(revised.filter((id) => id === '222')).toHaveLength(2);
    expect(second.updated).toBe(1);
    expect(second.failed).toBe(0);
    expect(second.verified).toBe(2);
  });

  it('treats a retried preview that already reached the new price as verified', async () => {
    const rows = [line({ id: 'a', itemId: '111', originalCents: 3000, proposedCents: 2700, status: 'applying' })];
    const revised: string[] = [];
    const logs: Record<string, unknown>[] = [];
    const gateway: PriceGateway = {
      async readPrice() {
        return { cents: 2700, currency: 'USD', format: 'FixedPriceItem' };
      },
      async reviseTrading(itemId) {
        revised.push(itemId);
        return { ok: true };
      },
      async reviseInventory() {
        return { ok: false };
      },
    };
    const result = await applyStoredPrices(
      memoryStore(rows),
      gateway,
      'price_test',
      'seller',
      { info: (entry) => logs.push(entry) },
      async () => {}
    );
    expect(revised).toEqual([]);
    expect(result.verified).toBe(1);
    expect(result.updated).toBe(0);
    expect(JSON.stringify(logs)).not.toMatch(/token|Bearer|secret/i);
    expect(logs[0]).toMatchObject({ listingId: '111', oldPrice: 30, newPrice: 27, outcome: 'verified' });
  });
});
