import { describe, expect, it } from 'vitest';
import type { CardItem, CardImage, ExportProfile } from '@prisma/client';
import { cardListingType, parseFieldValue } from '../lib/card-fields';
import { generateEbayCSV } from '../lib/export-csv';

const profile = {
  templateName: 'Test',
  ebayCategory: '261328',
  storeCategory: '0',
  listingType: 'Auction',
  startPriceDefault: 4.99,
  buyItNowPrice: null,
  durationDays: 7,
  scheduleMode: 'Immediate',
  scheduleDate: null,
  scheduleTime: null,
  staggerEnabled: false,
  staggerIntervalSeconds: 0,
  shippingService: 'USPS Ground Advantage',
  handlingTimeDays: 3,
  freeShipping: false,
  shippingCost: 3.99,
  eachAdditionalItemCost: 1.49,
  immediatePayment: false,
  bestOfferEnabled: true,
  bestOfferAutoAcceptPrice: 20,
  bestOfferMinimumPrice: 10,
  itemLocationCity: 'Austin',
  itemLocationState: 'TX',
  itemLocationZip: '78701',
  returnsAccepted: true,
  returnWindowDays: 14,
  refundMethod: 'Money Back',
  shippingCostPaidBy: 'Seller',
  salesTaxEnabled: false,
} as ExportProfile;

function card(overrides: Partial<CardItem>): CardItem & { images: CardImage[] } {
  return {
    id: 'card-1',
    lotId: 'lot-abcdefgh',
    title: '2023 Topps #1 Player',
    status: 'Draft',
    listings: null,
    salePrice: 12.5,
    listingType: null,
    category: 'Baseball',
    year: 2023,
    brand: 'Topps',
    setName: 'Topps',
    name: 'Player',
    cardNumber: '1',
    subsetParallel: 'Base',
    attributes: null,
    team: null,
    variation: null,
    graded: false,
    grader: null,
    grade: null,
    conditionType: 'Ungraded: Not in original packaging or professionally graded',
    condition: 'Near Mint or Better',
    certNo: null,
    description: null,
    psaImport: false,
    ebayItemId: null,
    ebayListedAt: null,
    etsyListingId: null,
    etsyListedAt: null,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    images: [],
    ...overrides,
  } as CardItem & { images: CardImage[] };
}

describe('per-card listing format', () => {
  it('follows the lot default until the card is switched', () => {
    expect(cardListingType(card({ listingType: null }), profile)).toBe('Auction');
    expect(cardListingType(card({ listingType: null }), { listingType: 'BuyItNow' })).toBe('BuyItNow');
    expect(cardListingType(card({ listingType: 'BuyItNow' }), profile)).toBe('BuyItNow');
    expect(cardListingType(card({ listingType: 'Auction' }), { listingType: 'BuyItNow' })).toBe('Auction');
  });

  it('reads pasted and typed values', () => {
    expect(parseFieldValue('listingType', 'buy it now')).toBe('BuyItNow');
    expect(parseFieldValue('listingType', 'BuyItNow')).toBe('BuyItNow');
    expect(parseFieldValue('listingType', 'auction')).toBe('Auction');
    expect(parseFieldValue('listingType', '')).toBeNull();
  });

  it('exports each card with its own format, duration, and price', () => {
    const csv = generateEbayCSV(
      [card({ id: 'a', listingType: 'BuyItNow' }), card({ id: 'b', listingType: 'Auction', salePrice: null })],
      profile,
      'https://example.com'
    );
    const [buyItNow, auction] = csv.split('\r\n').slice(2);

    expect(buyItNow).toContain('FixedPrice,GTC,12.5,,');
    // Auction rows fall back to the profile's start bid and carry the numeric duration
    expect(auction).toContain('Auction,7,4.99,,');
  });

  it('keeps Best Offer off auction rows, which eBay rejects', () => {
    const csv = generateEbayCSV(
      [card({ id: 'a', listingType: 'BuyItNow' }), card({ id: 'b', listingType: 'Auction' })],
      profile,
      'https://example.com'
    );
    const [buyItNow, auction] = csv.split('\r\n').slice(2);

    expect(buyItNow).toContain(',1,20,10,');
    expect(auction).toContain(',0,,,');
  });
});
