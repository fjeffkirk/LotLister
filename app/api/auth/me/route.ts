import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/auth/me - Current signed-in user
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 });
  }
  return NextResponse.json({ success: true, data: { username: user.username } });
}
