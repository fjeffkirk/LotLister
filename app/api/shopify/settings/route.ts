import { NextResponse } from 'next/server';
import { SyncMode } from '@prisma/client';
import { updateSettings } from '../../../../app/actions/settings';
import { prisma } from '../../../../lib/db';
import { isUnauthorized, requireSession } from '../../../../lib/require-session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (isUnauthorized(session)) return session;
  if (!prisma) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const row = await prisma.appSetting.findFirst({
    select: {
      shopifyShopDomain: true,
      shopifyShopName: true,
      lastSuccessfulSyncAt: true,
      defaultMarginPercent: true,
      lowStockDefaultThreshold: true,
      defaultReorderQuantity: true,
      averageFreeShippingCost: true,
      pollingIntervalMinutes: true,
      syncMode: true,
    },
  });
  return NextResponse.json({
    ok: true,
    settings: row
      ? { ...row, lastSuccessfulSyncAt: row.lastSuccessfulSyncAt?.toISOString() ?? null }
      : null,
  });
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (isUnauthorized(session)) return session;
  const body = await request.json().catch(() => null);
  const syncMode = body?.syncMode;
  if (syncMode !== SyncMode.manual && syncMode !== SyncMode.polling && syncMode !== SyncMode.webhook_ready) {
    return NextResponse.json({ ok: false, error: 'Invalid sync mode' }, { status: 400 });
  }
  try {
    const result = await updateSettings({
      defaultMarginPercent: Number(body.defaultMarginPercent),
      lowStockDefaultThreshold: Number(body.lowStockDefaultThreshold),
      defaultReorderQuantity: Number(body.defaultReorderQuantity),
      averageFreeShippingCost: Number(body.averageFreeShippingCost),
      pollingIntervalMinutes: Number(body.pollingIntervalMinutes),
      syncMode,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch {
    return NextResponse.json({ ok: false, error: 'Check the numbers and try again' }, { status: 400 });
  }
}
