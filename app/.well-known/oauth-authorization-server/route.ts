import { NextRequest, NextResponse } from 'next/server';
import { MCP_SCOPES, publicOrigin } from '../../../lib/mcp/oauth';

export function GET(request: NextRequest) {
  const origin = publicOrigin(request.nextUrl.origin);
  return NextResponse.json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: MCP_SCOPES,
  });
}
