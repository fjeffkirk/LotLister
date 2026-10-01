import { NextRequest, NextResponse } from 'next/server';
import { assertChatGptRedirect } from '../../../lib/mcp/oauth';
import { registerMcpClient } from '../../../lib/mcp/store';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { redirect_uris?: unknown; client_name?: unknown } | null;
  const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];
  if (uris.length === 0 || uris.length > 5) {
    return NextResponse.json({ error: 'invalid_client_metadata', error_description: 'A ChatGPT redirect URL is required' }, { status: 400 });
  }
  try {
    const redirectUris = uris.map((uri) => assertChatGptRedirect(String(uri)));
    const name = typeof body?.client_name === 'string' ? body.client_name.slice(0, 80) : null;
    const client = await registerMcpClient(name, redirectUris);
    return NextResponse.json({
      client_id: client.clientId,
      client_name: name ?? 'ChatGPT',
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: 'invalid_client_metadata',
      error_description: error instanceof Error ? error.message : 'Could not register',
    }, { status: 400 });
  }
}
