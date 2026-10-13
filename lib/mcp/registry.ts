import type { McpScope } from './oauth';

export type McpEffect = 'read' | 'draft' | 'price' | 'youtube';

export interface McpContext {
  accountId: string;
  scopes: McpScope[];
}

export interface LotlisterTool {
  name: string;
  description: string;
  /** read tools need lotlister.read. draft tools need lotlister.drafts. price tools need lotlister.prices. youtube tools need lotlister.youtube. */
  effect: McpEffect;
  readOnly?: boolean;
  idempotent?: boolean;
  openWorld?: boolean;
  inputSchema: Record<string, unknown>;
  handler: (ctx: McpContext, args: Record<string, unknown>) => Promise<unknown>;
}

const tools: LotlisterTool[] = [];

const DESTRUCTIVE_NAME = /delete|destroy|remove|drop/i;
const PUBLISH_NAME = /publish|activate|unlist/i;

/**
 * Register a tool on the single /mcp endpoint.
 * Add a new integration by calling this from lib/mcp/tools and importing that file
 * from lib/mcp/tools/index.ts. Do not add a second MCP URL.
 * eBay/Etsy publishing and every delete stay blocked. YouTube publish tools are the exception.
 */
export function registerTool(tool: LotlisterTool): void {
  if (tool.effect !== 'read' && tool.effect !== 'draft' && tool.effect !== 'price' && tool.effect !== 'youtube') {
    throw new Error(`Tool ${tool.name} uses an effect this server does not allow`);
  }
  if (DESTRUCTIVE_NAME.test(tool.name) || (PUBLISH_NAME.test(tool.name) && !tool.name.startsWith('youtube_'))) {
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
  if (effect === 'draft') return 'lotlister.drafts';
  if (effect === 'price') return 'lotlister.prices';
  if (effect === 'youtube') return 'lotlister.youtube';
  return 'lotlister.read';
}
