import { NextResponse } from 'next/server';
import { CatalogStatus, CatalogType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { isUnauthorized, requireSession } from '@/lib/require-session';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

export async function GET() {
  const session = await requireSession();
  if (isUnauthorized(session)) return session;
  if (!prisma) {
    return NextResponse.json({ ok: false, error: 'No database' }, { status: 503, headers: noStore });
  }

  const products = await prisma.catalogItem.findMany({
    where: { type: CatalogType.product, status: CatalogStatus.active },
    select: {
      id: true,
      title: true,
      sku: true,
      imageUrl: true,
      vendor: true,
      marginPercentOverride: true,
    },
    orderBy: [{ title: 'asc' }, { sku: 'asc' }],
  });

  return NextResponse.json({ ok: true, products }, { headers: noStore });
}
