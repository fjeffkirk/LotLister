/**
 * PSA (Professional Sports Authenticator) API Service
 * Fetches card data by certification number
 */

import { createHash } from 'crypto';
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
  /** PSA ReverseBarCode: prefer `_f` scan as listing front (default is `_b` first for obverse) */
  reverseBarcode?: boolean;
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
  /** .NET API spelling */
  ReverseBarCode?: boolean;
  reverseBarCode?: boolean;
  ReverseBarcode?: boolean | string;
  reverseBarcode?: boolean | string;
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

function pickBool(...vals: unknown[]): boolean {
  for (const v of vals) {
    if (v === true) return true;
    if (v === false || v === null || v === undefined) continue;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (s === 'true' || s === '1' || s === 'yes') return true;
    }
  }
  return false;
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
    ReverseBarcode: pickBool(
      raw.ReverseBarCode,
      raw.reverseBarCode,
      raw.ReverseBarcode,
      raw.reverseBarcode
    ),
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

function bufferLooksLikeImage(buf: Buffer): boolean {
  if (buf.length < 400) return false;
  // Reject HTML / Cloudflare challenge bodies
  if (buf[0] === 0x3c /* < */) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8) return true; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
  return false;
}

/** Digits-only cert variants for CDN paths (PSA sometimes pads in URLs). */
function certNumberUrlVariants(digits: string): string[] {
  const d = digits.replace(/\D/g, '');
  if (!d) return [];
  const out = new Set<string>([d]);
  const p8 = d.padStart(8, '0');
  if (p8 !== d) out.add(p8);
  const trimmed = d.replace(/^0+/, '') || '0';
  if (trimmed !== d) out.add(trimmed);
  return [...out];
}

function bufferSig(buf: Buffer): string {
  const n = Math.min(8192, buf.length);
  return `${buf.length}:${createHash('sha256').update(buf.subarray(0, n)).digest('hex')}`;
}

/** Sort JSON object keys so Front/Image1-style properties are walked before Back/Image2 (PSA GetImages payload). */
function objectKeyImageSortOrder(key: string): number {
  const k = key.toLowerCase();
  if ((/\bfront\b|\bobverse\b|\bface\b|primary|image\s*0|^image1$|first/.test(k) || /^f$/i.test(k)) && !/\bback\b/.test(k)) {
    return 0;
  }
  if (/\bback\b|\breverse\b|\bverso\b|image\s*2|^image2$|second/.test(k) || /^b$/i.test(k)) {
    return 2;
  }
  return 1;
}

/** Depth-first image URL extraction: arrays preserve order; object keys ordered for front-before-back. */
function walkImageUrlsOrdered(value: unknown, out: string[]): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    const t = value.trim();
    if (/^https?:\/\//i.test(t) && /\.(jpe?g|png|webp)(\?|$)/i.test(t)) {
      out.push(t);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkImageUrlsOrdered(item, out);
    return;
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o).sort((a, b) => {
      const d = objectKeyImageSortOrder(a) - objectKeyImageSortOrder(b);
      return d !== 0 ? d : a.localeCompare(b);
    });
    for (const k of keys) walkImageUrlsOrdered(o[k], out);
  }
}

/** Try several CDN paths per side (with and without size folder). */
function getPsaCdnImageUrlCandidates(certNumber: string, side: 'front' | 'back'): string[] {
  const s = side === 'front' ? 'f' : 'b';
  const sizes = ['large', 'medium', 'small'];
  const exts = ['jpg', 'jpeg'];
  const urls: string[] = [];
  for (const ext of exts) {
    urls.push(`${PSA_IMAGE_BASE}/${certNumber}/${certNumber}_${s}.${ext}`);
  }
  for (const size of sizes) {
    for (const ext of exts) {
      urls.push(`${PSA_IMAGE_BASE}/${certNumber}/${size}/${certNumber}_${s}.${ext}`);
    }
  }
  return urls;
}

async function fetchPsaApiImageUrlsOrdered(certNumber: string): Promise<string[]> {
  const token = process.env.PSA_API_TOKEN?.trim();
  if (!token) return [];
  try {
    const res = await fetch(`${PSA_API_BASE}/cert/GetImagesByCertNumber/${certNumber}`, {
      headers: {
        Authorization: `bearer ${token}`,
        Accept: 'application/json',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    const ordered: string[] = [];
    walkImageUrlsOrdered(data, ordered);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const u of ordered) {
      if (seen.has(u)) continue;
      seen.add(u);
      out.push(u);
    }
    return out;
  } catch {
    return [];
  }
}

async function downloadDistinctFromUrls(urls: string[], max: number): Promise<Buffer[]> {
  const bufs: Buffer[] = [];
  const sigs = new Set<string>();
  for (const url of urls) {
    if (bufs.length >= max) break;
    const buf = await downloadImage(url);
    if (!buf || !bufferLooksLikeImage(buf)) continue;
    const sig = bufferSig(buf);
    if (sigs.has(sig)) continue;
    sigs.add(sig);
    bufs.push(buf);
  }
  return bufs;
}

async function downloadCdnBothSides(variants: string[]): Promise<{ f: Buffer | null; b: Buffer | null }> {
  let f: Buffer | null = null;
  let b: Buffer | null = null;
  for (const c of variants) {
    if (!f) f = await downloadFirstValidImage(getPsaCdnImageUrlCandidates(c, 'front'));
    if (!b) b = await downloadFirstValidImage(getPsaCdnImageUrlCandidates(c, 'back'));
    if (f && b) break;
  }
  if (f && b && bufferSig(f) === bufferSig(b)) {
    b = null;
  }
  return { f, b };
}

async function downloadFirstValidImage(urls: string[]): Promise<Buffer | null> {
  const unique = [...new Set(urls)];
  for (const url of unique) {
    const buf = await downloadImage(url);
    if (buf && bufferLooksLikeImage(buf)) return buf;
  }
  return null;
}

export interface DownloadPsaCertImagesOptions {
  /** PSA ReverseBarCode: swap which downloaded scan is treated as listing front (sortOrder 0) */
  reverseBarcode?: boolean;
}

/**
 * Download up to two distinct cert scans for import.
 * 1) Always uses GetImagesByCertNumber when PSA_API_TOKEN is set — URLs are ordered (front-before-back keys, then arrays).
 * 2) Fills missing sides from CDN `_f` / `_b` with padded cert variants and extra path patterns.
 * 3) Without API data, uses CDN only; listing front defaults to `_b` then `_f` when both exist (empirical for many slabs).
 */
export async function downloadPsaCertImages(
  certNumber: string,
  options?: DownloadPsaCertImagesOptions
): Promise<{
  front: Buffer | null;
  back: Buffer | null;
}> {
  const rev = options?.reverseBarcode === true;
  const clean = certNumber.replace(/\D/g, '');
  const variants = certNumberUrlVariants(clean);

  const apiUrls = await fetchPsaApiImageUrlsOrdered(clean);
  const [apiBufs, { f: bufF, b: bufB }] = await Promise.all([
    downloadDistinctFromUrls(apiUrls, 4),
    downloadCdnBothSides(variants),
  ]);

  let front: Buffer | null = null;
  let back: Buffer | null = null;

  if (apiBufs.length >= 2) {
    front = apiBufs[0];
    back = apiBufs[1];
  } else if (apiBufs.length === 1) {
    front = apiBufs[0];
    for (const c of [bufF, bufB]) {
      if (c && bufferSig(c) !== bufferSig(front)) {
        back = c;
        break;
      }
    }
  } else {
    if (bufF && bufB && bufferSig(bufF) !== bufferSig(bufB)) {
      front = bufB;
      back = bufF;
    } else if (bufF && bufB) {
      front = bufF;
      back = null;
    } else {
      front = bufF ?? bufB ?? null;
      back = null;
    }
  }

  if (rev && front && back) {
    const t = front;
    front = back;
    back = t;
  }

  if (!front && !back) {
    console.warn(`[PSA import] Could not download cert images for ${certNumber}`);
  }

  return { front, back };
}

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
 * Download image from URL and return as Buffer
 */
export async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, {
      headers: PSA_IMAGE_FETCH_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) {
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
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
        reverseBarcode: cert.ReverseBarcode === true,
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
