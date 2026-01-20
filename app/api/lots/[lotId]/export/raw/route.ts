import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../../../lib/prisma';
import { generateRawCSV } from '../../../../../../lib/export-csv';
import { format } from 'date-fns';
import { getUserEmail } from '../../../../../../lib/auth';

interface RouteParams {
  params: Promise<{ lotId: string }>;
}

// GET /api/lots/[lotId]/export/raw - Export raw CSV
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
    
    // Fetch lot with cards (verify ownership)
    const lot = await prisma.lot.findFirst({
      where: { id: lotId, userEmail },
      include: {
        cardItems: {
          include: { images: { orderBy: { sortOrder: 'asc' } } },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    
    if (!lot) {
      return NextResponse.json(
        { success: false, error: 'Lot not found' },
        { status: 404 }
      );
    }
    
    // Generate CSV
    const csv = generateRawCSV(lot.cardItems);
    
    // Create filename
    const date = format(new Date(), 'MM-dd-yy');
    const safeName = lot.name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
    const filename = `${safeName}_${lot.cardItems.length}_items_raw_export_${date}.csv`;
    
    // Return CSV file
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Failed to export raw CSV:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to export' },
      { status: 500 }
    );
  }
}
