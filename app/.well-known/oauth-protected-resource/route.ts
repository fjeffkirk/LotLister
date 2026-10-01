import { NextRequest, NextResponse } from 'next/server';
import { MCP_SCOPES, publicOrigin } from '../../../lib/mcp/oauth';

export function GET(request: NextRequest) {
  const origin = publicOrigin(request.nextUrl.origin);
  return NextResponse.json({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: MCP_SCOPES,
    bearer_methods_supported: ['header'],
  });
}
