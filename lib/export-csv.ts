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
// Based on official eBay template downloaded from their template tool
const EBAY_FILE_EXCHANGE_HEADERS = [
  '*Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)',
  'CustomLabel',
  '*Category',
  'StoreCategory',
  '*Title',
  'Subtitle',
  'Relationship',
  'RelationshipDetails',
  'ScheduleTime',
  '*ConditionID',
  'CD:Professional Grader - (ID: 27501)',
  'CD:Grade - (ID: 27502)',
  'CDA:Certification Number - (ID: 27503)',
  'CD:Card Condition - (ID: 40001)',
  '*C:Sport',
  'C:Player/Athlete',
  'C:Season',
  'C:Year Manufactured',
  'C:Manufacturer',
  'C:Parallel/Variety',
  'C:Features',
  'C:Set',
  'C:Team',
  'C:League',
  'C:Autographed',
  'C:Card Name',
  'C:Card Number',
  'C:Type',
  'C:Graded',
  'PicURL',
  'GalleryType',
  'VideoID',
  '*Description',
  '*Format',
  '*Duration',
  '*StartPrice',
  'BuyItNowPrice',
  'BestOfferEnabled',
  'BestOfferAutoAcceptPrice',
  'MinimumBestOfferPrice',
  '*Quantity',
  'ImmediatePayRequired',
  '*Location',
  'ShippingType',
  'ShippingService-1:Option',
  'ShippingService-1:Cost',
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
];

// eBay condition IDs for trading cards
export const EBAY_CONDITION_IDS = {
  GRADED: '2750',
  UNGRADED: '4000',
};

// eBay shipping service codes - map human-readable names to API codes
const EBAY_SHIPPING_SERVICES: Record<string, string> = {
  'USPS Ground Advantage': 'USPSParcel',
  'USPS First Class': 'USPSFirstClass',
  'USPS Priority Mail': 'USPSPriority',
  'USPS Priority Mail Express': 'USPSPriorityExpress',
  'USPSParcel': 'USPSParcel',
  'USPSFirstClass': 'USPSFirstClass',
  'USPSPriority': 'USPSPriority',
  'USPSPriorityExpress': 'USPSPriorityExpress',
  'UPS Ground': 'UPSGround',
  'UPS 3 Day Select': 'UPS3rdDay',
  'UPS 2nd Day Air': 'UPS2ndDay',
  'UPS Next Day Air': 'UPSNextDay',
  'FedEx Ground': 'FedExHomeDelivery',
  'FedEx 2Day': 'FedEx2Day',
  'FedEx Express Saver': 'FedExExpressSaver',
};

// eBay card condition descriptor codes (for descriptor ID 40001)
// Maps our display values to eBay's numeric codes
const EBAY_CARD_CONDITION_CODES: Record<string, string> = {
  'Near mint or better: Comparable to a fresh pack': '400010',
  'Near Mint or Better': '400010',
  'Excellent: Has clearly visible signs of wear': '400020',
  'Excellent': '400020',
  'Very good: Has moderate-to-heavy damage all over': '400030',
  'Very Good': '400030',
  'Poor: Is extremely worn and displays flaws all over': '400040',
  'Poor': '400040',
};

// eBay format types
export const EBAY_FORMATS = {
  Auction: 'Auction',
  BuyItNow: 'FixedPrice',
};

/**
 * Calculate schedule times with staggering
 * User enters local time, we convert to UTC for eBay
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
    // Parse date and time as local time
    const dateStr = profile.scheduleDate;
    const timeStr = profile.scheduleTime;
    
    // Create a Date object from the local time string
    // This interprets the time as the user's local timezone
    const localDateTime = new Date(`${dateStr}T${timeStr}:00`);
    
    // Add stagger offset if enabled
    const offsetSeconds = profile.staggerEnabled
      ? index * profile.staggerIntervalSeconds
      : 0;
    
    const scheduledTime = addSeconds(localDateTime, offsetSeconds);
    
    // Format for eBay in ISO format (eBay expects UTC)
    // toISOString() converts to UTC and formats as ISO
    // Remove the .000Z suffix and keep just YYYY-MM-DDTHH:MM:SS
    return scheduledTime.toISOString().slice(0, 19);
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
    
    // Card condition descriptor (only for ungraded) - use eBay's numeric code
    const rawCondition = card.condition || '';
    const cardCondition = isGraded ? '' : (EBAY_CARD_CONDITION_CODES[rawCondition] || '400010');
    
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
    
    // Build row matching the official eBay template header order exactly
    const row = [
      'Add',                                    // *Action
      customLabel,                              // CustomLabel
      profile.ebayCategory,                     // *Category
      profile.storeCategory || '',              // StoreCategory
      title.slice(0, 80),                       // *Title (max 80 chars)
      '',                                       // Subtitle
      '',                                       // Relationship
      '',                                       // RelationshipDetails
      scheduleTime,                             // ScheduleTime
      conditionId,                              // *ConditionID
      grader,                                   // CD:Professional Grader - (ID: 27501)
      grade,                                    // CD:Grade - (ID: 27502)
      certNo,                                   // CDA:Certification Number - (ID: 27503)
      cardCondition,                            // CD:Card Condition - (ID: 40001)
      sport,                                    // *C:Sport
      card.name || '',                          // C:Player/Athlete
      card.year || '',                          // C:Season
      card.year || '',                          // C:Year Manufactured
      card.brand || '',                         // C:Manufacturer
      card.subsetParallel || '',                // C:Parallel/Variety
      card.subsetParallel || '',                // C:Features
      card.setName || '',                       // C:Set
      card.team || '',                          // C:Team
      '',                                       // C:League
      'No',                                     // C:Autographed
      card.name || '',                          // C:Card Name
      card.cardNumber || '',                    // C:Card Number
      'Sports Trading Card',                    // C:Type
      isGraded ? 'Yes' : 'No',                  // C:Graded
      imageUrls,                                // PicURL
      '',                                       // GalleryType
      '',                                       // VideoID
      description,                              // *Description
      ebayFormat,                               // *Format
      profile.durationDays,                     // *Duration
      startPrice,                               // *StartPrice
      buyItNowPrice,                            // BuyItNowPrice
      '',                                       // BestOfferEnabled
      '',                                       // BestOfferAutoAcceptPrice
      '',                                       // MinimumBestOfferPrice
      '1',                                      // *Quantity
      profile.immediatePayment ? '1' : '0',     // ImmediatePayRequired
      location,                                 // *Location
      shippingType,                             // ShippingType
      EBAY_SHIPPING_SERVICES[profile.shippingService] || 'USPSParcel', // ShippingService-1:Option
      shippingCost,                             // ShippingService-1:Cost
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
    ];
    
    rows.push(toCSVRow(row));
  }
  
  return rows.join('\r\n');
}
