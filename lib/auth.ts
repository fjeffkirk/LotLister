import { cookies } from 'next/headers';

const COOKIE_NAME = 'lotlister_user_email';

/**
 * Get the user email from the cookie in an API route
 * Returns null if no email cookie is set
 */
export async function getUserEmail(): Promise<string | null> {
  const cookieStore = await cookies();
  const emailCookie = cookieStore.get(COOKIE_NAME);
  return emailCookie?.value?.toLowerCase().trim() || null;
}

/**
 * Require user email - throws error if not set
 * Use this in API routes that require authentication
 */
export async function requireUserEmail(): Promise<string> {
  const email = await getUserEmail();
  if (!email) {
    throw new Error('User email not set');
  }
  return email;
}
