import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserEmail } from '../../../../lib/auth';
import { getPublicBaseUrl } from '../../../../lib/ebay';
import { getEtsySettingsView } from '../../../../lib/etsy';
import prisma from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';

const saveSchema = z.object({
  shippingProfileId: z.string().max(40).optional(),
  readinessStateId: z.string().max(40).optional(),
  returnPolicyId: z.string().max(40).optional(),
  taxonomyId: z.string().max(20).optional(),
});

export async function GET(request: NextRequest) {
  const userEmail = await getUserEmail();
  if (!userEmail) return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 });
  const data = await getEtsySettingsView(userEmail);
  const base = getPublicBaseUrl(request.nextUrl.origin);
  return NextResponse.json({ success: true, data: { ...data, callbackUrl: `${base}/api/etsy/callback` } });
}

export async function POST(request: NextRequest) {
  const userEmail = await getUserEmail();
  if (!userEmail) return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 });
  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid Etsy settings' }, { status: 400 });
  const connection = await prisma.etsyConnection.findUnique({ where: { userEmail } });
  if (!connection) return NextResponse.json({ success: false, error: 'Connect an Etsy shop first' }, { status: 400 });
  const taxonomy = parsed.data.taxonomyId?.trim();
  const taxonomyId = taxonomy && /^\d+$/.test(taxonomy) ? Number(taxonomy) : null;
  await prisma.etsyConnection.update({
    where: { userEmail },
    data: {
      shippingProfileId: parsed.data.shippingProfileId?.trim() || null,
      readinessStateId: parsed.data.readinessStateId?.trim() || null,
      returnPolicyId: parsed.data.returnPolicyId?.trim() || null,
      taxonomyId,
    },
  });
  return NextResponse.json({ success: true });
}
