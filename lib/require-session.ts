import { NextResponse } from 'next/server';
import { getUserEmail } from './auth';

export async function requireSession(): Promise<{ email: string } | NextResponse> {
  const email = await getUserEmail();
  if (!email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  return { email };
}

export function isUnauthorized(value: { email: string } | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}
