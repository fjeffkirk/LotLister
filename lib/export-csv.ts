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

// eBay File Exchange Info row (required first row)
const EBAY_INFO_ROW = 'Info,Version=1.0.0,Template=fx_category_template_EBAY_US';

// eBay File Exchange headers for trading cards (category 261328)
// Based on working Carddealerpro export format
const EBAY_FILE_EXCHANGE_HEADERS = [
  '*Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)',
  'CustomLabel',
  '*Category',
  'StoreCategory',
  '*Title',
  'Subtitle',
  'Relationship',
  '*ConditionID',
  '*C:Graded',
  '*C:Sport',
  '*C:Player/Athlete',
  '*C:Parallel/Variety',
  '*C:Manufacturer',
  'C:Season',
  '*C:Features',
  '*C:Set',
  'CD:Grade - (ID: 27502)',
  '*C:League',
  'CD:Professional Grader - (ID: 27501)',
  '*C:Team',
  '*C:Autographed',
  'CD:Card Condition - (ID: 40001)',
  '*C:Card Name',
  '*C:Card Number',
  'CDA:Certification Number - (ID: 27503)',
  '*C:Type',
  'C:Year Manufactured',
  'PicURL',
  'GalleryType',
  '*Description',
  '*Format',
  '*Duration',
  '*StartPrice',
  'BuyItNowPrice',
  '*Quantity',
  'PayPalAccepted',
  'PayPalEmailAddress',
  'ImmediatePayRequired',
  'PaymentInstructions',
  '*Location',
  'PostalCode',
  'ShippingType',
  'ShippingService-1:Option',
  'ShippingService-1:FreeShipping',
  'ShippingService-1:Cost',
  'ShippingService-1:AdditionalCost',
  'ShippingService-2:Option',
  'ShippingService-2:Cost',
  '*DispatchTimeMax',
  'PromotionalShippingDiscount',
  'ShippingDiscountProfileID',
  '*ReturnsAcceptedOption',
  'ReturnsWithinOption',
  'RefundOption',
  'ShippingCostPaidByOption',
  'AdditionalDetails',
  'ShippingProfileName',
  'ReturnProfileName',
  'PaymentProfileName',
  'ScheduleTime',
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
  
  // eBay File Exchange format requires:
  // 1. Info row first
  // 2. Header row
  // 3. Data rows
  rows.push(EBAY_INFO_ROW);
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
    
    // Card condition descriptor (only for ungraded) - use eBay's expected value format
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
    
    // Sport - always Baseball for this app (required field)
    const sport = card.category || 'Baseball';
    
    // FreeShipping flag (0 = not free, 1 = free)
    const freeShippingFlag = profile.freeShipping ? '1' : '0';
    
    // Features - use the parallel/subset as a feature
    const features = card.subsetParallel || '';
    
    // Build row matching the header order exactly (from working Carddealerpro export)
    const row = [
      'Add',                                    // *Action
      customLabel,                              // CustomLabel
      profile.ebayCategory,                     // *Category
      profile.storeCategory || '0',             // StoreCategory (0 = none)
      title.slice(0, 80),                       // *Title (max 80 chars)
      '',                                       // Subtitle
      '',                                       // Relationship
      conditionId,                              // *ConditionID
      isGraded ? 'Yes' : 'No',                  // *C:Graded
      sport,                                    // *C:Sport
      card.name || '',                          // *C:Player/Athlete
      card.subsetParallel || '',                // *C:Parallel/Variety
      card.brand || '',                         // *C:Manufacturer
      card.year || '',                          // C:Season
      features,                                 // *C:Features
      card.setName || '',                       // *C:Set
      grade,                                    // CD:Grade - (ID: 27502)
      'MLB',                                    // *C:League (default to MLB for baseball)
      grader,                                   // CD:Professional Grader - (ID: 27501)
      card.team || '',                          // *C:Team
      'No',                                     // *C:Autographed (default No)
      cardCondition,                            // CD:Card Condition - (ID: 40001)
      card.name || '',                          // *C:Card Name
      card.cardNumber || '',                    // *C:Card Number
      certNo,                                   // CDA:Certification Number - (ID: 27503)
      'Sports Trading Card',                    // *C:Type
      card.year || '',                          // C:Year Manufactured
      imageUrls,                                // PicURL
      '',                                       // GalleryType
      description,                              // *Description
      ebayFormat,                               // *Format
      profile.durationDays,                     // *Duration
      startPrice,                               // *StartPrice
      buyItNowPrice,                            // BuyItNowPrice
      '1',                                      // *Quantity
      '',                                       // PayPalAccepted (deprecated, leave empty)
      '',                                       // PayPalEmailAddress
      profile.immediatePayment ? '1' : '0',     // ImmediatePayRequired
      '',                                       // PaymentInstructions
      location,                                 // *Location
      profile.itemLocationZip || '',            // PostalCode
      shippingType,                             // ShippingType
      profile.shippingService,                  // ShippingService-1:Option
      freeShippingFlag,                         // ShippingService-1:FreeShipping
      shippingCost,                             // ShippingService-1:Cost
      profile.eachAdditionalItemCost || '',     // ShippingService-1:AdditionalCost
      '',                                       // ShippingService-2:Option
      '',                                       // ShippingService-2:Cost
      profile.handlingTimeDays,                 // *DispatchTimeMax
      '',                                       // PromotionalShippingDiscount
      '',                                       // ShippingDiscountProfileID
      returnsOption,                            // *ReturnsAcceptedOption
      returnWindow,                             // ReturnsWithinOption
      profile.refundMethod === 'Money Back' ? 'MoneyBack' : 'MoneyBackOrReplacement', // RefundOption
      profile.shippingCostPaidBy,               // ShippingCostPaidByOption
      '',                                       // AdditionalDetails
      '',                                       // ShippingProfileName
      '',                                       // ReturnProfileName
      '',                                       // PaymentProfileName
      scheduleTime,                             // ScheduleTime
    ];
    
    rows.push(toCSVRow(row));
  }
  
  return rows.join('\r\n');
}
