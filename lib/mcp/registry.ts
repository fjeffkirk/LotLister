import type { McpScope } from './oauth';

export type McpEffect = 'read' | 'draft';

export interface McpContext {
  accountId: string;
  scopes: McpScope[];
}

export interface LotlisterTool {
  name: string;
  description: string;
  /** read tools need lotlister.read. draft tools need lotlister.drafts. Nothing else can be registered. */
  effect: McpEffect;
  inputSchema: Record<string, unknown>;
  handler: (ctx: McpContext, args: Record<string, unknown>) => Promise<unknown>;
}

const tools: LotlisterTool[] = [];

const BLOCKED_NAME = /delete|destroy|remove|publish|activate|unlist|drop/i;

/**
 * Register a tool on the single /mcp endpoint.
 * Add a new integration by calling this from lib/mcp/tools and importing that file
 * from lib/mcp/tools/index.ts. Do not add a second MCP URL.
 * Publishing and destructive tools are rejected here until a future change allows them.
 */
export function registerTool(tool: LotlisterTool): void {
  if (tool.effect !== 'read' && tool.effect !== 'draft') {
    throw new Error(`Tool ${tool.name} uses an effect this server does not allow`);
  }
  if (BLOCKED_NAME.test(tool.name)) {
    throw new Error(`Tool ${tool.name} is not available. Publishing and destructive actions are not registered.`);
  }
  if (tools.some((existing) => existing.name === tool.name)) {
    throw new Error(`Tool ${tool.name} is already registered`);
  }
  tools.push(tool);
}

export function listTools(scopes: readonly string[]): LotlisterTool[] {
  return tools.filter((tool) => scopes.includes(scopeFor(tool.effect)));
}

export function findTool(name: string): LotlisterTool | undefined {
  return tools.find((tool) => tool.name === name);
}

export function scopeFor(effect: McpEffect): McpScope {
  return effect === 'draft' ? 'lotlister.drafts' : 'lotlister.read';
}
