/** Builds an eBay fixed-price listing from a Shopify product. Pure, so tests do not load Prisma. */

export const EBAY_TITLE_MAX = 80;
export const EBAY_PICTURE_MAX = 24;
export const EBAY_VARIATION_PICTURE_MAX = 12;
export const EBAY_SHIPPING_SERVICES = ['USPSParcel', 'USPSFirstClass', 'USPSPriority', 'USPSPriorityExpress', 'UPSGround', 'UPS3rdDay', 'UPS2ndDay', 'UPSNextDay', 'FedExHomeDelivery', 'FedEx2Day'] as const;
export const EBAY_RETURN_DAYS = [14, 30, 60] as const;
export const EBAY_CONDITION_NEW = 1000;

export interface ShopifyListingVariant {
  id: string;
  title: string;
  sku: string;
  barcode: string;
  price: number;
  /** null when Shopify does not track inventory for this variant. */
  quantity: number | null;
  options: { name: string; value: string }[];
  image: string | null;
}

export interface ShopifyListingProduct {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  tags: string[];
  status: string;
  currency: string;
  options: { name: string; values: string[] }[];
  images: string[];
  variants: ShopifyListingVariant[];
}

export interface EbayListingDefaultsInput {
  postalCode: string;
  location: string;
  shippingService: string;
  shippingCost: number;
  freeShipping: boolean;
  additionalItemCost: number;
  handlingDays: number;
  returnsAccepted: boolean;
  returnDays: number;
  returnShippingPaidBy: string;
  bestOfferEnabled: boolean;
}

export interface EbayItemSpecific {
  name: string;
  values: string[];
}

export interface EbayListingChoices {
  categoryId: string;
  conditionId: number;
  title?: string;
  descriptionHtml?: string;
  itemSpecifics?: EbayItemSpecific[];
  /** Used for variants Shopify does not track. */
  quantity?: number;
}

export interface EbayListingSummary {
  shopifyProductId: string;
  title: string;
  titleShortened: boolean;
  categoryId: string;
  conditionId: number;
  currency: 'USD';
  price: number | null;
  quantity: number;
  variations: { sku: string; options: Record<string, string>; price: number; quantity: number }[];
  pictures: string[];
  itemSpecifics: EbayItemSpecific[];
  shipping: string;
  returns: string;
  bestOffer: boolean;
}

export interface BuiltEbayItem {
  itemXml: string;
  summary: EbayListingSummary;
  problems: string[];
  notes: string[];
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function money(value: number): string {
  return value.toFixed(2);
}

/** eBay titles are 80 characters. Cut at a word boundary when one is close. */
export function ebayTitle(raw: string): { title: string; shortened: boolean } {
  const clean = raw.replace(/\s+/g, ' ').trim();
  if (clean.length <= EBAY_TITLE_MAX) return { title: clean, shortened: false };
  const cut = clean.slice(0, EBAY_TITLE_MAX);
  const space = cut.lastIndexOf(' ');
  return { title: (space >= 60 ? cut.slice(0, space) : cut).trim(), shortened: true };
}

/** eBay rejects active content. Shopify descriptions can contain scripts, embeds, and inline handlers. */
export function ebayDescription(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed|form|noscript)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|input|button|link|meta)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '')
    .replace(/]]>/g, ']] >')
    .trim();
}

function productIdentifier(barcode: string): { tag: 'UPC' | 'EAN'; value: string } | null {
  const digits = barcode.trim();
  if (/^\d{12}$/.test(digits)) return { tag: 'UPC', value: digits };
  if (/^\d{13}$/.test(digits)) return { tag: 'EAN', value: digits };
  return null;
}

/** Shopify gives single-variant products one option named "Title" with "Default Title". */
export function hasVariations(product: ShopifyListingProduct): boolean {
  if (product.variants.length > 1) return true;
  const only = product.variants[0];
  if (!only) return false;
  return only.options.some((option) => !(option.name === 'Title' && option.value === 'Default Title'));
}

function variationOptions(variant: ShopifyListingVariant): { name: string; value: string }[] {
  return variant.options.filter((option) => !(option.name === 'Title' && option.value === 'Default Title'));
}

function quantityFor(variant: ShopifyListingVariant, fallback: number | undefined): number | null {
  if (variant.quantity === null) return fallback ?? null;
  return Math.max(0, Math.floor(variant.quantity));
}

function specificXml(specific: EbayItemSpecific): string {
  const values = specific.values.map((value) => value.trim()).filter(Boolean);
  if (!specific.name.trim() || !values.length) return '';
  return `<NameValueList><Name>${xmlEscape(specific.name.trim())}</Name>${values.map((value) => `<Value>${xmlEscape(value)}</Value>`).join('')}</NameValueList>`;
}

/** Pick the option whose values each map to one Shopify image, preferring Color. */
function pictureOption(product: ShopifyListingProduct): { name: string; sets: Map<string, string> } | null {
  const names = [...new Set(product.variants.flatMap((variant) => variationOptions(variant).map((option) => option.name)))];
  names.sort((a, b) => Number(/colou?r/i.test(b)) - Number(/colou?r/i.test(a)));
  for (const name of names) {
    const sets = new Map<string, string>();
    let consistent = true;
    for (const variant of product.variants) {
      const value = variationOptions(variant).find((option) => option.name === name)?.value;
      if (!value || !variant.image) continue;
      const existing = sets.get(value);
      if (existing && existing !== variant.image) {
        consistent = false;
        break;
      }
      sets.set(value, variant.image);
    }
    if (consistent && sets.size > 1) return { name, sets };
  }
  return null;
}

export function mergeItemSpecifics(product: ShopifyListingProduct, chosen: EbayItemSpecific[] | undefined, variationNames: Set<string>): {
  specifics: EbayItemSpecific[];
  dropped: string[];
} {
  const byName = new Map<string, EbayItemSpecific>();
  for (const specific of chosen ?? []) {
    const values = specific.values.map((value) => value.trim()).filter(Boolean);
    if (specific.name.trim() && values.length) byName.set(specific.name.trim().toLowerCase(), { name: specific.name.trim(), values });
  }
  if (!byName.has('brand') && product.vendor.trim()) byName.set('brand', { name: 'Brand', values: [product.vendor.trim()] });
  const dropped: string[] = [];
  const specifics: EbayItemSpecific[] = [];
  for (const [key, specific] of byName) {
    if ([...variationNames].some((name) => name.toLowerCase() === key)) dropped.push(specific.name);
    else specifics.push(specific);
  }
  return { specifics: specifics.slice(0, 45), dropped };
}

export function buildEbayItem(
  product: ShopifyListingProduct,
  defaults: EbayListingDefaultsInput,
  choices: EbayListingChoices,
): BuiltEbayItem {
  const problems: string[] = [];
  const notes: string[] = [];

  if (product.currency !== 'USD') problems.push(`The Shopify store prices are in ${product.currency}. eBay US listings need USD.`);
  if (!/^\d+$/.test(choices.categoryId)) problems.push('categoryId must be a numeric eBay leaf category id');
  if (!Number.isInteger(choices.conditionId) || choices.conditionId <= 0) problems.push('conditionId must be an eBay condition id such as 1000 for New');
  if (!defaults.postalCode.trim() || !defaults.location.trim()) problems.push('Save the eBay item location (city, state, and ZIP) in LotLister before listing');
  if (!(EBAY_SHIPPING_SERVICES as readonly string[]).includes(defaults.shippingService)) problems.push(`Shipping service ${defaults.shippingService} is not one LotLister supports`);

  const { title, shortened } = ebayTitle(choices.title ?? product.title);
  if (!title) problems.push('The listing needs a title');
  if (shortened) notes.push(`The Shopify title is longer than ${EBAY_TITLE_MAX} characters, so it was shortened to "${title}". Pass title to choose a different one.`);

  const description = ebayDescription(choices.descriptionHtml ?? product.descriptionHtml) || xmlEscape(title);
  const pictures = [...new Set(product.images.filter((url) => /^https:\/\//i.test(url)))].slice(0, EBAY_PICTURE_MAX);
  if (!pictures.length) problems.push('eBay needs at least one https photo. Add an image to the Shopify product.');
  if (product.images.length > EBAY_PICTURE_MAX) notes.push(`Only the first ${EBAY_PICTURE_MAX} Shopify photos are used.`);

  const variations = hasVariations(product);
  const variationNames = new Set(variations ? product.variants.flatMap((variant) => variationOptions(variant).map((option) => option.name)) : []);
  const merged = mergeItemSpecifics(product, choices.itemSpecifics, variationNames);
  if (merged.dropped.length) notes.push(`These item specifics are variation names and were left out of the shared specifics: ${merged.dropped.join(', ')}`);

  const summaryVariations: EbayListingSummary['variations'] = [];
  let quantity = 0;
  let price: number | null = null;
  let offerXml = '';

  if (variations) {
    const skus = product.variants.map((variant) => variant.sku.trim()).filter(Boolean);
    const duplicate = skus.find((sku, index) => skus.indexOf(sku) !== index);
    if (duplicate) problems.push(`SKU ${duplicate} is on more than one Shopify variant. eBay needs each variation SKU to be unique.`);
    const rows: string[] = [];
    const seen = new Set<string>();
    for (const variant of product.variants) {
      const options = variationOptions(variant);
      const key = options.map((option) => `${option.name}=${option.value}`).join('|');
      if (seen.has(key)) problems.push(`Two Shopify variants have the same options (${key})`);
      seen.add(key);
      const count = quantityFor(variant, choices.quantity);
      if (count === null) {
        problems.push(`Shopify does not track stock for ${variant.title}. Pass quantity to set how many to list.`);
        continue;
      }
      if (!(variant.price > 0)) problems.push(`${variant.title} has no price in Shopify`);
      quantity += count;
      summaryVariations.push({
        sku: variant.sku,
        options: Object.fromEntries(options.map((option) => [option.name, option.value])),
        price: variant.price,
        quantity: count,
      });
      const identifier = productIdentifier(variant.barcode);
      rows.push([
        '<Variation>',
        variant.sku.trim() ? `<SKU>${xmlEscape(variant.sku.trim())}</SKU>` : '',
        `<StartPrice currencyID="USD">${money(variant.price)}</StartPrice>`,
        `<Quantity>${count}</Quantity>`,
        `<VariationSpecifics>${options.map((option) => specificXml({ name: option.name, values: [option.value] })).join('')}</VariationSpecifics>`,
        identifier ? `<VariationProductListingDetails><${identifier.tag}>${identifier.value}</${identifier.tag}></VariationProductListingDetails>` : '',
        '</Variation>',
      ].join(''));
    }
    if (summaryVariations.length && quantity === 0) problems.push('Every Shopify variant is out of stock');

    const set = [...variationNames].map((name) => ({
      name,
      values: [...new Set(product.variants.flatMap((variant) => variationOptions(variant).filter((option) => option.name === name).map((option) => option.value)))],
    }));
    const picture = pictureOption(product);
    const picturesXml = picture
      ? `<Pictures><VariationSpecificName>${xmlEscape(picture.name)}</VariationSpecificName>${[...picture.sets].map(([value, url]) => (
        `<VariationSpecificPictureSet><VariationSpecificValue>${xmlEscape(value)}</VariationSpecificValue><PictureURL>${xmlEscape(url)}</PictureURL></VariationSpecificPictureSet>`
      )).join('')}</Pictures>`
      : '';
    offerXml = `<Variations>${picturesXml}${rows.join('')}<VariationSpecificsSet>${set.map(specificXml).join('')}</VariationSpecificsSet></Variations>`;
  } else {
    const variant = product.variants[0];
    if (!variant) {
      problems.push('The Shopify product has no variants');
    } else {
      const count = quantityFor(variant, choices.quantity);
      if (count === null) problems.push('Shopify does not track stock for this product. Pass quantity to set how many to list.');
      else if (count === 0) problems.push('This product is out of stock in Shopify');
      if (!(variant.price > 0)) problems.push('This product has no price in Shopify');
      price = variant.price;
      quantity = count ?? 0;
      const identifier = productIdentifier(variant.barcode);
      offerXml = [
        variant.sku.trim() ? `<SKU>${xmlEscape(variant.sku.trim())}</SKU>` : '',
        `<StartPrice currencyID="USD">${money(variant.price)}</StartPrice>`,
        `<Quantity>${quantity}</Quantity>`,
        identifier ? `<ProductListingDetails><${identifier.tag}>${identifier.value}</${identifier.tag}></ProductListingDetails>` : '',
      ].join('');
    }
  }

  const free = defaults.freeShipping;
  const shippingCost = free ? '0.00' : money(defaults.shippingCost);
  const additional = !free && defaults.additionalItemCost > 0
    ? `<ShippingServiceAdditionalCost currencyID="USD">${money(defaults.additionalItemCost)}</ShippingServiceAdditionalCost>`
    : '';
  const returnPolicy = defaults.returnsAccepted
    ? `<ReturnPolicy><ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption><RefundOption>MoneyBack</RefundOption><ReturnsWithinOption>Days_${defaults.returnDays}</ReturnsWithinOption><ShippingCostPaidByOption>${defaults.returnShippingPaidBy === 'Seller' ? 'Seller' : 'Buyer'}</ShippingCostPaidByOption></ReturnPolicy>`
    : '<ReturnPolicy><ReturnsAcceptedOption>ReturnsNotAccepted</ReturnsAcceptedOption></ReturnPolicy>';

  const itemXml = [
    `<Title>${xmlEscape(title)}</Title>`,
    `<Description><![CDATA[${description}]]></Description>`,
    `<PrimaryCategory><CategoryID>${xmlEscape(choices.categoryId)}</CategoryID></PrimaryCategory>`,
    '<Site>US</Site><Country>US</Country><Currency>USD</Currency>',
    `<ConditionID>${choices.conditionId}</ConditionID>`,
    merged.specifics.length ? `<ItemSpecifics>${merged.specifics.map(specificXml).join('')}</ItemSpecifics>` : '',
    `<PictureDetails>${pictures.map((url) => `<PictureURL>${xmlEscape(url)}</PictureURL>`).join('')}</PictureDetails>`,
    '<ListingType>FixedPriceItem</ListingType><ListingDuration>GTC</ListingDuration>',
    offerXml,
    defaults.bestOfferEnabled ? '<BestOfferDetails><BestOfferEnabled>true</BestOfferEnabled></BestOfferDetails>' : '',
    `<Location>${xmlEscape(defaults.location.trim())}</Location>`,
    `<PostalCode>${xmlEscape(defaults.postalCode.trim())}</PostalCode>`,
    `<DispatchTimeMax>${defaults.handlingDays}</DispatchTimeMax>`,
    `<ShippingDetails><ShippingType>Flat</ShippingType><ShippingServiceOptions><ShippingServicePriority>1</ShippingServicePriority><ShippingService>${xmlEscape(defaults.shippingService)}</ShippingService><ShippingServiceCost currencyID="USD">${shippingCost}</ShippingServiceCost>${free ? '<FreeShipping>true</FreeShipping>' : ''}${additional}</ShippingServiceOptions></ShippingDetails>`,
    returnPolicy,
  ].filter(Boolean).join('');

  return {
    itemXml,
    problems,
    notes,
    summary: {
      shopifyProductId: product.id,
      title,
      titleShortened: shortened,
      categoryId: choices.categoryId,
      conditionId: choices.conditionId,
      currency: 'USD',
      price,
      quantity,
      variations: summaryVariations,
      pictures,
      itemSpecifics: merged.specifics,
      shipping: free
        ? `${defaults.shippingService}, free, ships within ${defaults.handlingDays} business day(s)`
        : `${defaults.shippingService}, $${shippingCost}, ships within ${defaults.handlingDays} business day(s)`,
      returns: defaults.returnsAccepted
        ? `${defaults.returnDays}-day returns, ${defaults.returnShippingPaidBy === 'Seller' ? 'seller' : 'buyer'} pays return shipping`
        : 'No returns',
      bestOffer: defaults.bestOfferEnabled,
    },
  };
}

export function verifyRequestXml(itemXml: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<VerifyAddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <Item>${itemXml}</Item>
</VerifyAddFixedPriceItemRequest>`;
}

/** eBay ignores a repeat AddFixedPriceItem with the same 32-character hex UUID and returns the first item id. */
export function addRequestXml(itemXml: string, uuid: string): string {
  if (!/^[0-9A-F]{32}$/.test(uuid)) throw new Error('UUID must be 32 uppercase hex characters');
  return `<?xml version="1.0" encoding="utf-8"?>
<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <Item>${itemXml}<UUID>${uuid}</UUID></Item>
</AddFixedPriceItemRequest>`;
}

function decode(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function tag(xml: string, name: string): string {
  return decode(xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? '');
}

export interface TradingOutcome {
  ok: boolean;
  itemId: string | null;
  duplicateItemId: string | null;
  errors: string[];
  warnings: string[];
  fees: { name: string; amount: number; currency: string }[];
}

export function parseTradingListingResponse(xml: string): TradingOutcome {
  const ack = tag(xml, 'Ack');
  const errors: string[] = [];
  const warnings: string[] = [];
  let duplicateItemId: string | null = null;
  for (const block of xml.matchAll(/<Errors>([\s\S]*?)<\/Errors>/g)) {
    const body = block[1];
    const code = tag(body, 'ErrorCode');
    const message = (tag(body, 'LongMessage') || tag(body, 'ShortMessage') || 'eBay sent no message').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const line = code ? `eBay ${code}: ${message}` : message;
    if (tag(body, 'SeverityCode') === 'Warning') warnings.push(line);
    else errors.push(line);
    if (code === '488') {
      const values = [...body.matchAll(/<Value>(\d{9,})<\/Value>/g)].map((match) => match[1]);
      duplicateItemId = values[0] ?? message.match(/\b(\d{9,})\b/)?.[1] ?? null;
    }
  }
  const fees: TradingOutcome['fees'] = [];
  for (const block of xml.matchAll(/<Fee>\s*<Name>([^<]+)<\/Name>\s*<Fee currencyID="([A-Z]{3})">([\d.]+)<\/Fee>/g)) {
    const amount = Number(block[3]);
    if (amount > 0) fees.push({ name: block[1], amount, currency: block[2] });
  }
  const itemId = tag(xml, 'ItemID') || null;
  return {
    ok: (ack === 'Success' || ack === 'Warning') && errors.length === 0,
    itemId,
    duplicateItemId,
    errors: errors.length || ack === 'Success' || ack === 'Warning' ? errors : [`eBay did not accept the listing (Ack: ${ack || 'none'})`],
    warnings,
    fees,
  };
}

export interface ListedItemReadback {
  itemId: string;
  title: string;
  status: string;
  sellerUserId: string;
  price: number | null;
  quantity: number | null;
  variationSkus: string[];
  url: string;
}

export function parseGetItem(xml: string): ListedItemReadback | null {
  const item = xml.match(/<Item>([\s\S]*)<\/Item>/)?.[1];
  if (!item) return null;
  const variations = item.match(/<Variations>([\s\S]*?)<\/Variations>/)?.[1] ?? '';
  const skus = [...variations.matchAll(/<Variation>([\s\S]*?)<\/Variation>/g)].map((match) => tag(match[1], 'SKU'));
  const priceText = item.match(/<StartPrice currencyID="[A-Z]{3}">([\d.]+)<\/StartPrice>/)?.[1];
  const outside = item.replace(/<Variations>[\s\S]*?<\/Variations>/, '');
  const quantityText = outside.match(/<Quantity>(\d+)<\/Quantity>/)?.[1];
  const itemId = tag(item, 'ItemID');
  return {
    itemId,
    title: tag(item, 'Title'),
    status: tag(item, 'ListingStatus'),
    sellerUserId: tag(item.match(/<Seller>([\s\S]*?)<\/Seller>/)?.[1] ?? '', 'UserID'),
    price: priceText ? Number(priceText) : null,
    quantity: quantityText ? Number(quantityText) : null,
    variationSkus: skus,
    url: tag(item, 'ViewItemURL') || `https://www.ebay.com/itm/${itemId}`,
  };
}

export function compareReadback(summary: EbayListingSummary, readback: ListedItemReadback, expectedSeller: string | null): string[] {
  const mismatches: string[] = [];
  if (readback.title !== summary.title) mismatches.push(`title is "${readback.title}"`);
  if (readback.status && readback.status !== 'Active') mismatches.push(`listing status is ${readback.status}`);
  if (expectedSeller && readback.sellerUserId && readback.sellerUserId.toLowerCase() !== expectedSeller.toLowerCase()) {
    mismatches.push(`seller is ${readback.sellerUserId}, not ${expectedSeller}`);
  }
  if (summary.variations.length) {
    const expected = summary.variations.map((variation) => variation.sku).filter(Boolean).sort();
    const actual = readback.variationSkus.filter(Boolean).sort();
    if (expected.join('|') !== actual.join('|')) mismatches.push(`variation SKUs are ${actual.join(', ') || 'missing'}`);
  } else if (summary.price !== null && readback.price !== null && readback.price.toFixed(2) !== summary.price.toFixed(2)) {
    mismatches.push(`price is ${readback.price.toFixed(2)}`);
  }
  return mismatches;
}
