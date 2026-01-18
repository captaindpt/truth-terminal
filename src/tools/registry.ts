import type { Tool } from './types.js';
import type { ToolOutput } from '../core/types.js';

export type ToolSummary = Pick<Tool, 'name' | 'description' | 'parameters'>;

import { coingeckoPriceTool } from './coingecko-price.js';
import { gdeltNewsTool } from './gdelt-news.js';
import { grokSearchTool } from './grok-search.js';
import { nasdaqCandlesTool } from './nasdaq-candles.js';
import { nasdaqQuoteTool } from './nasdaq-quote.js';
import { polymarketBookTool } from './polymarket-book.js';
import { polymarketTradesTool } from './polymarket-trades.js';

const tools: Tool[] = [grokSearchTool, gdeltNewsTool, polymarketTradesTool, polymarketBookTool, coingeckoPriceTool, nasdaqQuoteTool, nasdaqCandlesTool];

export function listTools(): Tool[] {
  return tools.slice();
}

export function listToolSummaries(): ToolSummary[] {
  return tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

export function getTool(name: string): Tool | null {
  const wanted = name.trim();
  if (!wanted) return null;
  return tools.find((t) => t.name === wanted) ?? null;
}

export function renderToolResult(tool: Tool, result: unknown): ToolOutput[] {
  if (tool.render) return tool.render(result);
  return [{ kind: 'json', title: tool.name, value: result }];
}
