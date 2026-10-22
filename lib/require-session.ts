import { NextResponse } from 'next/server';
import { getUserEmail } from './auth';
import { isShopifyAccountAllowed } from './shopify/access';

export async function requireSession(): Promise<{ email: string } | NextResponse> {
  const email = await getUserEmail();
  if (!email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  return { email };
}

export function isUnauthorized(value: { email: string } | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}

export async function requireShopifySession(): Promise<{ email: string } | NextResponse> {
  const session = await requireSession();
  if (isUnauthorized(session)) return session;
  if (!isShopifyAccountAllowed(session.email)) {
    return NextResponse.json({ error: 'Shopify access is not enabled for this account' }, { status: 403 });
  }
  return session;
}

/** Server Actions are independently callable; each must authorize before reading or writing. */
export async function requireShopifyAction(): Promise<void> {
  const session = await requireShopifySession();
  if (isUnauthorized(session)) throw new Error('Shopify access denied');
}
