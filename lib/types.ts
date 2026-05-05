/**
 * Shared types for the application
 */

import { Lot, CardItem, CardImage, ExportProfile } from '@prisma/client';

// Re-export Prisma types that are used by components
export type { CardImage };

// Full types with relations
export type LotWithCount = Lot & {
  _count: {
    cardItems: number;
  };
};

export type LotWithCards = Lot & {
  cardItems: CardItemWithImages[];
  exportProfile: ExportProfile | null;
};

export type CardItemWithImages = CardItem & {
  images: CardImage[];
};

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Grid modes
export type GridMode = 'overview' | 'inspector';

// Status options
export const STATUS_OPTIONS = ['Draft', 'Ready', 'Exported'] as const;
export type CardStatus = (typeof STATUS_OPTIONS)[number];

// ─── Sports Trading Cards (eBay category 261328) ────────────────────────────
export const SPORTS_CATEGORIES = [
  'Aikido',
  'Alpine/Downhill',
  'Archery',
  'Athletics',
  'Australian Football',
  'Auto Racing',
  'Backcountry Skiing',
  'Badminton',
  'Baseball',
  'Basketball',
  'Beach Soccer',
  'Beach Volleyball',
  'Biathlon',
  'Billiards',
  'Bobsleigh',
  'Bodyboarding',
  'Bodybuilding',
  'Bowling',
  'Bowls',
  'Boxing',
  'Breaking',
  'Canoeing',
  'Climbing',
  'Cricket',
  'Curling',
  'Cycling',
  'Dance',
  'Darts',
  'Diving',
  'Dodgeball',
  'Downhill Skiing',
  'Equestrian',
  'eSports',
  'Fencing',
  'Field Hockey',
  'Figure Skating',
  'Fistball',
  'Football',
  'Gaelic Football',
  'Gliding',
  'Golf',
  'Gymnastics',
  'Handball',
  'Horse Racing',
  'Ice Hockey',
  'Ice Skating',
  'Jiu-Jitsu',
  'Judo',
  'Kabaddi',
  'Karate',
  'Kayaking',
  'Kendo',
  'Kitesurfing',
  'Korfball',
  'Krav Maga',
  'Kung Fu',
  'Lacrosse',
  'Luge',
  'Mixed Martial Arts (MMA)',
  'Modern Pentathlon',
  'Motorboat Racing',
  'Motorcycle Racing',
  'Muay Thai',
  'Netball',
  'Ninjitsu',
  'Nordic/Cross-Country',
  'Nordic Combined',
  'Paragliding',
  'Poker',
  'Polo',
  'Pool',
  'Rallycross',
  'Rodeo',
  'Roller Derby',
  'Roller Skating',
  'Rowing',
  'Rugby League',
  'Rugby Union',
  'Running',
  'Sailing',
  'Shooting',
  'Skateboarding',
  'Skeleton',
  'Ski Jumping',
  'Snowboarding',
  'Soccer',
  'Softball',
  'Squash',
  'Surfing',
  'Swimming',
  'Table Tennis',
  'Taekwondo',
  'Tai Chi',
  'Tchoukball',
  'Telemark',
  'Tennis',
  'Trampolining',
  'Triathlon',
  'Volleyball',
  'Wakeboarding',
  'Water Polo',
  'Weight Lifting',
  'Windsurfing',
  'Wrestling',
] as const;

// ─── TCG / Collectible Card Games (eBay category 183454) ────────────────────
export const TCG_CATEGORIES = [
  'Pokémon',
  'Magic: The Gathering',
  'Yu-Gi-Oh!',
  'Dragon Ball Super Card Game',
  'Digimon Card Game',
  'Disney Lorcana',
  'One Piece Card Game',
  'Star Wars: Unlimited',
  'Flesh and Blood TCG',
  'MetaZoo',
  'Weiss Schwarz',
  'Cardfight!! Vanguard',
  'Final Fantasy TCG',
  'KeyForge',
  'Sorcery: Contested Realm',
  'Grand Archive TCG',
  'My Hero Academia CCG',
  'Naruto CCG',
  'Battle Spirits Saga',
  'Shadowverse: Evolve',
  'Universus CCG',
  'Other TCG/CCG',
] as const;

// ─── Non-Sport Trading Cards (eBay category 183050) ─────────────────────────
export const NON_SPORT_CATEGORIES = [
  'Entertainment (General)',
  'Movies',
  'TV Shows',
  'Music',
  'Anime (Non-TCG)',
  'Science Fiction',
  'Fantasy',
  'Horror',
  'Comics / Superheroes',
  'Political',
  'Military',
  'Historical',
  'Animals / Wildlife',
  'Vintage Non-Sport',
  'Other Non-Sport',
] as const;

// Flat combined list — kept for backward-compat with existing code that
// iterates all options as a plain array
export const CATEGORY_OPTIONS = [
  ...SPORTS_CATEGORIES,
  ...TCG_CATEGORIES,
  ...NON_SPORT_CATEGORIES,
] as const;

// Quick-lookup set for validation
export const ALL_CATEGORIES_SET = new Set<string>(CATEGORY_OPTIONS);

// Grouped structure used by the searchable dropdown UI
export const CATEGORY_GROUPS = [
  { group: 'Sports', ebayCategory: '261328', options: SPORTS_CATEGORIES as readonly string[] },
  { group: 'TCG / Collectible Card Games', ebayCategory: '183454', options: TCG_CATEGORIES as readonly string[] },
  { group: 'Non-Sport', ebayCategory: '183050', options: NON_SPORT_CATEGORIES as readonly string[] },
] as const;

/** Returns which eBay top-level category a card's category maps to */
export function getCategoryEbayId(category: string): string {
  if ((TCG_CATEGORIES as readonly string[]).includes(category)) return '183454';
  if ((NON_SPORT_CATEGORIES as readonly string[]).includes(category)) return '183050';
  return '261328';
}

/** Returns true only for sports-type categories (eBay 261328) */
export function isSportsCategory(category: string): boolean {
  return (SPORTS_CATEGORIES as readonly string[]).includes(category);
}

// eBay category options for the export settings modal
export const EBAY_CARD_CATEGORIES = [
  { label: 'Sports Trading Cards', id: '261328' },
  { label: 'TCG / Collectible Card Games', id: '183454' },
  { label: 'Non-Sport Trading Cards', id: '183050' },
] as const;

// Condition Type options (eBay's condition types for trading cards)
export const CONDITION_TYPE_OPTIONS = [
  'Graded: Professionally graded',
  'Ungraded: Not in original packaging or professionally graded',
] as const;

// Card Condition options (for ungraded cards)
// Card condition options (for ungraded cards - eBay's options)
export const CONDITION_OPTIONS = [
  'Near mint or better: Comparable to a fresh pack',
  'Excellent: Has clearly visible signs of wear',
  'Very good: Has moderate-to-heavy damage all over',
  'Poor: Is extremely worn and displays flaws all over',
] as const;

// Professional Grader options (eBay's accepted graders)
export const GRADER_OPTIONS = [
  'Professional Sports Authenticator (PSA)',
  'Beckett Grading Services (BGS)',
  'Beckett Vintage Grading (BVG)',
  'Beckett Collectors Club Grading (BCCG)',
  'Certified Sports Guaranty (CSG)',
  'Certified Guaranty Company (CGC)',
  'Sportscard Guaranty Corporation (SGC)',
  'Hybrid Grading Approach (HGA)',
  'K Sportscard Authentication (KSA)',
  'Gem Mint Authentication (GMA)',
  'International Sports Authentication (ISA)',
  'Gold Standard Grading (GSG)',
  'Platin Grading Service (PGS)',
  'MNT Grading (MNT)',
  'Technical Authentication & Grading (TAG)',
  'Rare Edition (Rare)',
  'Revolution Card Grading (RCG)',
  'Ace Grading (Ace)',
  'Card Grading Australia (CGA)',
  'Trading Card Grading (TCG)',
  'Automated Grading Systems (AGS)',
  'Diamond Service Grading (DSG)',
  'Majesty Grading Company',
  'GRAAD',
  'Arena Club',
  'AiGrading',
  'Other',
] as const;

// Grade options (1-10 scale with half grades)
export const GRADE_OPTIONS = [
  '10',
  '9.5',
  '9',
  '8.5',
  '8',
  '7.5',
  '7',
  '6.5',
  '6',
  '5.5',
  '5',
  '4.5',
  '4',
  '3.5',
  '3',
  '2.5',
  '2',
  '1.5',
  '1',
] as const;

// Listing type options
export const LISTING_TYPE_OPTIONS = ['Auction', 'BuyItNow'] as const;

// Schedule mode options
export const SCHEDULE_MODE_OPTIONS = ['Immediate', 'Scheduled'] as const;

// Duration options (days)
export const DURATION_OPTIONS = [1, 3, 5, 7, 10] as const;

// Return window options (days)
export const RETURN_WINDOW_OPTIONS = [14, 30, 60] as const;

// Shipping services
export const SHIPPING_SERVICE_OPTIONS = [
  'USPS Ground Advantage',
  'USPS Priority Mail',
  'USPS First Class',
  'UPS Ground',
  'UPS 3 Day Select',
  'FedEx Ground',
  'FedEx Home Delivery',
] as const;

/** Cards created via PSA cert import — subset/parallel is optional for completion/export checks */
export function isPsaImportedCard(card: { psaImport?: boolean | null }): boolean {
  return card.psaImport === true;
}
