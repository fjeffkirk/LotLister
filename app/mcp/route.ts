import { NextRequest } from 'next/server';
import { dispatchMcp } from '../../lib/mcp/protocol';
import { publicOrigin } from '../../lib/mcp/oauth';
import { sessionFromAccessToken } from '../../lib/mcp/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ALLOWED_ORIGINS = new Set(['https://chatgpt.com', 'https://chat.openai.com']);

function challenge(origin: string): string {
  return `Bearer realm="lotlister", resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
}

function corsHeaders(request: NextRequest, origin: string): Headers {
  const headers = new Headers();
  const requestOrigin = request.headers.get('origin');
  if (requestOrigin && (requestOrigin === origin || ALLOWED_ORIGINS.has(requestOrigin))) {
    headers.set('Access-Control-Allow-Origin', requestOrigin);
    headers.set('Vary', 'Origin');
  }
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id');
  headers.set('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  return headers;
}

function originAllowed(request: NextRequest, origin: string): boolean {
  const requestOrigin = request.headers.get('origin');
  if (!requestOrigin) return true;
  return requestOrigin === origin || ALLOWED_ORIGINS.has(requestOrigin);
}

export function OPTIONS(request: NextRequest) {
  const origin = publicOrigin(request.nextUrl.origin);
  return new Response(null, { status: 204, headers: corsHeaders(request, origin) });
}

export async function POST(request: NextRequest) {
  const origin = publicOrigin(request.nextUrl.origin);
  const headers = corsHeaders(request, origin);
  if (!originAllowed(request, origin)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers });
  }

  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
  const session = token ? await sessionFromAccessToken(token) : null;
  if (!session) {
    headers.set('WWW-Authenticate', challenge(origin));
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ error: 'Sign in required' }), { status: 401, headers });
  }

  let message: unknown;
  try {
    message = await request.json();
  } catch {
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }), {
      status: 400,
      headers,
    });
  }
  if (Array.isArray(message) || !message || typeof message !== 'object') {
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }), {
      status: 400,
      headers,
    });
  }

  const dispatched = await dispatchMcp(message as { jsonrpc?: string; id?: string | number | null; method?: string; params?: unknown }, session);
  if (dispatched.status === 202 || !dispatched.body) {
    return new Response(null, { status: 202, headers });
  }

  const accept = request.headers.get('accept') ?? '';
  if (accept.includes('text/event-stream')) {
    headers.set('Content-Type', 'text/event-stream');
    headers.set('Cache-Control', 'no-cache, no-transform');
    return new Response(`event: message\ndata: ${JSON.stringify(dispatched.body)}\n\n`, { status: 200, headers });
  }
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(dispatched.body), { status: dispatched.status, headers });
}

export function GET() {
  return new Response('LotLister MCP uses POST', { status: 405, headers: { Allow: 'POST, OPTIONS' } });
}

export function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: 'POST, OPTIONS' } });
}
