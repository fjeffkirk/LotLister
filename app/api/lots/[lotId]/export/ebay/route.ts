import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../../../lib/prisma';
import { generateEbayCSV } from '../../../../../../lib/export-csv';
import { format } from 'date-fns';
import { getUserEmail } from '../../../../../../lib/auth';

interface RouteParams {
  params: Promise<{ lotId: string }>;
}

// Default export profile values
const DEFAULT_EXPORT_PROFILE = {
  templateName: '7 Day Auction',
  ebayCategory: '261328',
  storeCategory: '0',
  listingType: 'Auction',
  startPriceDefault: 4.99,
  buyItNowPrice: null,
  durationDays: 7,
  scheduleMode: 'Scheduled',
  scheduleDate: null,
  scheduleTime: null,
  staggerEnabled: true,
  staggerIntervalSeconds: 15,
  shippingService: 'USPS Ground Advantage',
  handlingTimeDays: 3,
  freeShipping: false,
  shippingCost: 3.99,
  eachAdditionalItemCost: 1.49,
  immediatePayment: false,
  itemLocationCity: null,
  itemLocationState: null,
  itemLocationZip: null,
  returnsAccepted: true,
  returnWindowDays: 14,
  refundMethod: 'Money Back',
  shippingCostPaidBy: 'Seller',
  salesTaxEnabled: false,
};

// GET /api/lots/[lotId]/export/ebay - Export eBay File Exchange CSV
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const userEmail = await getUserEmail();
    if (!userEmail) {
      return NextResponse.json({ success: false, error: 'User email not set' }, { status: 401 });
    }

    const { lotId } = await params;
    
    // Fetch lot with cards and export profile (verify ownership)
    const lot = await prisma.lot.findFirst({
      where: { id: lotId, userEmail },
      include: {
        cardItems: {
          include: { images: { orderBy: { sortOrder: 'asc' } } },
          orderBy: { sortOrder: 'asc' },
        },
        exportProfile: true,
      },
    });
    
    if (!lot) {
      return NextResponse.json(
        { success: false, error: 'Lot not found' },
        { status: 404 }
      );
    }
    
    // Use existing profile or defaults
    const profile = lot.exportProfile || {
      id: '',
      lotId,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...DEFAULT_EXPORT_PROFILE,
    };
    
    // Get image base URL - use the app's URL in production
    // Priority: query param > env var > request origin
    const { searchParams, origin } = new URL(request.url);
    const imageBaseUrl = searchParams.get('imageBaseUrl') 
      || process.env.NEXT_PUBLIC_APP_URL 
      || origin;
    
    // Get client timezone offset (minutes offset from UTC, negative for ahead)
    const tzOffsetParam = searchParams.get('tzOffset');
    const tzOffsetMinutes = tzOffsetParam ? parseInt(tzOffsetParam, 10) : 0;
    
    // Generate CSV with full image URLs and timezone offset
    const csv = generateEbayCSV(lot.cardItems, profile, imageBaseUrl, tzOffsetMinutes);
    
    // Create filename
    const date = format(new Date(), 'MM-dd-yy');
    const safeName = lot.name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
    const filename = `${safeName}_${lot.cardItems.length}_items_ebay_export_${date}.csv`;
    
    // Return CSV file
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Failed to export eBay CSV:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to export' },
      { status: 500 }
    );
  }
}
