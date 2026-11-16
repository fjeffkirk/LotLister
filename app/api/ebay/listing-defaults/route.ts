import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { getUserEmail } from '../../../../lib/auth';
import { getListingDefaults, saveListingDefaults } from '../../../../lib/ebay-shopify-live';

export const dynamic = 'force-dynamic';

export async function GET() {
  const userEmail = await getUserEmail();
  if (!userEmail) return NextResponse.json({ success: false, error: 'User email not set' }, { status: 401 });
  return NextResponse.json({ success: true, data: await getListingDefaults(userEmail) });
}

export async function POST(request: NextRequest) {
  const userEmail = await getUserEmail();
  if (!userEmail) return NextResponse.json({ success: false, error: 'User email not set' }, { status: 401 });
  try {
    const data = await saveListingDefaults(userEmail, await request.json());
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error ? error.message : 'Could not save eBay listing defaults';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
