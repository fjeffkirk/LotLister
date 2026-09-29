import { NextResponse } from 'next/server';
import { isReadyForSoldComps } from '../../../../lib/card-completeness';
import { isUnauthorized, requireSession } from '../../../../lib/require-session';
import { searchRecentSales } from '../../../../lib/sold-comps';
import { CardItemWithImages } from '../../../../lib/types';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await requireSession();
  if (isUnauthorized(session)) return session;

  const body = await request.json().catch(() => null);
  const card = body?.card as CardItemWithImages | undefined;
  if (!card || typeof card !== 'object') {
    return NextResponse.json({ success: false, error: 'Missing card' }, { status: 400 });
  }
  if (!isReadyForSoldComps(card)) {
    return NextResponse.json({ success: true, data: { ready: false, sales: [], searchUrl: null } });
  }

  const lookup = await searchRecentSales({ ...card, images: card.images ?? [] });
  return NextResponse.json({ success: true, data: { ready: true, ...lookup } });
}
