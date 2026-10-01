import { createHash, timingSafeEqual } from 'crypto';

/** Scopes this server will ever grant. Publishing is intentionally absent. */
export const MCP_SCOPES = ['lotlister.read', 'lotlister.drafts'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

const REDIRECT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function secretsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function grantedScopes(requested: string | null | undefined): McpScope[] {
  const asked = (requested ?? '')
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  const allowed = new Set<string>(MCP_SCOPES);
  const picked = asked.filter((scope): scope is McpScope => allowed.has(scope));
  return picked.length > 0 ? picked : [...MCP_SCOPES];
}

/** ChatGPT's connector redirect hosts only. Prevents an open redirect after sign-in. */
export function assertChatGptRedirect(uri: string): string {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new Error('Redirect URL is not valid');
  }
  if (url.protocol !== 'https:' || !REDIRECT_HOSTS.has(url.hostname)) {
    throw new Error('Redirect URL is not a ChatGPT connector address');
  }
  return url.toString();
}

export function publicOrigin(requestOrigin: string): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return (fromEnv || requestOrigin).replace(/\/$/, '');
}
