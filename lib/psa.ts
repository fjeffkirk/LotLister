/**
 * PSA (Professional Sports Authenticator) API Service
 * Fetches card data by certification number
 */

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

export interface PSAApiResponse {
  PSACert?: {
    CertNumber: string;
    Subject: string;
    Brand: string;
    Year: string;
    CardNumber: string;
    CardGrade: string;
    GradeDescription: string;
    TotalPopulation: number;
    PopulationHigher: number;
    LabelType: string;
    ReverseBarcode?: string;
    SpecNumber?: string;
    Category?: string;
    IsDNA?: boolean;
  };
  IsValidRequest: boolean;
  ServerMessage: string;
}

const PSA_API_BASE = 'https://api.psacard.com/publicapi';
const PSA_IMAGE_BASE = 'https://cert-images.psa.com';

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
    const response = await fetch(url, { method: 'HEAD' });
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
    const response = await fetch(url);
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
        'Authorization': `bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { success: false, error: 'PSA API authentication failed' };
      }
      if (response.status === 429) {
        return { success: false, error: 'PSA API rate limit exceeded' };
      }
      return { success: false, error: `PSA API error: ${response.status}` };
    }

    const data: PSAApiResponse = await response.json();

    if (!data.IsValidRequest) {
      return {
        success: false,
        error: data.ServerMessage || 'Invalid request',
      };
    }

    if (!data.PSACert) {
      return {
        success: false,
        error: 'Certificate not found',
      };
    }

    const cert = data.PSACert;
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
        sport: cert.Category || '',
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
 * Map PSA data to LotLister card fields
 */
export function mapPSAToCardData(psaData: PSACertData): Record<string, unknown> {
  // Parse brand - PSA often returns "YEAR BRAND SET" format
  // e.g., "2023 Topps Chrome" -> brand: "Topps", setName: "Chrome"
  let brand = '';
  let setName = psaData.brand;
  
  // Try to extract brand from the brand field
  const brandParts = psaData.brand.split(' ');
  if (brandParts.length > 1) {
    // Skip year if it's at the start
    const startIdx = /^\d{4}$/.test(brandParts[0]) ? 1 : 0;
    if (brandParts.length > startIdx + 1) {
      brand = brandParts[startIdx];
      setName = brandParts.slice(startIdx).join(' ');
    } else {
      brand = brandParts[startIdx] || '';
      setName = psaData.brand;
    }
  }

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
    brand: brand,
    setName: setName,
    year: psaData.year ? parseInt(psaData.year, 10) : null,
    cardNumber: psaData.cardNumber,
    category: psaData.sport || psaData.category,
    conditionType: 'Graded: Professionally graded',
    grader: 'Professional Sports Authenticator (PSA)',
    grade: gradeMapping[psaData.grade] || `${psaData.gradeDescription} ${psaData.grade}`,
    certNo: psaData.certNumber,
    // Additional PSA-specific data stored for reference
    subsetParallel: '', // User may need to fill this
  };
}
