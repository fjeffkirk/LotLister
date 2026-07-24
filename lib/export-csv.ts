/**
 * CSV Export utilities for Raw CSV and eBay File Exchange format
 */

import { CardItem, CardImage, ExportProfile } from '@prisma/client';
import { format, addSeconds, parseISO } from 'date-fns';
import { imagePathToEbayPicUrl } from './imageUrls';
import { isSportsCategory, isTcgCategory, getCategoryEbayId } from './types';

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
  'PostalCode',
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
  'USPS Ground Advantage': 'USPSParcel', // eBay uses USPSParcel as the token for Ground Advantage (ShipScript confirmed)
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

// eBay card condition descriptor codes (for descriptor ID 40001) — ungraded cards only
// Values must use the full eBay format: "<label> - (ID: <numeric_id>)"
// Source: eBay staff post on community.ebay.com (confirmed working by ShipScript)
const EBAY_CARD_CONDITION_CODES: Record<string, string> = {
  'Near mint or better: Comparable to a fresh pack': 'Near mint or better - (ID: 400010)',
  'Near Mint or Better': 'Near mint or better - (ID: 400010)',
  'Near mint or better': 'Near mint or better - (ID: 400010)',
  'Excellent: Has clearly visible signs of wear': 'Excellent - (ID: 400011)',
  'Excellent': 'Excellent - (ID: 400011)',
  'Very good: Has moderate-to-heavy damage all over': 'Very good - (ID: 400012)',
  'Very Good': 'Very good - (ID: 400012)',
  'Very good': 'Very good - (ID: 400012)',
  'Poor: Is extremely worn and displays flaws all over': 'Poor - (ID: 400013)',
  'Poor': 'Poor - (ID: 400013)',
};

// eBay professional grader descriptor values (for descriptor ID 27501) — graded cards only
// Values must use the full eBay format: "<label> - (ID: <numeric_id>)"
// Source: eBay staff post (tools_apps_team@ebay), confirmed by ShipScript working example
const EBAY_GRADER_IDS: Record<string, string> = {
  'Professional Sports Authenticator (PSA)': 'Professional Sports Authenticator (PSA) - (ID: 275010)',
  'PSA': 'Professional Sports Authenticator (PSA) - (ID: 275010)',
  'Beckett Collectors Club Grading (BCCG)': 'Beckett Collectors Club Grading (BCCG) - (ID: 275011)',
  'BCCG': 'Beckett Collectors Club Grading (BCCG) - (ID: 275011)',
  'Beckett Vintage Grading (BVG)': 'Beckett Vintage Grading (BVG) - (ID: 275012)',
  'BVG': 'Beckett Vintage Grading (BVG) - (ID: 275012)',
  'Beckett Grading Services (BGS)': 'Beckett Grading Services (BGS) - (ID: 275013)',
  'BGS': 'Beckett Grading Services (BGS) - (ID: 275013)',
  'Certified Sports Guaranty (CSG)': 'Certified Sports Guaranty (CSG) - (ID: 275014)',
  'CSG': 'Certified Sports Guaranty (CSG) - (ID: 275014)',
  'Certified Guaranty Company (CGC)': 'Certified Guaranty Company (CGC) - (ID: 275015)',
  'CGC': 'Certified Guaranty Company (CGC) - (ID: 275015)',
  'Sportscard Guaranty Corporation (SGC)': 'Sportscard Guaranty Corporation (SGC) - (ID: 275016)',
  'SGC': 'Sportscard Guaranty Corporation (SGC) - (ID: 275016)',
  'K Sportscard Authentication (KSA)': 'K Sportscard Authentication (KSA) - (ID: 275017)',
  'KSA': 'K Sportscard Authentication (KSA) - (ID: 275017)',
  'Gem Mint Authentication (GMA)': 'Gem Mint Authentication (GMA) - (ID: 275018)',
  'GMA': 'Gem Mint Authentication (GMA) - (ID: 275018)',
  'Hybrid Grading Approach (HGA)': 'Hybrid Grading Approach (HGA) - (ID: 275019)',
  'HGA': 'Hybrid Grading Approach (HGA) - (ID: 275019)',
  'International Sports Authentication (ISA)': 'International Sports Authentication (ISA) - (ID: 2750110)',
  'ISA': 'International Sports Authentication (ISA) - (ID: 2750110)',
  'Gold Standard Grading (GSG)': 'Gold Standard Grading (GSG) - (ID: 2750112)',
  'GSG': 'Gold Standard Grading (GSG) - (ID: 2750112)',
  'Platin Grading Service (PGS)': 'Platin Grading Service (PGS) - (ID: 2750113)',
  'PGS': 'Platin Grading Service (PGS) - (ID: 2750113)',
  'MNT Grading (MNT)': 'MNT Grading (MNT) - (ID: 2750114)',
  'MNT': 'MNT Grading (MNT) - (ID: 2750114)',
  'Technical Authentication & Grading (TAG)': 'Technical Authentication & Grading (TAG) - (ID: 2750115)',
  'TAG': 'Technical Authentication & Grading (TAG) - (ID: 2750115)',
  'Rare Edition (Rare)': 'Rare Edition (Rare) - (ID: 2750116)',
  'Rare': 'Rare Edition (Rare) - (ID: 2750116)',
  'Revolution Card Grading (RCG)': 'Revolution Card Grading (RCG) - (ID: 2750117)',
  'RCG': 'Revolution Card Grading (RCG) - (ID: 2750117)',
  'Card Grading Australia (CGA)': 'Card Grading Australia (CGA) - (ID: 2750120)',
  'CGA': 'Card Grading Australia (CGA) - (ID: 2750120)',
  'Trading Card Grading (TCG)': 'Trading Card Grading (TCG) - (ID: 2750121)',
  'TCG': 'Trading Card Grading (TCG) - (ID: 2750121)',
  'Other': 'Other - (ID: 2750123)',
};

// eBay grade descriptor values (for descriptor ID 27502) — graded cards only
// Values must use the full eBay format: "<label> - (ID: <numeric_id>)"
const EBAY_GRADE_IDS: Record<string, string> = {
  '10': '10 - (ID: 275020)',
  '9.5': '9.5 - (ID: 275021)',
  '9': '9 - (ID: 275022)',
  '8.5': '8.5 - (ID: 275023)',
  '8': '8 - (ID: 275024)',
  '7.5': '7.5 - (ID: 275025)',
  '7': '7 - (ID: 275026)',
  '6.5': '6.5 - (ID: 275027)',
  '6': '6 - (ID: 275028)',
  '5.5': '5.5 - (ID: 275029)',
  '5': '5 - (ID: 2750210)',
  '4.5': '4.5 - (ID: 2750211)',
  '4': '4 - (ID: 2750212)',
  '3.5': '3.5 - (ID: 2750213)',
  '3': '3 - (ID: 2750214)',
  '2.5': '2.5 - (ID: 2750215)',
  '2': '2 - (ID: 2750216)',
  '1.5': '1.5 - (ID: 2750217)',
  '1': '1 - (ID: 2750218)',
  'A': 'Authentic - (ID: 2750219)',
  'Auth': 'Authentic - (ID: 2750219)',
  'Authentic': 'Authentic - (ID: 2750219)',
  'Authentic Altered': 'Authentic Altered - (ID: 2750220)',
  'Authentic - Trimmed': 'Authentic - Trimmed - (ID: 2750221)',
  'Authentic - Colored': 'Authentic - Colored - (ID: 2750222)',
};

// eBay format types
export const EBAY_FORMATS = {
  Auction: 'Auction',
  BuyItNow: 'FixedPrice',
};

/**
 * Calculate schedule times with staggering
 * User enters local time, we convert to UTC for eBay using the client's timezone offset
 */
function calculateScheduleTime(
  profile: ExportProfile,
  index: number,
  clientTzOffsetMinutes: number = 0
): string {
  if (profile.scheduleMode === 'Immediate') {
    return '';
  }
  
  if (!profile.scheduleDate || !profile.scheduleTime) {
    return '';
  }
  
  try {
    const dateStr = profile.scheduleDate;
    const timeStr = profile.scheduleTime;
    
    // Parse date and time - server interprets this as UTC
    // We need to add the client's timezone offset to get the correct UTC time
    // getTimezoneOffset() returns positive values for timezones behind UTC (e.g., EST = +300)
    const serverDateTime = new Date(`${dateStr}T${timeStr}:00Z`); // Parse as UTC
    
    // Add the client's timezone offset to convert to the intended UTC time
    // (offset is in minutes, positive for west of UTC)
    const utcDateTime = new Date(serverDateTime.getTime() + (clientTzOffsetMinutes * 60 * 1000));
    
    // Add stagger offset if enabled
    const offsetSeconds = profile.staggerEnabled
      ? index * profile.staggerIntervalSeconds
      : 0;
    
    const scheduledTime = addSeconds(utcDateTime, offsetSeconds);
    
    // Format for eBay in ISO format
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
  imageBaseUrl?: string, // Optional base URL for images (e.g., "https://yoursite.com")
  clientTzOffsetMinutes: number = 0 // Client's timezone offset (from Date.getTimezoneOffset())
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
    
    // Card condition descriptor (only for ungraded)
    // Must use full eBay format: "<label> - (ID: <numeric_id>)"
    const rawCondition = card.condition || '';
    const cardCondition = isGraded
      ? ''
      : (EBAY_CARD_CONDITION_CODES[rawCondition] || 'Near mint or better - (ID: 400010)');

    // Grader/grade descriptors (only for graded)
    // Must use full eBay format: "<label> - (ID: <numeric_id>)"
    const rawGrader = card.grader || '';
    const rawGrade = ((card as Record<string, unknown>).grade as string) || '';
    const grader = isGraded ? (EBAY_GRADER_IDS[rawGrader] || EBAY_GRADER_IDS['Other'] || rawGrader) : '';
    const grade = isGraded ? (EBAY_GRADE_IDS[rawGrade] || rawGrade) : '';
    const certNo = isGraded ? (card.certNo || '') : '';
    
    // Image URLs - if base URL provided, convert local paths to full URLs
    // eBay uses pipe (|) separator for multiple images
    const imageUrls = card.images
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((img) => imagePathToEbayPicUrl(img.originalPath, imageBaseUrl))
      .filter(Boolean)
      .join('|');
    
    // Description - use custom description if provided, otherwise use title
    const customDescription = (card as Record<string, unknown>).description as string | undefined;
    const description = customDescription || `<p>${title}</p>`;
    
    // Format and pricing
    // For FixedPrice: *StartPrice IS the listing price; BuyItNowPrice is an auction-only add-on field
    // For Auction:    *StartPrice is the starting bid; BuyItNowPrice is an optional instant-buy add-on
    const ebayFormat = EBAY_FORMATS[profile.listingType as keyof typeof EBAY_FORMATS] || 'Auction';
    const startPrice = profile.listingType === 'BuyItNow'
      ? (card.salePrice ?? '')
      : (card.salePrice || profile.startPriceDefault);
    const buyItNowPrice = profile.listingType === 'Auction'
      ? (profile.buyItNowPrice || '')
      : '';
    
    // Location — *Location is a required (starred) eBay field and must never be blank.
    // PostalCode is optional but improves shipping-estimate accuracy. Provide both when available.
    const location = [profile.itemLocationCity, profile.itemLocationState].filter(Boolean).join(', ') || 'United States';
    const postalCode = profile.itemLocationZip?.trim() || '';
    
    // Shipping
    const shippingType = profile.freeShipping ? 'Free' : 'Flat';
    const shippingCost = profile.freeShipping ? '0' : profile.shippingCost;
    
    // Returns
    const returnsOption = profile.returnsAccepted
      ? 'ReturnsAccepted'
      : 'ReturnsNotAccepted';
    const returnWindow = `Days_${profile.returnWindowDays}`;
    
    // Schedule time with staggering (using client's timezone offset)
    const scheduleTime = calculateScheduleTime(profile, i, clientTzOffsetMinutes);
    
    // Custom label (can be used for internal tracking)
    const customLabel = `${card.lotId.slice(0, 8)}-${String(i + 1).padStart(3, '0')}`;
    
    // Per-card eBay category: sports → profile setting (default 261328),
    // TCG → 183454, Non-Sport → 183050, overriding the lot-level profile setting
    const cardCategory = card.category || '';
    const ebayCategory = isSportsCategory(cardCategory)
      ? (profile.ebayCategory || '261328')
      : getCategoryEbayId(cardCategory);

    // *C:Sport is a starred (required) column in this single-template export, so eBay's File
    // Exchange parser rejects ANY row that leaves it blank — even TCG/Non-Sport rows where the
    // "Sport" aspect doesn't semantically apply and isn't enforced by eBay's own category schema.
    // "Non-Sport" is eBay's own recognized catch-all value for exactly this case, so we use it
    // instead of leaving the cell empty (which caused "item specific Sport is missing" failures
    // on every TAG/TCG card in export).
    const sport = isSportsCategory(cardCategory) ? cardCategory : 'Non-Sport';

    // C:Type has no real fixed eBay enum, but should still describe the item accurately per group
    const cardType = isSportsCategory(cardCategory)
      ? 'Sports Trading Card'
      : isTcgCategory(cardCategory)
        ? 'CCG Card'
        : 'Non-Sport Trading Card';
    
    // Build row matching the official eBay template header order exactly
    const row = [
      'Add',                                    // *Action
      customLabel,                              // CustomLabel
      ebayCategory,                             // *Category (per-card: sports=profile setting, TCG=183454, Non-Sport=183050)
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
      cardType,                                 // C:Type
      isGraded ? 'Yes' : 'No',                  // C:Graded
      imageUrls,                                // PicURL
      '',                                       // GalleryType
      '',                                       // VideoID
      description,                              // *Description
      ebayFormat,                               // *Format
      // FixedPrice must use GTC (Good Till Cancelled); Auction uses numeric days
      profile.listingType === 'BuyItNow' ? 'GTC' : profile.durationDays, // *Duration
      startPrice,                               // *StartPrice
      buyItNowPrice,                            // BuyItNowPrice (Auction add-on only; empty for FixedPrice)
      profile.bestOfferEnabled ? '1' : '0',    // BestOfferEnabled
      profile.bestOfferEnabled && profile.bestOfferAutoAcceptPrice
        ? String(profile.bestOfferAutoAcceptPrice)
        : '',                                   // BestOfferAutoAcceptPrice
      profile.bestOfferEnabled && profile.bestOfferMinimumPrice
        ? String(profile.bestOfferMinimumPrice)
        : '',                                   // MinimumBestOfferPrice
      '1',                                      // *Quantity
      profile.immediatePayment ? '1' : '0',     // ImmediatePayRequired
      location,                                 // *Location (empty when PostalCode is used)
      postalCode,                               // PostalCode (ZIP — preferred over *Location for FixedPrice)
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
