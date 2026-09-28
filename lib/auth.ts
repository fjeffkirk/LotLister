import { cookies } from 'next/headers';
import prisma from './prisma';
import { getSessionSecret, SESSION_COOKIE, verifySession } from './session';

export interface CurrentUser {
  /** Account key stored in Lot.userEmail / User.email: the eBay user id. */
  accountId: string;
  username: string;
}

/**
 * Signed-in user from the session cookie. The eBay connection must still exist, so an eBay
 * account deletion notification ends the session immediately.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const secret = getSessionSecret();
  if (!secret) return null;

  const cookieStore = await cookies();
  const session = verifySession(cookieStore.get(SESSION_COOKIE)?.value, secret);
  if (!session) return null;

  const connection = await prisma.ebayConnection.findUnique({
    where: { userEmail: session.sub },
    select: { ebayUsername: true },
  });
  if (!connection) return null;

  return { accountId: session.sub, username: connection.ebayUsername || session.username };
}

/**
 * Account key for workspace isolation. Named for the column it fills (Lot.userEmail),
 * which now holds the eBay user id rather than an email.
 */
export async function getUserEmail(): Promise<string | null> {
  const user = await getCurrentUser();
  return user?.accountId ?? null;
}

export async function requireUserEmail(): Promise<string> {
  const accountId = await getUserEmail();
  if (!accountId) {
    throw new Error('User email not set');
  }
  return accountId;
}
