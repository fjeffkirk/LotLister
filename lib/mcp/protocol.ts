import { ZodError } from 'zod';
import { findTool, listTools, scopeFor } from './registry';
import type { McpSession } from './store';
import './tools';

interface JsonRpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export interface McpDispatchResult {
  status: number;
  body: Record<string, unknown> | null;
}

function result(id: JsonRpc['id'], value: unknown): McpDispatchResult {
  return { status: 200, body: { jsonrpc: '2.0', id: id ?? null, result: value } };
}

function failure(id: JsonRpc['id'], code: number, message: string, status = 200): McpDispatchResult {
  return { status, body: { jsonrpc: '2.0', id: id ?? null, error: { code, message } } };
}

export async function dispatchMcp(message: JsonRpc, session: McpSession | null): Promise<McpDispatchResult> {
  if (message.jsonrpc !== '2.0' || !message.method) {
    return failure(message.id, -32600, 'Invalid request');
  }

  if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') {
    return { status: 202, body: null };
  }

  if (!session) return failure(message.id, -32001, 'Sign in required', 401);

  if (message.method === 'ping') return result(message.id, {});

  if (message.method === 'initialize') {
    const requested = typeof message.params === 'object' && message.params && 'protocolVersion' in message.params
      ? String((message.params as { protocolVersion?: string }).protocolVersion ?? '')
      : '';
    const protocolVersion = requested === '2025-06-18' || requested === '2025-03-26' ? requested : '2025-03-26';
    return result(message.id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'lotlister', version: '1.0.0' },
      instructions: 'Read store details and create unpublished Etsy drafts for cards or other physical products. Publishing and deleting are not available.',
    });
  }

  if (message.method === 'tools/list') {
    return result(message.id, {
      tools: listTools(session.scopes).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    });
  }

  if (message.method === 'tools/call') {
    const params = (message.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    const tool = params.name ? findTool(params.name) : undefined;
    if (!tool) return failure(message.id, -32602, 'Unknown tool');
    if (!session.scopes.includes(scopeFor(tool.effect))) {
      return result(message.id, {
        content: [{ type: 'text', text: 'This connection is not allowed to use that tool.' }],
        isError: true,
      });
    }
    try {
      const data = await tool.handler(session, params.arguments ?? {});
      return result(message.id, {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        isError: false,
      });
    } catch (error) {
      const messageText = error instanceof ZodError
        ? 'Missing or invalid arguments'
        : error instanceof Error
          ? error.message
          : 'Tool failed';
      return result(message.id, { content: [{ type: 'text', text: messageText }], isError: true });
    }
  }

  return failure(message.id, -32601, 'Method not found');
}
