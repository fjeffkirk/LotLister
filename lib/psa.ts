/**
 * PSA (Professional Sports Authenticator) API Service
 * Fetches card data by certification number
 */

import { CATEGORY_OPTIONS } from './types';

export interface PSACertData {
  certNumber: string;
  subject: string;           // Player/Character name
  brand: string;             // Card brand (e.g., "Topps Chrome")
  year: string;              // Year (e.g., "2023")
  cardNumber: string;        // Card number in set
  grade: string;             // Grade (e.g., "10")
  gradeDescription: string;  // Grade description (e.g., "Gem Mint")
  sport: string;             // Sport/Category
  category: string;          // Category
  labelType: string;         // Label type (e.g., "PSA")
  population: number;        // Population at this grade
  populationHigher: number;  // Population higher than this grade
  reverseBarcode?: string;   // Reverse barcode if available
  specNumber?: string;       // Spec number if available
}

export interface PSALookupResult {
  success: boolean;
  data?: PSACertData;
  images?: {
    front: string | null;
    back: string | null;
  };
  error?: string;
}

/** PSA may return PascalCase (.NET) or camelCase JSON */
export interface PSAApiCertRaw {
  CertNumber?: string;
  certNumber?: string;
  Subject?: string;
  subject?: string;
  Brand?: string;
  brand?: string;
  Year?: string;
  year?: string;
  CardNumber?: string;
  cardNumber?: string;
  CardGrade?: string;
  cardGrade?: string;
  GradeDescription?: string;
  gradeDescription?: string;
  TotalPopulation?: number;
  totalPopulation?: number;
  PopulationHigher?: number;
  populationHigher?: number;
  LabelType?: string;
  labelType?: string;
  ReverseBarcode?: string;
  reverseBarcode?: string;
  SpecNumber?: string;
  specNumber?: string;
  Category?: string;
  category?: string;
  Sport?: string;
  sport?: string;
  IsDNA?: boolean;
  isDNA?: boolean;
}

export interface PSAApiResponse {
  PSACert?: PSAApiCertRaw;
  psaCert?: PSAApiCertRaw;
  IsValidRequest?: boolean;
  isValidRequest?: boolean;
  ServerMessage?: string;
  serverMessage?: string;
}

function pickStr(...vals: (string | undefined)[]): string {
  for (const v of vals) {
    if (v !== undefined && v !== null) return String(v);
  }
  return '';
}

function pickNum(...vals: (number | undefined)[]): number {
  for (const v of vals) {
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
  }
  return 0;
}

/** Normalize PSA cert object whether API used PascalCase or camelCase */
function normalizePSACert(raw: PSAApiCertRaw) {
  return {
    CertNumber: pickStr(raw.CertNumber, raw.certNumber),
    Subject: pickStr(raw.Subject, raw.subject),
    Brand: pickStr(raw.Brand, raw.brand),
    Year: pickStr(raw.Year, raw.year),
    CardNumber: pickStr(raw.CardNumber, raw.cardNumber),
    CardGrade: pickStr(raw.CardGrade, raw.cardGrade),
    GradeDescription: pickStr(raw.GradeDescription, raw.gradeDescription),
    TotalPopulation: pickNum(raw.TotalPopulation, raw.totalPopulation),
    PopulationHigher: pickNum(raw.PopulationHigher, raw.populationHigher),
    LabelType: pickStr(raw.LabelType, raw.labelType),
    ReverseBarcode: raw.ReverseBarcode ?? raw.reverseBarcode,
    SpecNumber: raw.SpecNumber ?? raw.specNumber,
    Category: pickStr(raw.Category, raw.category),
    Sport: pickStr(raw.Sport, raw.sport),
  };
}

const PSA_API_BASE = 'https://api.psacard.com/publicapi';
const PSA_IMAGE_BASE = 'https://cert-images.psa.com';

/**
 * PSA’s CDN often returns 403/HTML for Node’s default fetch. Use browser-like headers for server-side downloads.
 */
const PSA_IMAGE_FETCH_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.psacard.com/',
};

/**
 * Get the PSA API token from environment
 */
function getApiToken(): string {
  const token = process.env.PSA_API_TOKEN;
  if (!token) {
    throw new Error('PSA_API_TOKEN environment variable is not set');
  }
  return token;
}

/**
 * Build PSA image URLs for a cert number
 */
export function getPSAImageUrls(certNumber: string): { front: string; back: string } {
  return {
    front: `${PSA_IMAGE_BASE}/${certNumber}/large/${certNumber}_f.jpg`,
    back: `${PSA_IMAGE_BASE}/${certNumber}/large/${certNumber}_b.jpg`,
  };
}

/**
 * Check if a PSA image exists (returns true/false)
 */
export async function checkImageExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: PSA_IMAGE_FETCH_HEADERS,
      signal: AbortSignal.timeout(12000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Look up a PSA cert by certification number
 */
export async function lookupPSACert(certNumber: string): Promise<PSALookupResult> {
  // Validate cert number (should be numeric)
  const cleanCert = certNumber.replace(/\D/g, '');
  if (!cleanCert || cleanCert.length < 5) {
    return {
      success: false,
      error: 'Invalid certification number format',
    };
  }

  try {
    const token = getApiToken();
    
    const response = await fetch(`${PSA_API_BASE}/cert/GetByCertNumber/${cleanCert}`, {
      method: 'GET',
      headers: {
        // PSA docs: "bearer " + token (trim avoids newline issues from env paste)
        Authorization: `bearer ${token.trim()}`,
        Accept: 'application/json',
      },
    });

    const responseText = await response.text();
    let parsed: unknown;
    try {
      parsed = responseText ? JSON.parse(responseText) : null;
    } catch {
      parsed = responseText;
    }

    if (!response.ok) {
      if (response.status === 401) {
        return { success: false, error: 'PSA API authentication failed. Check PSA_API_TOKEN.' };
      }
      if (response.status === 429) {
        const msg =
          typeof parsed === 'string'
            ? parsed
            : 'PSA API daily quota exceeded (100 calls/day on free tier). Try again tomorrow or upgrade.';
        return { success: false, error: msg };
      }
      const detail =
        typeof parsed === 'string'
          ? parsed
          : parsed && typeof parsed === 'object' && 'ServerMessage' in parsed
            ? String((parsed as PSAApiResponse).ServerMessage ?? (parsed as PSAApiResponse).serverMessage ?? '')
            : '';
      return {
        success: false,
        error: detail || `PSA API error (${response.status})`,
      };
    }

    // Success HTTP but body might be a plain JSON string (e.g. quota message) or non-object
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const asString = typeof parsed === 'string' ? parsed : responseText;
      return {
        success: false,
        error: asString || 'Unexpected response from PSA API',
      };
    }

    const data = parsed as PSAApiResponse;
    const isValidRequest = data.IsValidRequest ?? data.isValidRequest;
    const serverMessage = data.ServerMessage ?? data.serverMessage ?? '';
    const rawCert = data.PSACert ?? data.psaCert;

    if (isValidRequest === false) {
      return {
        success: false,
        error: serverMessage || 'PSA rejected this request (check cert number format)',
      };
    }

    // Missing flag treated as invalid only if we also have no cert payload
    if (isValidRequest !== true && !rawCert) {
      return {
        success: false,
        error: serverMessage || 'Invalid response from PSA API',
      };
    }

    if (!rawCert) {
      if (serverMessage.toLowerCase().includes('no data')) {
        return { success: false, error: 'Certificate not found in PSA database' };
      }
      return {
        success: false,
        error: serverMessage || 'Certificate not found',
      };
    }

    const cert = normalizePSACert(rawCert);
    const imageUrls = getPSAImageUrls(cleanCert);
    
    // Check if images exist
    const [frontExists, backExists] = await Promise.all([
      checkImageExists(imageUrls.front),
      checkImageExists(imageUrls.back),
    ]);

    return {
      success: true,
      data: {
        certNumber: cert.CertNumber,
        subject: cert.Subject || '',
        brand: cert.Brand || '',
        year: cert.Year || '',
        cardNumber: cert.CardNumber || '',
        grade: cert.CardGrade || '',
        gradeDescription: cert.GradeDescription || '',
        sport: cert.Sport || cert.Category || '',
        category: cert.Category || '',
        labelType: cert.LabelType || 'PSA',
        population: cert.TotalPopulation || 0,
        populationHigher: cert.PopulationHigher || 0,
        reverseBarcode: cert.ReverseBarcode,
        specNumber: cert.SpecNumber,
      },
      images: {
        front: frontExists ? imageUrls.front : null,
        back: backExists ? imageUrls.back : null,
      },
    };
  } catch (error) {
    console.error('PSA API lookup failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to lookup certificate',
    };
  }
}

/**
 * Look up multiple PSA certs (with rate limiting)
 */
export async function lookupMultiplePSACerts(
  certNumbers: string[],
  onProgress?: (completed: number, total: number, current: PSALookupResult) => void
): Promise<PSALookupResult[]> {
  const results: PSALookupResult[] = [];
  
  for (let i = 0; i < certNumbers.length; i++) {
    const result = await lookupPSACert(certNumbers[i]);
    results.push(result);
    
    if (onProgress) {
      onProgress(i + 1, certNumbers.length, result);
    }
    
    // Small delay between requests to be respectful to PSA API
    if (i < certNumbers.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  return results;
}

/**
 * Split PSA "Brand" line (e.g. "2024 TOPPS INCEPTION ROOKIE JUMBO RELICS") into
 * manufacturer / product / insert-or-parallel text. PSA sends one combined string;
 * this is our best-effort split (not PSA's separate fields).
 */
export function parsePsaBrandLine(brandRaw: string): {
  brand: string;
  setName: string;
  subsetParallel: string;
} {
  const parts = brandRaw.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { brand: '', setName: '', subsetParallel: '' };
  }

  let start = 0;
  if (/^\d{4}$/.test(parts[0])) {
    start = 1;
  }

  const tokens = parts.slice(start);
  if (tokens.length === 0) {
    return { brand: '', setName: brandRaw.trim(), subsetParallel: '' };
  }
  if (tokens.length === 1) {
    return { brand: tokens[0], setName: tokens[0], subsetParallel: '' };
  }

  // First token = manufacturer (TOPPS, PANINI, BOWMAN), second = core set name, rest = insert/parallel/etc.
  const brand = tokens[0];
  const setName = tokens[1];
  const subsetParallel = tokens.length > 2 ? tokens.slice(2).join(' ') : '';

  return { brand, setName, subsetParallel };
}

/**
 * Map PSA sport/category text to eBay Sport aspect values (CATEGORY_OPTIONS).
 */
export function mapPsaSportToEbayCategory(raw: string | undefined | null): string {
  if (!raw || !raw.trim()) {
    return 'Baseball';
  }

  const t = raw.trim();
  const lower = t.toLowerCase();

  const exact = CATEGORY_OPTIONS.find((c) => c.toLowerCase() === lower);
  if (exact) {
    return exact;
  }

  const aliases: Record<string, string> = {
    'basketball cards': 'Basketball',
    'baseball cards': 'Baseball',
    'football cards': 'Football',
    'hockey cards': 'Ice Hockey',
    'soccer cards': 'Soccer',
    tcg: 'eSports',
    'trading card game': 'eSports',
    'card games': 'eSports',
    'multi sport': 'Baseball',
    'multi-sport': 'Baseball',
  };
  if (aliases[lower]) {
    return aliases[lower];
  }

  const sorted = [...CATEGORY_OPTIONS].sort((a, b) => b.length - a.length);
  for (const opt of sorted) {
    if (lower.includes(opt.toLowerCase())) {
      return opt;
    }
  }

  if (lower.includes('basketball')) return 'Basketball';
  if (lower.includes('baseball')) return 'Baseball';
  if (lower.includes('football') && !lower.includes('australian')) return 'Football';
  if (lower.includes('soccer')) return 'Soccer';
  if (lower.includes('hockey')) return 'Ice Hockey';

  // No confident match — keep PSA text; user may need to pick from Category dropdown
  return t;
}

/**
 * Map PSA data to LotLister card fields
 */
export function mapPSAToCardData(psaData: PSACertData): Record<string, unknown> {
  const { brand, setName, subsetParallel } = parsePsaBrandLine(psaData.brand || '');

  const sportSource = (psaData.sport || psaData.category || '').trim();
  const category = mapPsaSportToEbayCategory(sportSource);

  // Map PSA grade to our grade options
  const gradeMapping: Record<string, string> = {
    '10': 'Gem Mint 10',
    '9': 'Mint 9',
    '8': 'Near Mint-Mint 8',
    '7': 'Near Mint 7',
    '6': 'Excellent-Mint 6',
    '5': 'Excellent 5',
    '4': 'Very Good-Excellent 4',
    '3': 'Very Good 3',
    '2': 'Good 2',
    '1': 'Poor 1',
    '1.5': 'Fair 1.5',
    'A': 'Authentic',
  };

  return {
    name: psaData.subject,
    brand,
    setName,
    year: psaData.year ? parseInt(psaData.year, 10) : null,
    cardNumber: psaData.cardNumber,
    category,
    subsetParallel,
    conditionType: 'Graded: Professionally graded',
    grader: 'Professional Sports Authenticator (PSA)',
    grade: gradeMapping[psaData.grade] || `${psaData.gradeDescription} ${psaData.grade}`,
    certNo: psaData.certNumber,
  };
}
