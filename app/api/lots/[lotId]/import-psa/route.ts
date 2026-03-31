import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../../lib/prisma';
import { getUserEmail } from '../../../../../lib/auth';
import {
  lookupPSACert,
  downloadImage,
  mapPSAToCardData,
  getPSAImageUrls,
  PSALookupResult,
} from '../../../../../lib/psa';
import { saveImage } from '../../../../../lib/storage';
import { v4 as uuidv4 } from 'uuid';

interface RouteParams {
  params: Promise<{ lotId: string }>;
}

interface ImportResult {
  certNumber: string;
  success: boolean;
  error?: string;
  cardId?: string;
}

interface ImportResponse {
  totalRequested: number;
  successCount: number;
  failedCount: number;
  results: ImportResult[];
}

// POST /api/lots/[lotId]/import-psa - Import cards from PSA cert numbers
export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<{ success: boolean; data?: ImportResponse; error?: string }>> {
  try {
    const userEmail = await getUserEmail();
    if (!userEmail) {
      return NextResponse.json({ success: false, error: 'User email not set' }, { status: 401 });
    }

    const { lotId } = await params;
    
    // Verify lot exists and belongs to user
    const lot = await prisma.lot.findFirst({
      where: { id: lotId, userEmail },
    });
    
    if (!lot) {
      return NextResponse.json(
        { success: false, error: 'Lot not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const certNumbers: string[] = body.certNumbers || [];

    if (certNumbers.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No cert numbers provided' },
        { status: 400 }
      );
    }

    if (certNumbers.length > 50) {
      return NextResponse.json(
        { success: false, error: 'Maximum 50 cert numbers per import' },
        { status: 400 }
      );
    }

    // Get current highest sort order
    const lastCard = await prisma.cardItem.findFirst({
      where: { lotId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    let currentSortOrder = (lastCard?.sortOrder ?? -1) + 1;

    const results: ImportResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    // Process each cert number
    for (const certNumber of certNumbers) {
      const cleanCert = certNumber.replace(/\D/g, '');
      
      if (!cleanCert) {
        results.push({
          certNumber,
          success: false,
          error: 'Invalid cert number format',
        });
        failedCount++;
        continue;
      }

      // Check if this cert already exists in the lot
      const existingCard = await prisma.cardItem.findFirst({
        where: {
          lotId,
          certNo: cleanCert,
        },
      });

      if (existingCard) {
        results.push({
          certNumber: cleanCert,
          success: false,
          error: 'Card with this cert number already exists in this lot',
        });
        failedCount++;
        continue;
      }

      // Look up the cert from PSA
      const psaResult: PSALookupResult = await lookupPSACert(cleanCert);

      if (!psaResult.success || !psaResult.data) {
        results.push({
          certNumber: cleanCert,
          success: false,
          error: psaResult.error || 'Failed to lookup cert',
        });
        failedCount++;
        continue;
      }

      // Map PSA data to card fields
      const cardData = mapPSAToCardData(psaResult.data);
      const cardId = uuidv4();

      // Download and save images — always try GET; PSA/CDN often blocks HEAD while GET works
      const imageRecords: { originalPath: string; thumbPath: string; filename: string; sortOrder: number }[] = [];
      const { front: frontUrl, back: backUrl } = getPSAImageUrls(cleanCert);

      const frontBuffer = await downloadImage(frontUrl);
      if (frontBuffer && frontBuffer.length > 100) {
        const frontResult = await saveImage(lotId, `psa_${cleanCert}_front.jpg`, frontBuffer);
        imageRecords.push({
          originalPath: frontResult.originalPath,
          thumbPath: frontResult.thumbPath,
          filename: frontResult.filename,
          sortOrder: 0,
        });
      }

      const backBuffer = await downloadImage(backUrl);
      if (backBuffer && backBuffer.length > 100) {
        const backResult = await saveImage(lotId, `psa_${cleanCert}_back.jpg`, backBuffer);
        imageRecords.push({
          originalPath: backResult.originalPath,
          thumbPath: backResult.thumbPath,
          filename: backResult.filename,
          sortOrder: 1,
        });
      }

      // Create the card item with images
      try {
        await prisma.cardItem.create({
          data: {
            id: cardId,
            lotId,
            sortOrder: currentSortOrder,
            title: null, // Will be auto-generated
            name: cardData.name as string,
            brand: cardData.brand as string,
            setName: cardData.setName as string,
            year: cardData.year as number | null,
            cardNumber: cardData.cardNumber as string,
            category: cardData.category as string,
            conditionType: cardData.conditionType as string,
            grader: cardData.grader as string,
            grade: cardData.grade as string,
            certNo: cardData.certNo as string,
            subsetParallel: cardData.subsetParallel as string,
            psaImport: true,
            images: {
              create: imageRecords,
            },
          },
        });

        currentSortOrder++;
        successCount++;
        results.push({
          certNumber: cleanCert,
          success: true,
          cardId,
        });
      } catch (dbError) {
        console.error('Failed to create card item:', dbError);
        results.push({
          certNumber: cleanCert,
          success: false,
          error: 'Failed to save card to database',
        });
        failedCount++;
      }

      // Small delay between API calls
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return NextResponse.json({
      success: true,
      data: {
        totalRequested: certNumbers.length,
        successCount,
        failedCount,
        results,
      },
    });
  } catch (error) {
    console.error('PSA import failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to import from PSA' },
      { status: 500 }
    );
  }
}

// GET /api/lots/[lotId]/import-psa/preview - Preview PSA data without importing
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<{ success: boolean; data?: PSALookupResult; error?: string }>> {
  try {
    const userEmail = await getUserEmail();
    if (!userEmail) {
      return NextResponse.json({ success: false, error: 'User email not set' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const certNumber = searchParams.get('cert');

    if (!certNumber) {
      return NextResponse.json(
        { success: false, error: 'Cert number required' },
        { status: 400 }
      );
    }

    const result = await lookupPSACert(certNumber);
    
    return NextResponse.json({
      success: result.success,
      data: result,
      error: result.error,
    });
  } catch (error) {
    console.error('PSA preview failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to lookup PSA cert' },
      { status: 500 }
    );
  }
}
