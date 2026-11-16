import { describe, expect, it } from 'vitest';
import {
  buildEbayItem,
  ebayDescription,
  ebayTitle,
  parseTradingListingResponse,
  type EbayListingDefaultsInput,
  type ShopifyListingProduct,
} from '../lib/ebay-shopify-listing';
import { createShopifyListing, previewShopifyListing, type ListingDeps, type ListingRow } from '../lib/ebay-shopify-flow';
import { normalizeListingProduct, productGid, searchTerm } from '../lib/shopify/listing-product';

const defaults: EbayListingDefaultsInput = {
  postalCode: '78701',
  location: 'Austin, TX',
  shippingService: 'USPSParcel',
  shippingCost: 5.5,
  freeShipping: false,
  additionalItemCost: 1,
  handlingDays: 2,
  returnsAccepted: true,
  returnDays: 30,
  returnShippingPaidBy: 'Buyer',
  bestOfferEnabled: false,
};

function singleProduct(overrides: Partial<ShopifyListingProduct> = {}): ShopifyListingProduct {
  return {
    id: 'gid://shopify/Product/1',
    title: 'Walnut Card Stand',
    handle: 'walnut-card-stand',
    descriptionHtml: '<p>Solid walnut.</p><script>alert(1)</script>',
    vendor: 'Box Buddy',
    productType: 'Display stand',
    tags: [],
    status: 'ACTIVE',
    currency: 'USD',
    options: [{ name: 'Title', values: ['Default Title'] }],
    images: ['https://cdn.shopify.com/a.jpg', 'https://cdn.shopify.com/b.jpg'],
    variants: [{
      id: 'gid://shopify/ProductVariant/11',
      title: 'Default Title',
      sku: 'STAND-WAL',
      barcode: '012345678905',
      price: 24.99,
      quantity: 3,
      options: [{ name: 'Title', value: 'Default Title' }],
      image: null,
    }],
    ...overrides,
  };
}

function variantProduct(): ShopifyListingProduct {
  return singleProduct({
    id: 'gid://shopify/Product/2',
    title: 'Card Stand',
    options: [{ name: 'Color', values: ['Black', 'White'] }],
    images: ['https://cdn.shopify.com/main.jpg'],
    variants: [
      { id: 'v1', title: 'Black', sku: 'STAND-BLK', barcode: '', price: 12, quantity: 2, options: [{ name: 'Color', value: 'Black' }], image: 'https://cdn.shopify.com/black.jpg' },
      { id: 'v2', title: 'White', sku: 'STAND-WHT', barcode: '', price: 14, quantity: 0, options: [{ name: 'Color', value: 'White' }], image: 'https://cdn.shopify.com/white.jpg' },
    ],
  });
}

describe('eBay listing built from a Shopify product', () => {
  it('copies a single product with price, stock, SKU, photos, and the vendor as Brand', () => {
    const built = buildEbayItem(singleProduct(), defaults, { categoryId: '183454', conditionId: 1000 });
    expect(built.problems).toEqual([]);
    expect(built.itemXml).toContain('<Title>Walnut Card Stand</Title>');
    expect(built.itemXml).toContain('<StartPrice currencyID="USD">24.99</StartPrice>');
    expect(built.itemXml).toContain('<Quantity>3</Quantity>');
    expect(built.itemXml).toContain('<SKU>STAND-WAL</SKU>');
    expect(built.itemXml).toContain('<UPC>012345678905</UPC>');
    expect(built.itemXml).toContain('<Name>Brand</Name><Value>Box Buddy</Value>');
    expect(built.itemXml).toContain('<ListingType>FixedPriceItem</ListingType><ListingDuration>GTC</ListingDuration>');
    expect(built.itemXml.match(/<PictureURL>/g)).toHaveLength(2);
    expect(built.itemXml).not.toContain('<script');
    expect(built.itemXml).not.toContain('<Variations>');
    expect(built.summary).toMatchObject({ price: 24.99, quantity: 3, title: 'Walnut Card Stand' });
  });

  it('lists each Shopify variant as an eBay variation with its own price, stock, SKU, and photo', () => {
    const built = buildEbayItem(variantProduct(), defaults, {
      categoryId: '183454',
      conditionId: 1000,
      itemSpecifics: [{ name: 'Color', values: ['Black'] }, { name: 'Material', values: ['PLA'] }],
    });
    expect(built.problems).toEqual([]);
    expect(built.itemXml).toContain('<Variation><SKU>STAND-BLK</SKU><StartPrice currencyID="USD">12.00</StartPrice><Quantity>2</Quantity>');
    expect(built.itemXml).toContain('<SKU>STAND-WHT</SKU><StartPrice currencyID="USD">14.00</StartPrice><Quantity>0</Quantity>');
    expect(built.itemXml).toContain('<VariationSpecificsSet><NameValueList><Name>Color</Name><Value>Black</Value><Value>White</Value></NameValueList></VariationSpecificsSet>');
    expect(built.itemXml).toContain('<VariationSpecificName>Color</VariationSpecificName>');
    expect(built.itemXml).toContain('<VariationSpecificValue>White</VariationSpecificValue><PictureURL>https://cdn.shopify.com/white.jpg</PictureURL>');
    const shared = built.itemXml.match(/<ItemSpecifics>([\s\S]*?)<\/ItemSpecifics>/)?.[1] ?? '';
    expect(shared).toContain('Material');
    expect(shared).not.toContain('Color');
    expect(built.summary.quantity).toBe(2);
    expect(built.summary.variations).toHaveLength(2);
  });

  it('reports problems instead of guessing', () => {
    const untracked = singleProduct({ variants: [{ ...singleProduct().variants[0], quantity: null }] });
    expect(buildEbayItem(untracked, defaults, { categoryId: '1', conditionId: 1000 }).problems.join(' ')).toMatch(/does not track stock/);
    expect(buildEbayItem(untracked, defaults, { categoryId: '1', conditionId: 1000, quantity: 4 }).summary.quantity).toBe(4);

    const soldOut = singleProduct({ variants: [{ ...singleProduct().variants[0], quantity: -2 }] });
    expect(buildEbayItem(soldOut, defaults, { categoryId: '1', conditionId: 1000 }).problems.join(' ')).toMatch(/out of stock/);

    const cad = buildEbayItem(singleProduct({ currency: 'CAD' }), defaults, { categoryId: '1', conditionId: 1000 });
    expect(cad.problems.join(' ')).toMatch(/CAD/);

    const noPhoto = buildEbayItem(singleProduct({ images: ['http://insecure.example/a.jpg'] }), defaults, { categoryId: '1', conditionId: 1000 });
    expect(noPhoto.problems.join(' ')).toMatch(/https photo/);

    const noLocation = buildEbayItem(singleProduct(), { ...defaults, postalCode: '' }, { categoryId: '1', conditionId: 1000 });
    expect(noLocation.problems.join(' ')).toMatch(/location/);
  });

  it('shortens long titles at a word boundary and strips active content', () => {
    const long = ebayTitle('Handmade walnut trading card display stand for graded slabs and toploaders with felt base and gift box');
    expect(long.shortened).toBe(true);
    expect(long.title.length).toBeLessThanOrEqual(80);
    expect(long.title.endsWith(' ')).toBe(false);
    expect(ebayDescription('<p onclick="x()">Hi</p><iframe src="a"></iframe><a href="javascript:alert(1)">x</a>')).toBe('<p>Hi</p><a >x</a>');
  });

  it('reads fees, warnings, and the item id of a duplicate UUID', () => {
    const verified = parseTradingListingResponse(`<VerifyAddFixedPriceItemResponse><Ack>Warning</Ack>
      <Fees><Fee><Name>ListingFee</Name><Fee currencyID="USD">0.35</Fee></Fee><Fee><Name>BoldFee</Name><Fee currencyID="USD">0.0</Fee></Fee></Fees>
      <Errors><ShortMessage>Hint</ShortMessage><LongMessage>Add a UPC.</LongMessage><ErrorCode>21919403</ErrorCode><SeverityCode>Warning</SeverityCode></Errors>
    </VerifyAddFixedPriceItemResponse>`);
    expect(verified.ok).toBe(true);
    expect(verified.fees).toEqual([{ name: 'ListingFee', amount: 0.35, currency: 'USD' }]);
    expect(verified.warnings[0]).toMatch(/21919403/);

    const duplicate = parseTradingListingResponse(`<AddFixedPriceItemResponse><Ack>Failure</Ack><Errors>
      <LongMessage>Duplicate UUID used.</LongMessage><ErrorCode>488</ErrorCode><SeverityCode>Error</SeverityCode>
      <ErrorParameters ParamID="0"><Value>1</Value></ErrorParameters><ErrorParameters ParamID="1"><Value>395512345678</Value></ErrorParameters>
    </Errors></AddFixedPriceItemResponse>`);
    expect(duplicate.ok).toBe(false);
    expect(duplicate.duplicateItemId).toBe('395512345678');
  });

  it('normalizes the Shopify product query', () => {
    const product = normalizeListingProduct({
      shop: { currencyCode: 'USD' },
      product: {
        id: 'gid://shopify/Product/9',
        title: 'Stand',
        handle: 'stand',
        descriptionHtml: null,
        vendor: null,
        productType: null,
        tags: null,
        status: 'ACTIVE',
        options: null,
        media: { nodes: [{ image: { url: 'https://cdn.shopify.com/1.jpg' } }, {}, null] },
        variants: {
          pageInfo: { hasNextPage: false },
          nodes: [{
            id: 'v', title: 'Default Title', sku: null, barcode: null, price: '9.50', inventoryQuantity: 7,
            selectedOptions: [{ name: 'Title', value: 'Default Title' }], image: null, inventoryItem: { tracked: false },
          }],
        },
      },
    });
    expect(product.images).toEqual(['https://cdn.shopify.com/1.jpg']);
    expect(product.variants[0]).toMatchObject({ price: 9.5, quantity: null, sku: '' });
    expect(productGid('123')).toBe('gid://shopify/Product/123');
    expect(() => productGid('abc')).toThrow();
    expect(searchTerm('sku', 'A"B')).toBe('sku:"AB"');
  });
});

function memoryDeps(options: {
  product?: ShopifyListingProduct;
  defaults?: EbayListingDefaultsInput | null;
  required?: string[];
  verify?: string;
  add?: string;
  getItem?: string;
} = {}) {
  const rows = new Map<string, ListingRow>();
  const calls: { callName: string; xml: string }[] = [];
  let ids = 0;
  const deps: ListingDeps = {
    product: async () => options.product ?? singleProduct(),
    defaults: async () => (options.defaults === undefined ? defaults : options.defaults),
    suggestCategories: async () => [{ categoryId: '183454', categoryName: 'Card Stands', path: 'Collectibles > Card Stands' }],
    requiredAspects: async () => options.required ?? [],
    async trading(callName, xml) {
      calls.push({ callName, xml });
      if (callName === 'VerifyAddFixedPriceItem') return options.verify ?? '<Ack>Success</Ack><Fees><Fee><Name>ListingFee</Name><Fee currencyID="USD">0.35</Fee></Fee></Fees>';
      if (callName === 'AddFixedPriceItem') return options.add ?? '<Ack>Success</Ack><ItemID>395500000001</ItemID>';
      return options.getItem ?? '<GetItemResponse><Ack>Success</Ack><Item><ItemID>395500000001</ItemID><Title>Walnut Card Stand</Title><Seller><UserID>obdcollect</UserID></Seller><SellingStatus><ListingStatus>Active</ListingStatus></SellingStatus><StartPrice currencyID="USD">24.99</StartPrice><ListingDetails><ViewItemURL>https://www.ebay.com/itm/395500000001</ViewItemURL></ListingDetails></Item></GetItemResponse>';
    },
    seller: async () => 'obdcollect',
    store: {
      async create(row) { rows.set(row.previewId, { ...row }); },
      async find(previewId) { return rows.get(previewId) ?? null; },
      async findActive(userEmail, productId) {
        return [...rows.values()].find((row) => row.userEmail === userEmail && row.shopifyProductId === productId && (row.status === 'listed' || row.status === 'creating')) ?? null;
      },
      async claim(previewId, userEmail) {
        const row = rows.get(previewId);
        if (!row || row.userEmail !== userEmail || row.status === 'listed') return false;
        row.status = 'creating';
        return true;
      },
      async finish(previewId, data) {
        const row = rows.get(previewId)!;
        row.status = data.status;
        if (data.ebayItemId !== undefined) row.ebayItemId = data.ebayItemId;
        if (data.error !== undefined) row.error = data.error;
      },
    },
    newPreviewId: () => `ebl_${String(++ids).padStart(24, '0')}`,
    newUuid: () => 'A'.repeat(32),
    now: () => new Date('2026-11-16T20:00:00Z'),
  };
  return { deps, rows, calls };
}

describe('Shopify to eBay preview and create', () => {
  it('previews with VerifyAddFixedPriceItem and never sends a live listing', async () => {
    const { deps, calls } = memoryDeps();
    const preview = await previewShopifyListing('seller', { lookup: { sku: 'STAND-WAL' } }, deps);
    expect(preview).toMatchObject({ ok: true, published: false, category: { categoryId: '183454', chosenBy: 'suggestion' } });
    expect(preview.previewId).toMatch(/^ebl_/);
    expect(calls.map((call) => call.callName)).toEqual(['VerifyAddFixedPriceItem']);
    expect(calls[0].xml).not.toContain('<UUID>');
  });

  it('stops before eBay when required specifics or defaults are missing', async () => {
    const missing = memoryDeps({ required: ['Brand', 'Type'] });
    const result = await previewShopifyListing('seller', { lookup: { productId: '1' } }, missing.deps);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/Type/);
    expect(result.problems.join(' ')).not.toMatch(/Brand,/);
    expect(missing.calls).toHaveLength(0);

    const noDefaults = memoryDeps({ defaults: null });
    expect((await previewShopifyListing('seller', { lookup: { productId: '1' } }, noDefaults.deps)).problems[0]).toMatch(/defaults/);
  });

  it('returns eBay verify errors without storing a preview', async () => {
    const { deps, rows } = memoryDeps({ verify: '<Ack>Failure</Ack><Errors><LongMessage>Condition is not valid.</LongMessage><ErrorCode>21916884</ErrorCode><SeverityCode>Error</SeverityCode></Errors>' });
    const result = await previewShopifyListing('seller', { lookup: { productId: '1' }, categoryId: '183454' }, deps);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/Condition is not valid/);
    expect(rows.size).toBe(0);
  });

  it('needs seller approval, lists once with the stored UUID, and verifies by reading the item back', async () => {
    const { deps, calls } = memoryDeps();
    const preview = await previewShopifyListing('seller', { lookup: { productId: '1' } }, deps);
    const previewId = preview.previewId!;

    const refused = await createShopifyListing('seller', previewId, false, deps);
    expect(refused.ok).toBe(false);
    expect(calls.filter((call) => call.callName === 'AddFixedPriceItem')).toHaveLength(0);

    const created = await createShopifyListing('seller', previewId, true, deps);
    expect(created).toMatchObject({ ok: true, published: true, itemId: '395500000001', verification: { status: 'verified' } });
    const add = calls.find((call) => call.callName === 'AddFixedPriceItem')!;
    expect(add.xml).toContain(`<UUID>${'A'.repeat(32)}</UUID>`);

    const again = await createShopifyListing('seller', previewId, true, deps);
    expect(again).toMatchObject({ ok: true, alreadyCreated: true, itemId: '395500000001' });
    expect(calls.filter((call) => call.callName === 'AddFixedPriceItem')).toHaveLength(1);

    const second = await previewShopifyListing('seller', { lookup: { productId: '1' } }, deps);
    expect(second.ok).toBe(false);
    expect('alreadyListed' in second ? second.alreadyListed.itemId : null).toBe('395500000001');
  });

  it('uses the item id eBay returns for a duplicate UUID instead of listing again', async () => {
    const { deps, rows } = memoryDeps({ add: '<Ack>Failure</Ack><Errors><LongMessage>Duplicate UUID used.</LongMessage><ErrorCode>488</ErrorCode><SeverityCode>Error</SeverityCode><ErrorParameters ParamID="1"><Value>395500000001</Value></ErrorParameters></Errors>' });
    const preview = await previewShopifyListing('seller', { lookup: { productId: '1' } }, deps);
    const created = await createShopifyListing('seller', preview.previewId!, true, deps);
    expect(created).toMatchObject({ itemId: '395500000001', alreadyCreated: true });
    expect(rows.get(preview.previewId!)?.status).toBe('listed');
  });

  it('marks a rejected listing failed so the same preview can be retried', async () => {
    const { deps, rows } = memoryDeps({ add: '<Ack>Failure</Ack><Errors><LongMessage>Internal error.</LongMessage><ErrorCode>10007</ErrorCode><SeverityCode>Error</SeverityCode></Errors>' });
    const preview = await previewShopifyListing('seller', { lookup: { productId: '1' } }, deps);
    const failed = await createShopifyListing('seller', preview.previewId!, true, deps);
    expect(failed.ok).toBe(false);
    expect(rows.get(preview.previewId!)?.status).toBe('failed');
  });

  it('reports a read-back mismatch instead of claiming success', async () => {
    const { deps } = memoryDeps({ getItem: '<Item><ItemID>395500000001</ItemID><Title>Other</Title><SellingStatus><ListingStatus>Active</ListingStatus></SellingStatus></Item>' });
    const preview = await previewShopifyListing('seller', { lookup: { productId: '1' } }, deps);
    const created = await createShopifyListing('seller', preview.previewId!, true, deps);
    expect(created.ok).toBe(false);
    expect(created.verification?.status).toBe('mismatch');
  });

  it('does not let another seller use a preview', async () => {
    const { deps, calls } = memoryDeps();
    const preview = await previewShopifyListing('seller', { lookup: { productId: '1' } }, deps);
    const other = await createShopifyListing('someone-else', preview.previewId!, true, deps);
    expect(other.ok).toBe(false);
    expect(calls.some((call) => call.callName === 'AddFixedPriceItem')).toBe(false);
  });
});
