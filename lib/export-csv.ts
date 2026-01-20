/**
 * CSV Export utilities for Raw CSV and eBay File Exchange format
 */

import { CardItem, CardImage, ExportProfile } from '@prisma/client';
import { format, addSeconds, parseISO } from 'date-fns';

type CardItemWithImages = CardItem & { images: CardImage[] };

/**
 * Generate title from card fields if not already set
 */
export function generateTitle(card: CardItem): string {
  if (card.title && card.title.trim()) {
    return card.title.trim();
  }
  
  const parts: string[] = [];
  
  if (card.year) parts.push(String(card.year));
  if (card.brand) parts.push(card.brand);
  if (card.setName) parts.push(card.setName);
  if (card.cardNumber) parts.push(`#${card.cardNumber}`);
  if (card.name) parts.push(card.name);
  if (card.subsetParallel) parts.push(card.subsetParallel);
  
  // Clean up: remove double spaces and trim
  return parts.join(' ').replace(/\s+/g, ' ').trim() || 'Untitled Card';
}

/**
 * Escape CSV value (handle commas, quotes, newlines)
 */
function escapeCSV(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert array to CSV row
 */
function toCSVRow(values: (string | number | boolean | null | undefined)[]): string {
  return values.map(escapeCSV).join(',');
}

// ============================================================================
// RAW CSV EXPORT
// ============================================================================

const RAW_CSV_HEADERS = [
  'Images',
  'Title',
  'Status',
  'Listings',
  'Sale Price',
  'Category',
  'Year',
  'Brand',
  'Set',
  'Name',
  'Card #',
  'Subset/Parallel',
  'Attributes',
  'Team',
  'Variation',
  'Graded',
  'Grader',
  'Condition',
  'Cert No.',
];

export function generateRawCSV(cards: CardItemWithImages[]): string {
  const rows: string[] = [];
  
  // Header row
  rows.push(toCSVRow(RAW_CSV_HEADERS));
  
  // Data rows
  for (const card of cards) {
    const imagePaths = card.images
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((img) => img.originalPath)
      .join(';');
    
    rows.push(
      toCSVRow([
        imagePaths,
        generateTitle(card),
        card.status,
        card.listings,
        card.salePrice,
        card.category,
        card.year,
        card.brand,
        card.setName,
        card.name,
        card.cardNumber,
        card.subsetParallel,
        card.attributes,
        card.team,
        card.variation,
        card.graded ? 'Yes' : 'No',
        card.grader,
        card.condition,
        card.certNo,
      ])
    );
  }
  
  return rows.join('\r\n');
}

// ============================================================================
// EBAY FILE EXCHANGE CSV EXPORT
// ============================================================================

// eBay File Exchange headers for trading cards (category 261328)
// Based on eBay's File Exchange template for Sports Trading Card Singles
const EBAY_FILE_EXCHANGE_HEADERS = [
  '*Action(SiteID=US|Country=US|Currency=USD|Version=1193)',
  '*Category',
  'StoreCategory',
  '*Title',
  '*ConditionID',
  'C:Card Condition',
  'C:Professional Grader',
  'C:Certification Number',
  'C:Grade',
  'PicURL',
  '*Description',
  '*Format',
  '*Duration',
  '*StartPrice',
  'BuyItNowPrice',
  '*Quantity',
  'PayPalAccepted',
  'PayPalEmailAddress',
  'ImmediatePayRequired',
  '*Location',
  'PostalCode',
  'ShippingType',
  'ShippingService-1:Option',
  'ShippingService-1:Cost',
  'ShippingService-1:AdditionalCost',
  '*DispatchTimeMax',
  'ReturnsAcceptedOption',
  'ReturnsWithinOption',
  'RefundOption',
  'ShippingCostPaidByOption',
  'ScheduleTime',
  'CustomLabel',
];

// eBay condition IDs for trading cards
export const EBAY_CONDITION_IDS = {
  GRADED: '2750',
  UNGRADED: '4000',
};

// eBay format types
export const EBAY_FORMATS = {
  Auction: 'Auction',
  BuyItNow: 'FixedPrice',
};

/**
 * Calculate schedule times with staggering
 */
function calculateScheduleTime(
  profile: ExportProfile,
  index: number
): string {
  if (profile.scheduleMode === 'Immediate') {
    return '';
  }
  
  if (!profile.scheduleDate || !profile.scheduleTime) {
    return '';
  }
  
  try {
    // Parse date and time
    const dateStr = profile.scheduleDate;
    const timeStr = profile.scheduleTime;
    const baseDateTime = parseISO(`${dateStr}T${timeStr}:00`);
    
    // Add stagger offset if enabled
    const offsetSeconds = profile.staggerEnabled
      ? index * profile.staggerIntervalSeconds
      : 0;
    
    const scheduledTime = addSeconds(baseDateTime, offsetSeconds);
    
    // Format for eBay: YYYY-MM-DD HH:MM:SS (in GMT/UTC)
    return format(scheduledTime, 'yyyy-MM-dd HH:mm:ss');
  } catch (error) {
    console.error('Error calculating schedule time:', error);
    return '';
  }
}

/**
 * Generate eBay File Exchange CSV
 * 
 * IMPORTANT: eBay requires images to be hosted at publicly accessible URLs.
 * The PicURL field must contain actual HTTP/HTTPS URLs, not local file paths.
 * Users should either:
 * 1. Host images externally and update paths before export
 * 2. Use eBay's picture upload service separately
 * 3. Configure a base URL for hosted images
 */
export function generateEbayCSV(
  cards: CardItemWithImages[],
  profile: ExportProfile,
  imageBaseUrl?: string // Optional base URL for images (e.g., "https://yoursite.com")
): string {
  const rows: string[] = [];
  
  // eBay File Exchange format: header row followed by data rows
  // The first column header *Action contains the site/version info
  rows.push(toCSVRow(EBAY_FILE_EXCHANGE_HEADERS));
  
  // Data rows
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const title = generateTitle(card);
    
    // Check if graded based on conditionType field
    const isGraded = (card as Record<string, unknown>).conditionType === 'Graded: Professionally graded';
    
    // Determine condition ID based on graded status
    const conditionId = isGraded
      ? EBAY_CONDITION_IDS.GRADED
      : EBAY_CONDITION_IDS.UNGRADED;
    
    // Card condition descriptor (only for ungraded)
    const cardCondition = isGraded ? '' : (card.condition || '');
    
    // Grader info (only for graded)
    const grader = isGraded ? (card.grader || '') : '';
    const certNo = isGraded ? (card.certNo || '') : '';
    const grade = isGraded ? ((card as Record<string, unknown>).grade as string || '') : '';
    
    // Image URLs - if base URL provided, convert local paths to full URLs
    // eBay uses pipe (|) separator for multiple images
    const imageUrls = card.images
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((img) => {
        if (imageBaseUrl) {
          // Convert local path to full URL
          return `${imageBaseUrl}/api/images/${encodeURIComponent(img.originalPath)}`;
        }
        // Return local path (will need to be updated before eBay upload)
        return img.originalPath;
      })
      .join('|');
    
    // Description
    const description = `<p>${title}</p>`;
    
    // Format and pricing
    const ebayFormat = EBAY_FORMATS[profile.listingType as keyof typeof EBAY_FORMATS] || 'Auction';
    const startPrice = profile.listingType === 'Auction'
      ? (card.salePrice || profile.startPriceDefault)
      : '';
    const buyItNowPrice = profile.listingType === 'BuyItNow'
      ? (card.salePrice || profile.buyItNowPrice || profile.startPriceDefault)
      : '';
    
    // Location
    const location = [
      profile.itemLocationCity,
      profile.itemLocationState,
    ].filter(Boolean).join(', ') || 'United States';
    
    // Shipping
    const shippingType = profile.freeShipping ? 'Free' : 'Flat';
    const shippingCost = profile.freeShipping ? '0' : profile.shippingCost;
    
    // Returns
    const returnsOption = profile.returnsAccepted
      ? 'ReturnsAccepted'
      : 'ReturnsNotAccepted';
    const returnWindow = `Days_${profile.returnWindowDays}`;
    
    // Schedule time with staggering
    const scheduleTime = calculateScheduleTime(profile, i);
    
    // Custom label (can be used for internal tracking)
    const customLabel = `${card.lotId.slice(0, 8)}-${String(i + 1).padStart(3, '0')}`;
    
    const row = [
      'Add',                                    // *Action
      profile.ebayCategory,                     // *Category
      profile.storeCategory,                    // StoreCategory
      title.slice(0, 80),                       // *Title (max 80 chars)
      conditionId,                              // *ConditionID
      cardCondition,                            // C:Card Condition
      grader,                                   // C:Professional Grader
      certNo,                                   // C:Certification Number
      grade,                                    // C:Grade
      imageUrls,                                // PicURL
      description,                              // *Description
      ebayFormat,                               // *Format
      profile.durationDays,                     // *Duration
      startPrice,                               // *StartPrice
      buyItNowPrice,                            // BuyItNowPrice
      '1',                                      // *Quantity
      '1',                                      // PayPalAccepted
      '',                                       // PayPalEmailAddress
      profile.immediatePayment ? '1' : '0',     // ImmediatePayRequired
      location,                                 // *Location
      profile.itemLocationZip || '',            // PostalCode
      shippingType,                             // ShippingType
      profile.shippingService,                  // ShippingService-1:Option
      shippingCost,                             // ShippingService-1:Cost
      profile.eachAdditionalItemCost,           // ShippingService-1:AdditionalCost
      profile.handlingTimeDays,                 // *DispatchTimeMax
      returnsOption,                            // ReturnsAcceptedOption
      returnWindow,                             // ReturnsWithinOption
      profile.refundMethod === 'Money Back' ? 'MoneyBack' : 'MoneyBackOrExchange', // RefundOption
      profile.shippingCostPaidBy,               // ShippingCostPaidByOption
      scheduleTime,                             // ScheduleTime
      customLabel,                              // CustomLabel
    ];
    
    rows.push(toCSVRow(row));
  }
  
  return rows.join('\r\n');
}
