import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TerminalCore } from '../core/index.js';
import type { CommandContext, CommandSpec } from '../core/types.js';
import { edgarCommand, grokCommand } from '../integrations/index.js';
import type { MarketMeta } from '../manipulation/types.js';
import { db as polyDb, getStats as getPolyStats, getMarketMeta, saveMarketMeta } from '../manipulation/db.js';
import { cancelOrder, computeSlippageMetrics, createFill, createOrder, listFills, listOrderHistory, listPendingOrders } from '../execution/db.js';
import { fetchGdeltNewsWithMeta } from '../tools/providers/gdelt.js';
import { getNasdaqCandlesWithMeta, getNasdaqQuoteWithMeta } from '../tools/providers/nasdaq.js';
import {
  db as truthDb,
  createAlert,
  createInfoEvent,
  createPosition,
  createRule,
  deleteConviction,
  deleteInfoEvent,
  deletePosition,
  deleteRule,
  getConvictionByMarketId,
  getMarketByExternalId,
  listAlertsWithMarkets,
  listConvictionsWithMarkets,
  listInfoEventsWithMarkets,
  listPositionsWithMarkets,
  listRulesWithMarkets,
  markAlertsSeen,
  setRuleEvaluated,
  updateInfoEvent,
  updatePosition,
  updateRule,
  upsertConvictionByMarketId,
  upsertMarket,
  type ConvictionStatus,
  type MarketSource,
  type RuleStatus
} from '../db/index.js';
import { getTool, listToolSummaries, listTools, renderToolResult } from '../tools/index.js';
import Anthropic from '@anthropic-ai/sdk';

type ChatRole = 'user' | 'assistant';
type ChatMessage = { role: ChatRole; text: string; ts: number };
type ToolEvent = {
  id: string;
  type: 'tool';
  title: string;
  command: string;
  outputs: unknown;
  targetWindow: string;
  meta?: { durationMs: number };
  ts: number;
};

type ChatSession = {
  id: string;
  messages: ChatMessage[];
  events: ToolEvent[];
};

const sessions = new Map<string, ChatSession>();
const anthropic = new Anthropic();

function buildContext(): CommandContext {
  return { now: new Date(), env: process.env };
}

type PolymarketFeedItem = {
  id: string;
  timestamp: number;
  marketId: string;
  wallet: string;
  side: string;
  outcome: string;
  size: number;
  price: number;
  question: string;
  category: string;
};

const DATA_API_BASE = 'https://data-api.polymarket.com';
const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';
const polyMarketCache = new Map<string, MarketMeta>();
let polyTradeTitleCache: { ts: number; map: Map<string, { title: string; slug: string }> } = { ts: 0, map: new Map() };

type MarketPrices = {
  mid: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  lastTrade: number | null;
  asOf: number;
  source: string;
};

const gammaPriceCache = new Map<string, { ts: number; prices: MarketPrices }>();

type GammaMarket = {
  id: string;
  conditionId: string;
  slug: string;
  question: string;
  endDate: string;
  outcomes: string; // JSON
  outcomePrices: string; // JSON
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
  clobTokenIds?: string; // JSON
};

const gammaMarketCache = new Map<string, { ts: number; market: GammaMarket | null }>();

async function fetchGammaMarketByConditionId(conditionId: string): Promise<GammaMarket | null> {
  const cached = gammaMarketCache.get(conditionId);
  const now = Date.now();
  if (cached && now - cached.ts < 10_000) return cached.market;

  const url = new URL(`${GAMMA_API_BASE}/markets`);
  url.searchParams.set('limit', '1');
  // `condition_ids` is the most reliable filter; `conditionId` doesn't match all markets.
  url.searchParams.set('condition_ids', conditionId);
  url.searchParams.set('conditionId', conditionId);
  const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    gammaMarketCache.set(conditionId, { ts: now, market: null });
    return null;
  }
  const arr = (await response.json()) as any[];
  const market = arr && arr.length ? (arr[0] as GammaMarket) : null;
  gammaMarketCache.set(conditionId, { ts: now, market });
  return market;
}

function parseGammaJsonArray(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

function parseGammaJsonNumberArray(raw: unknown): number[] {
  try {
    const parsed = JSON.parse(String(raw ?? '[]'));
    if (!Array.isArray(parsed)) return [];
    const out: number[] = [];
    for (const x of parsed) {
      const n = Number(x);
      if (Number.isFinite(n)) out.push(n);
    }
    return out;
  } catch {
    return [];
  }
}

function findOutcomeIndex(outcomes: string[], outcome: 'YES' | 'NO'): number {
  const target = outcome.toLowerCase();
  const idx = outcomes.findIndex((o) => String(o).trim().toLowerCase() === target);
  if (idx >= 0) return idx;
  // Fallback for binary markets (often ["Yes","No"])
  if (outcomes.length >= 2) return outcome === 'YES' ? 0 : 1;
  return 0;
}

async function fetchGammaYesPrices(conditionId: string): Promise<MarketPrices> {
  const cached = gammaPriceCache.get(conditionId);
  const now = Date.now();
  if (cached && now - cached.ts < 10_000) return cached.prices;

  const market = await fetchGammaMarketByConditionId(conditionId);
  if (!market) {
    const prices: MarketPrices = { mid: null, bestBid: null, bestAsk: null, lastTrade: null, asOf: now, source: 'gamma_not_found' };
    gammaPriceCache.set(conditionId, { ts: now, prices });
    return prices;
  }

  const outcomes = parseGammaJsonArray(market.outcomes);
  const outcomePrices = parseGammaJsonNumberArray(market.outcomePrices);

  const yesIndex = findOutcomeIndex(outcomes, 'YES');
  const yesMidFromArray = yesIndex >= 0 && Number.isFinite(outcomePrices[yesIndex]!) ? outcomePrices[yesIndex]! : null;

  const bestBid = typeof (market as any)?.bestBid === 'number' ? Number((market as any).bestBid) : null;
  const bestAsk = typeof (market as any)?.bestAsk === 'number' ? Number((market as any).bestAsk) : null;
  const lastTrade = typeof (market as any)?.lastTradePrice === 'number' ? Number((market as any).lastTradePrice) : null;

  const mid =
    bestBid != null && bestAsk != null && Number.isFinite(bestBid) && Number.isFinite(bestAsk)
      ? (bestBid + bestAsk) / 2
      : lastTrade != null && Number.isFinite(lastTrade)
        ? lastTrade
        : yesMidFromArray;

  const prices: MarketPrices = { mid: mid ?? null, bestBid: bestBid ?? null, bestAsk: bestAsk ?? null, lastTrade: lastTrade ?? null, asOf: now, source: 'gamma' };
  gammaPriceCache.set(conditionId, { ts: now, prices });
  return prices;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

function fmtPct(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return '—';
  return `${(p * 100).toFixed(1)}%`;
}

let ruleEngineRunning = false;

async function runRuleEngineOnce(): Promise<void> {
  if (ruleEngineRunning) return;
  ruleEngineRunning = true;
  try {
    const rows = listRulesWithMarkets({ status: 'active', limit: 500 });
    if (!rows.length) return;
    const now = Date.now();

    await mapLimit(rows, 8, async ({ rule, market }) => {
      try {
        if (market.source !== 'polymarket') {
          setRuleEvaluated(rule.id, { lastEvaluatedAt: now });
          return;
        }

        const prices = await fetchGammaYesPrices(market.externalId);
        const mid = prices.mid;
        setRuleEvaluated(rule.id, { lastEvaluatedAt: now });
        if (mid == null || !Number.isFinite(mid)) return;

        if (rule.minMyProbability != null) {
          const conviction = getConvictionByMarketId(rule.marketId);
          if (!conviction) return;
          if (conviction.myProbability < rule.minMyProbability) return;
        }

        const hit =
          rule.type === 'price_below'
            ? mid <= rule.priceThreshold
            : rule.type === 'price_above'
              ? mid >= rule.priceThreshold
              : false;

        if (!hit) return;

        const name = market.question || market.externalId;
        const cond = rule.type === 'price_below' ? '≤' : '≥';
        const message = `${name} YES mid ${fmtPct(mid)} ${cond} ${fmtPct(rule.priceThreshold)}`;
        createAlert({ ruleId: rule.id, marketId: rule.marketId, message });
        setRuleEvaluated(rule.id, { status: 'triggered', triggeredAt: now, lastEvaluatedAt: now });
      } catch {
        // best-effort; rule evaluation should not take down the UI server
      }
    });
  } finally {
    ruleEngineRunning = false;
  }
}

function polymarketCategoryFromSlug(slug: string): string {
  const s = String(slug || '').toLowerCase();
  if (!s) return '';
  if (s.startsWith('eth-') || s.startsWith('btc-')) return 'crypto';
  if (s.startsWith('nhl-') || s.startsWith('nba-') || s.startsWith('nfl-')) return 'sports';
  if (s.includes('trump') || s.includes('biden') || s.includes('election')) return 'politics';
  if (s.includes('musk') || s.includes('elon')) return 'tech-personalities';
  return 'uncategorized';
}

type DataAPITrade = {
  proxyWallet: string;
  side: 'BUY' | 'SELL';
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number;
  title: string;
  slug: string;
  eventSlug: string;
  outcome: string;
  transactionHash: string;
};

let polyLiveCache: { ts: number; items: PolymarketFeedItem[] } = { ts: 0, items: [] };

function normalizeLiveTrade(t: DataAPITrade): PolymarketFeedItem | null {
  const marketId = typeof t?.conditionId === 'string' ? t.conditionId : '';
  const wallet = typeof t?.proxyWallet === 'string' ? t.proxyWallet : '';
  const tx = typeof t?.transactionHash === 'string' ? t.transactionHash : '';
  const asset = typeof t?.asset === 'string' ? t.asset : '';
  if (!marketId || !wallet || !tx) return null;

  const id = `${tx}_${asset ? asset.slice(-8) : 'trade'}`;
  const timestamp = Number(t?.timestamp) * 1000;
  const title = typeof t?.title === 'string' ? t.title : '';
  const slug = typeof t?.slug === 'string' ? t.slug : '';

  return {
    id,
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    marketId,
    wallet,
    side: String(t?.side || ''),
    outcome: String(t?.outcome || ''),
    size: Number(t?.size || 0),
    price: Number(t?.price || 0),
    question: title,
    category: polymarketCategoryFromSlug(slug)
  };
}

async function fetchPolymarketLiveWindow(limit: number): Promise<PolymarketFeedItem[]> {
  const now = Date.now();
  if (polyLiveCache.items.length && now - polyLiveCache.ts < 2_000) return polyLiveCache.items;

  const max = Math.max(1, Math.min(500, limit));
  const response = await fetch(`${DATA_API_BASE}/trades?limit=${max}`);
  if (!response.ok) throw new Error(`Polymarket Data API HTTP ${response.status}`);
  const raw = (await response.json()) as DataAPITrade[];

  const items: PolymarketFeedItem[] = [];
  for (const t of raw) {
    const item = normalizeLiveTrade(t);
    if (!item) continue;
    // Skip dust trades; UI feed should be signal-y.
    if (Number.isFinite(item.size) && item.size < 1) continue;
    items.push(item);
  }

  items.sort((a, b) => b.timestamp - a.timestamp);
  polyLiveCache = { ts: now, items };
  return items;
}

async function fetchTradeTitleMap(): Promise<Map<string, { title: string; slug: string }>> {
  const now = Date.now();
  if (now - polyTradeTitleCache.ts < 60_000 && polyTradeTitleCache.map.size) return polyTradeTitleCache.map;

  try {
    const response = await fetch(`${DATA_API_BASE}/trades?limit=500`);
    if (!response.ok) return polyTradeTitleCache.map;
    const trades = (await response.json()) as any[];
    const map = new Map<string, { title: string; slug: string }>();
    for (const t of trades) {
      const id = typeof t?.conditionId === 'string' ? t.conditionId : '';
      const title = typeof t?.title === 'string' ? t.title : '';
      if (!id || !title) continue;
      map.set(id, { title, slug: typeof t?.slug === 'string' ? t.slug : '' });
    }
    polyTradeTitleCache = { ts: now, map };
    return map;
  } catch {
    return polyTradeTitleCache.map;
  }
}

async function fetchGammaMarketMeta(marketId: string): Promise<MarketMeta | null> {
  const cached = polyMarketCache.get(marketId);
  if (cached && Date.now() - cached.fetchedAt < 24 * 60 * 60 * 1000) return cached;

  const fromDb = getMarketMeta(marketId);
  if (fromDb && Date.now() - fromDb.fetchedAt < 24 * 60 * 60 * 1000) {
    polyMarketCache.set(marketId, fromDb);
    return fromDb;
  }

  try {
    const url = new URL(`${GAMMA_API_BASE}/markets`);
    url.searchParams.set('limit', '1');
    url.searchParams.set('condition_ids', marketId);
    url.searchParams.set('conditionId', marketId);
    const response = await fetch(url.toString());
    if (!response.ok) return null;
    const arr = (await response.json()) as any[];
    const data: any = arr && arr.length ? arr[0] : null;
    if (!data) return null;
    const meta: MarketMeta = {
      id: marketId,
      question: typeof data?.question === 'string' ? data.question : 'Unknown',
      category: typeof data?.category === 'string' && data.category.trim() ? data.category : 'uncategorized',
      endDate: typeof data?.endDate === 'string' ? data.endDate : '',
      fetchedAt: Date.now()
    };
    saveMarketMeta(meta);
    polyMarketCache.set(marketId, meta);
    return meta;
  } catch {
    return null;
  }
}

async function ensureMarketMetaForFeed(marketIds: string[], cap: number): Promise<void> {
  const unique = Array.from(new Set(marketIds)).filter(Boolean);
  const toFetch: string[] = [];
  for (const id of unique) {
    const cached = polyMarketCache.get(id);
    if (cached && Date.now() - cached.fetchedAt < 24 * 60 * 60 * 1000) continue;
    const fromDb = getMarketMeta(id);
    if (fromDb && Date.now() - fromDb.fetchedAt < 24 * 60 * 60 * 1000) {
      polyMarketCache.set(id, fromDb);
      continue;
    }
    toFetch.push(id);
    if (toFetch.length >= cap) break;
  }

  const titleMap = await fetchTradeTitleMap();
  const fromTrades: string[] = [];

  for (const id of toFetch) {
    const info = titleMap.get(id);
    if (!info?.title) continue;

    let category = 'uncategorized';
    const slug = info.slug.toLowerCase();
    if (slug.startsWith('eth-') || slug.startsWith('btc-')) category = 'crypto';
    else if (slug.startsWith('nhl-') || slug.startsWith('nba-') || slug.startsWith('nfl-')) category = 'sports';
    else if (slug.includes('trump') || slug.includes('biden') || slug.includes('election')) category = 'politics';
    else if (slug.includes('musk') || slug.includes('elon')) category = 'tech-personalities';

    const meta: MarketMeta = { id, question: info.title, category, endDate: '', fetchedAt: Date.now() };
    saveMarketMeta(meta);
    polyMarketCache.set(id, meta);
    fromTrades.push(id);
  }

  const remaining = toFetch.filter((id) => !fromTrades.includes(id));
  await Promise.allSettled(remaining.map((id) => fetchGammaMarketMeta(id)));
}

function helpCommand(getCommands: () => CommandSpec[]): CommandSpec {
  return {
    name: 'help',
    description: 'Show help',
    usage: 'help',
    handler: async () => {
      const commands = [...getCommands()].sort((a, b) => a.name.localeCompare(b.name));
      return [
        {
          kind: 'table',
          title: 'Commands',
          columns: ['command', 'usage', 'description'],
          rows: commands.map((c) => [c.name, c.usage, c.description])
        }
      ];
    }
  };
}

function buildCore(): TerminalCore {
  const commands: CommandSpec[] = [];
  commands.push(helpCommand(() => commands));
  commands.push(grokCommand());
  commands.push(edgarCommand());
  return new TerminalCore(commands);
}

function getOrCreateSession(sessionId: string): ChatSession {
  const existing = sessions.get(sessionId);
  if (existing) return existing;
  const created: ChatSession = { id: sessionId, messages: [], events: [] };
  sessions.set(sessionId, created);
  return created;
}

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function safeJson(value: unknown, maxChars: number): string {
  let text = '';
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…(truncated ${text.length - maxChars} chars)`;
}

function buildAgentSystemPrompt(): string {
  const toolLines = listTools()
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n');

  return [
    'You are Truth Terminal: a concise real-time research assistant.',
    '',
    'Use tools to fetch live data when needed. Be cost-aware: Grok search can be expensive.',
    'Do not hallucinate; if you cannot fetch data, say so.',
    '',
    'Available tools:',
    toolLines || '(none)',
    '',
    'Output style: short bullets, numbers, and clear next actions.'
  ].join('\n');
}

type LlmReplyResult = { assistantText: string; toolEvents: ToolEvent[] };

async function llmReplyWithTools(messages: ChatMessage[]): Promise<LlmReplyResult> {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (!hasKey) {
    return {
      assistantText:
        'Set ANTHROPIC_API_KEY to enable the agent. Meanwhile you can run tools via /exec, e.g. "/exec grok <query>" or "/exec edgar filings AAPL 5".',
      toolEvents: []
    };
  }

  const model = process.env.TT_AGENT_MODEL || 'claude-sonnet-4-20250514';
  const baseMessages = messages.slice(-20).map((m) => ({
    role: m.role,
    content: m.text
  })) as Array<{ role: 'user' | 'assistant'; content: string }>;

  const tools = listTools().map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters
  }));

  const system = buildAgentSystemPrompt();
  const toolEvents: ToolEvent[] = [];

  let chain: any[] = baseMessages;
  let rounds = 0;
  let toolCalls = 0;
  const maxRounds = 6;
  const maxToolCalls = 12;

  try {
    while (rounds++ < maxRounds) {
      const response: any = await anthropic.messages.create({
        model,
        max_tokens: 900,
        system,
        tools,
        messages: chain
      } as any);

      const contentBlocks: any[] = Array.isArray(response?.content) ? response.content : [];
      const toolUses: any[] = contentBlocks.filter((b) => b && b.type === 'tool_use');

      if (!toolUses.length) {
        const text = contentBlocks
          .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text)
          .join('')
          .trim();

        if (!text) throw new Error('No text response from Claude');
        return { assistantText: text, toolEvents };
      }

      toolCalls += toolUses.length;
      if (toolCalls > maxToolCalls) {
        return { assistantText: 'Tool call limit reached. Narrow the query and try again.', toolEvents };
      }

      const toolResultBlocks: any[] = await Promise.all(
        toolUses.map(async (tu) => {
          const toolUseId = typeof tu?.id === 'string' ? tu.id : newId('tooluse');
          const toolName = typeof tu?.name === 'string' ? tu.name : '';
          const toolInput = tu?.input ?? {};

          const tool = toolName ? getTool(toolName) : null;
          if (!tool) {
            const message = `Unknown tool: ${toolName || '(missing name)'}`;
            toolEvents.push({
              id: newId('tool'),
              type: 'tool',
              title: toolName || 'tool',
              command: safeJson(toolInput, 240),
              outputs: [{ kind: 'error', message }],
              targetWindow: 'intel',
              meta: { durationMs: 0 },
              ts: Date.now()
            });
            return { type: 'tool_result', tool_use_id: toolUseId, is_error: true, content: message };
          }

          const startedAt = Date.now();
          try {
            const result = await tool.execute(toolInput);
            const durationMs = Date.now() - startedAt;
            toolEvents.push({
              id: newId('tool'),
              type: 'tool',
              title: tool.name,
              command: safeJson(toolInput, 240),
              outputs: renderToolResult(tool, result),
              targetWindow: tool.targetWindow || 'intel',
              meta: { durationMs },
              ts: Date.now()
            });
            return { type: 'tool_result', tool_use_id: toolUseId, content: safeJson(result, 12_000) };
          } catch (err) {
            const durationMs = Date.now() - startedAt;
            const message = err instanceof Error ? err.message : String(err);
            toolEvents.push({
              id: newId('tool'),
              type: 'tool',
              title: tool.name,
              command: safeJson(toolInput, 240),
              outputs: [{ kind: 'error', message }],
              targetWindow: tool.targetWindow || 'intel',
              meta: { durationMs },
              ts: Date.now()
            });
            return { type: 'tool_result', tool_use_id: toolUseId, is_error: true, content: message };
          }
        })
      );

      chain = [...chain, { role: 'assistant', content: contentBlocks }, { role: 'user', content: toolResultBlocks }];
    }

    return { assistantText: 'Agent ran out of tool rounds. Narrow the query and try again.', toolEvents };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      assistantText: `Agent unavailable right now (${message}). Use /exec to run tools, e.g. "/exec grok <query>" or "/exec edgar filings AAPL 5".`,
      toolEvents
    };
  }
}

function json(res: any, statusCode: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(data));
  res.end(data);
}

type NewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
};

const binanceSymbolsCache = { ts: 0, symbols: [] as string[] };

function sanitizeSymbol(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (!s) return '';
  if (!/^[A-Z0-9.\-=_^]{1,15}$/.test(s)) return '';
  return s;
}

type ClobLevel = { price: number; size: number };
type ClobBook = { bids: ClobLevel[]; asks: ClobLevel[]; tokenId: string; ts: number };
const polyBookCache = new Map<string, { ts: number; book: ClobBook }>();

async function fetchPolymarketClobBook(tokenId: string, depth: number): Promise<ClobBook> {
  const key = `${tokenId}::${depth}`;
  const cached = polyBookCache.get(key);
  const now = Date.now();
  if (cached && now - cached.ts < 1_000) return cached.book;

  const response = await fetch(`https://clob.polymarket.com/book?token_id=${encodeURIComponent(tokenId)}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Polymarket CLOB HTTP ${response.status}`);
  const raw = (await response.json()) as any;

  const bidsRaw = Array.isArray(raw?.bids) ? raw.bids : [];
  const asksRaw = Array.isArray(raw?.asks) ? raw.asks : [];

  const bids: ClobLevel[] = [];
  for (const r of bidsRaw) {
    const p = Number(r?.price);
    const s = Number(r?.size);
    if (!Number.isFinite(p) || !Number.isFinite(s)) continue;
    bids.push({ price: p, size: s });
  }
  bids.sort((a, b) => b.price - a.price);

  const asks: ClobLevel[] = [];
  for (const r of asksRaw) {
    const p = Number(r?.price);
    const s = Number(r?.size);
    if (!Number.isFinite(p) || !Number.isFinite(s)) continue;
    asks.push({ price: p, size: s });
  }
  asks.sort((a, b) => a.price - b.price);

  const book: ClobBook = { bids: bids.slice(0, depth), asks: asks.slice(0, depth), tokenId, ts: now };
  polyBookCache.set(key, { ts: now, book });
  return book;
}

async function fetchGdeltNews(query: string, limit: number): Promise<{ items: NewsItem[]; meta: { cached: boolean; shared: boolean; durationMs: number; timeoutMs: number } }> {
  const { items, meta } = await fetchGdeltNewsWithMeta(query, limit);
  return { items: items.map((i) => ({ id: newId('news'), ...i })), meta };
}

function notFound(res: any): void {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Not found');
}

function contentTypeForPath(pathname: string): string {
  const ext = extname(pathname).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

async function readJson(req: any): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Prefer serving the repo's `web/` folder when available, even when running the compiled server from `dist/`.
// Fallback to the legacy relative path for cases where `process.cwd()` isn't the repo root (e.g. packaged deploys).
const WEB_ROOT = existsSync(join(process.cwd(), 'web')) ? join(process.cwd(), 'web') : join(__dirname, '..', '..', 'web');

async function serveStatic(req: any, res: any, pathname: string): Promise<void> {
  const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (relPath.includes('..')) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Bad request');
    return;
  }

  const filePath = join(WEB_ROOT, relPath);

  try {
    const bytes = await readFile(filePath);
    res.statusCode = 200;
    res.setHeader('Content-Type', contentTypeForPath(filePath));
    res.setHeader('Cache-Control', 'no-store');
    res.end(bytes);
  } catch {
    notFound(res);
  }
}

async function main(): Promise<void> {
  const core = buildCore();

  const port = Number(process.env.TT_UI_PORT || 7777);
  const host = process.env.TT_UI_HOST || '127.0.0.1';

  // Rule engine (alerts-only, v1): evaluate continuously while the UI server runs.
  runRuleEngineOnce().catch(() => {
    // ignore
  });
  setInterval(() => {
    runRuleEngineOnce().catch(() => {
      // ignore
    });
  }, 5000);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      let pathname = url.pathname;
      // Normalize trailing slashes so `/api/foo` and `/api/foo/` behave the same.
      if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');

      if (pathname === '/api/health') {
        return json(res, 200, { ok: true });
      }

      if (pathname === '/api/exec' && req.method === 'POST') {
        const body = await readJson(req);
        const line = typeof body?.line === 'string' ? body.line : '';
        const outputs = await core.execute(line, buildContext());
        return json(res, 200, outputs);
      }

      if (pathname === '/api/news' && req.method === 'GET') {
        let query = url.searchParams.get('q') || '';
        const limit = Number(url.searchParams.get('limit') || '20');
        const max = Number.isFinite(limit) ? Math.max(1, Math.min(50, limit)) : 20;

        const trimmed = query.trim();
        if (trimmed.length > 0 && trimmed.length < 3) {
          if (trimmed.toLowerCase() === 'ai') query = 'artificial intelligence';
          else {
            return json(res, 400, { ok: false, error: 'Query too short; use a longer phrase (e.g. "artificial intelligence")' });
          }
        }
        const { items, meta } = await fetchGdeltNews(query, max);
        return json(res, 200, { ok: true, items, cached: meta.cached, meta });
      }

      if (pathname === '/api/stocks/quote' && req.method === 'GET') {
        const symbol = sanitizeSymbol(url.searchParams.get('symbol') || '');
        if (!symbol) return json(res, 400, { ok: false, error: 'Invalid symbol' });
        const { quote, meta } = await getNasdaqQuoteWithMeta(symbol);
        return json(res, 200, { ok: true, quote, cached: meta.cached, meta });
      }

      if (pathname === '/api/stocks/candles' && req.method === 'GET') {
        const symbol = sanitizeSymbol(url.searchParams.get('symbol') || '');
        if (!symbol) return json(res, 400, { ok: false, error: 'Invalid symbol' });

        const range = (url.searchParams.get('range') || '1d').trim();
        const interval = (url.searchParams.get('interval') || '1m').trim();

        const { candles, meta } = await getNasdaqCandlesWithMeta(symbol, range, interval);
        return json(res, 200, { ok: true, candles, cached: meta.cached, meta });
      }

      if (pathname === '/api/convictions' && req.method === 'GET') {
        const limitRaw = Number(url.searchParams.get('limit') || '200');
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : 200;
        const statusRaw = (url.searchParams.get('status') || '').trim().toLowerCase();
        const status: ConvictionStatus | undefined =
          statusRaw === 'watching' || statusRaw === 'entered' || statusRaw === 'exited' ? (statusRaw as ConvictionStatus) : undefined;

        const rows = listConvictionsWithMarkets({ limit, status });
        const capped = rows.slice(0, 50);

        const pricesList = await mapLimit(capped, 8, async (row) => {
          if (row.market.source !== 'polymarket') return { marketId: row.market.id, prices: null as MarketPrices | null };
          try {
            const prices = await fetchGammaYesPrices(row.market.externalId);
            return { marketId: row.market.id, prices };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const prices: MarketPrices = { mid: null, bestBid: null, bestAsk: null, lastTrade: null, asOf: Date.now(), source: `gamma_err:${message}` };
            return { marketId: row.market.id, prices };
          }
        });
        const pricesByMarketId = new Map(pricesList.map((x) => [x.marketId, x.prices]));

        const marketIds = rows.map((r) => r.market.id);
        const counts = new Map<string, number>();
        if (marketIds.length) {
          const placeholders = marketIds.map(() => '?').join(',');
          const stmt = truthDb.prepare(`SELECT market_id as marketId, COUNT(*) as c FROM info_events WHERE market_id IN (${placeholders}) GROUP BY market_id`);
          const countRows = stmt.all(...marketIds) as any[];
          for (const r of countRows) counts.set(String(r.marketId), Number(r.c || 0));
        }

        const convictions = rows.map((r) => {
          const prices = pricesByMarketId.get(r.market.id) ?? null;
          const edge = prices?.mid == null ? null : r.conviction.myProbability - prices.mid;
          return {
            ...r.conviction,
            market: r.market,
            marketPrices: prices,
            edge,
            eventCount: counts.get(r.market.id) ?? 0
          };
        });

        return json(res, 200, { ok: true, convictions });
      }

      if (pathname === '/api/convictions' && req.method === 'POST') {
        const body = await readJson(req);
        const sourceRaw = String(body?.source || 'polymarket').trim().toLowerCase();
        const source: MarketSource = sourceRaw === 'polymarket' ? 'polymarket' : 'other';
        const externalId = String(body?.externalId || body?.conditionId || '').trim();
        if (!externalId) return json(res, 400, { ok: false, error: 'externalId (conditionId) required' });

        let question = String(body?.question || '').trim();
        let slug = String(body?.slug || '').trim();
        let endDate: string | null = body?.endDate == null ? null : String(body.endDate).trim() || null;

        if (source === 'polymarket') {
          const meta = getMarketMeta(externalId);
          if (!question && meta?.question) question = meta.question;
          if (!endDate && meta?.endDate) endDate = meta.endDate;
          if (!question || !endDate) {
            const fetched = await fetchGammaMarketByConditionId(externalId);
            if (!question && fetched?.question) question = fetched.question;
            if (!slug && fetched?.slug) slug = fetched.slug;
            if (!endDate && fetched?.endDate) endDate = fetched.endDate;
          }
        }

        const market = upsertMarket({ source, externalId, slug: slug || undefined, question: question || undefined, endDate });
        const conviction = upsertConvictionByMarketId({
          marketId: market.id,
          myProbability: body?.myProbability,
          entryThesis: body?.entryThesis,
          status: body?.status,
          keyUncertainties: body?.keyUncertainties,
          exitConditions: body?.exitConditions
        });

        return json(res, 200, { ok: true, market, conviction });
      }

      if (pathname.startsWith('/api/convictions/') && req.method === 'DELETE') {
        const id = pathname.slice('/api/convictions/'.length).trim();
        if (!id) return json(res, 400, { ok: false, error: 'id required' });
        deleteConviction(id);
        return json(res, 200, { ok: true });
      }

      if (pathname === '/api/events' && req.method === 'GET') {
        const limitRaw = Number(url.searchParams.get('limit') || '500');
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(2000, Math.floor(limitRaw))) : 500;
        const marketIdRaw = (url.searchParams.get('marketId') || '').trim();
        const marketId = marketIdRaw ? marketIdRaw : null;
        const rows = listInfoEventsWithMarkets({ limit, marketId });
        const events = rows.map((r) => ({ ...r.event, market: r.market }));
        return json(res, 200, { ok: true, events });
      }

      if (pathname === '/api/events' && req.method === 'POST') {
        const body = await readJson(req);
        const event = createInfoEvent({
          marketId: body?.marketId ?? null,
          title: String(body?.title || ''),
          date: String(body?.date || ''),
          dateConfidence: body?.dateConfidence,
          source: body?.source ?? null,
          impactHypothesis: body?.impactHypothesis,
          createdBy: body?.createdBy
        });
        return json(res, 200, { ok: true, event });
      }

      if (pathname.startsWith('/api/events/') && req.method === 'PUT') {
        const id = pathname.slice('/api/events/'.length).trim();
        if (!id) return json(res, 400, { ok: false, error: 'id required' });
        const body = await readJson(req);
        const event = updateInfoEvent(id, {
          marketId: body?.marketId,
          title: body?.title,
          date: body?.date,
          dateConfidence: body?.dateConfidence,
          source: body?.source,
          impactHypothesis: body?.impactHypothesis,
          createdBy: body?.createdBy
        });
        return json(res, 200, { ok: true, event });
      }

      if (pathname.startsWith('/api/events/') && req.method === 'DELETE') {
        const id = pathname.slice('/api/events/'.length).trim();
        if (!id) return json(res, 400, { ok: false, error: 'id required' });
        deleteInfoEvent(id);
        return json(res, 200, { ok: true });
      }

      if (pathname === '/api/positions' && req.method === 'GET') {
        const limitRaw = Number(url.searchParams.get('limit') || '500');
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(2000, Math.floor(limitRaw))) : 500;
        const marketId = (url.searchParams.get('marketId') || '').trim() || undefined;

        const rows = listPositionsWithMarkets({ limit, marketId });
        const capped = rows.slice(0, 80);
        const pricesList = await mapLimit(capped, 8, async (row) => {
          if (row.market.source !== 'polymarket') return { marketId: row.market.id, prices: null as MarketPrices | null };
          try {
            const prices = await fetchGammaYesPrices(row.market.externalId);
            return { marketId: row.market.id, prices };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const prices: MarketPrices = { mid: null, bestBid: null, bestAsk: null, lastTrade: null, asOf: Date.now(), source: `gamma_err:${message}` };
            return { marketId: row.market.id, prices };
          }
        });
        const pricesByMarketId = new Map(pricesList.map((x) => [x.marketId, x.prices]));

        let totalCost = 0;
        let totalValue = 0;
        let totalPnl = 0;

        const positions = rows.map((r) => {
          const prices = pricesByMarketId.get(r.market.id) ?? null;
          const yesMid = prices?.mid == null ? null : prices.mid;
          const currentPrice = yesMid == null ? null : r.position.outcome === 'YES' ? yesMid : 1 - yesMid;
          const cost = r.position.shares * r.position.avgPrice;
          const value = currentPrice == null ? null : r.position.shares * currentPrice;
          const pnl = value == null ? null : value - cost;

          totalCost += cost;
          if (value != null) totalValue += value;
          if (pnl != null) totalPnl += pnl;

          return {
            ...r.position,
            market: r.market,
            marketPrices: prices,
            currentPrice,
            cost,
            value,
            pnl
          };
        });

        return json(res, 200, { ok: true, positions, totals: { cost: totalCost, value: totalValue, pnl: totalPnl } });
      }

      if (pathname === '/api/positions' && req.method === 'POST') {
        const body = await readJson(req);
        const sourceRaw = String(body?.source || 'polymarket').trim().toLowerCase();
        const source: MarketSource = sourceRaw === 'polymarket' ? 'polymarket' : 'other';
        const externalId = String(body?.externalId || body?.conditionId || '').trim();
        if (!externalId) return json(res, 400, { ok: false, error: 'externalId (conditionId) required' });

        let question = String(body?.question || '').trim();
        let slug = String(body?.slug || '').trim();
        let endDate: string | null = body?.endDate == null ? null : String(body.endDate).trim() || null;

        if (source === 'polymarket') {
          const meta = getMarketMeta(externalId);
          if (!question && meta?.question) question = meta.question;
          if (!endDate && meta?.endDate) endDate = meta.endDate;
          const fetched = await fetchGammaMarketByConditionId(externalId);
          if (!question && fetched?.question) question = fetched.question;
          if (!slug && fetched?.slug) slug = fetched.slug;
          if (!endDate && fetched?.endDate) endDate = fetched.endDate;
        }

        const market = upsertMarket({ source, externalId, slug: slug || undefined, question: question || undefined, endDate });
        const position = createPosition({
          marketId: market.id,
          outcome: body?.outcome,
          shares: body?.shares,
          avgPrice: body?.avgPrice
        });

        return json(res, 200, { ok: true, market, position });
      }

      if (pathname.startsWith('/api/positions/') && req.method === 'PUT') {
        const id = pathname.slice('/api/positions/'.length).trim();
        if (!id) return json(res, 400, { ok: false, error: 'id required' });
        const body = await readJson(req);
        const position = updatePosition(id, { outcome: body?.outcome, shares: body?.shares, avgPrice: body?.avgPrice });
        return json(res, 200, { ok: true, position });
      }

      if (pathname.startsWith('/api/positions/') && req.method === 'DELETE') {
        const id = pathname.slice('/api/positions/'.length).trim();
        if (!id) return json(res, 400, { ok: false, error: 'id required' });
        deletePosition(id);
        return json(res, 200, { ok: true });
      }

      if (pathname === '/api/rules' && req.method === 'GET') {
        const limitRaw = Number(url.searchParams.get('limit') || '500');
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(2000, Math.floor(limitRaw))) : 500;
        const statusRaw = (url.searchParams.get('status') || '').trim().toLowerCase();
        const status: RuleStatus | undefined =
          statusRaw === 'active' || statusRaw === 'triggered' || statusRaw === 'disabled' ? (statusRaw as RuleStatus) : undefined;
        const rows = listRulesWithMarkets({ limit, status });
        const rules = rows.map((r) => ({ ...r.rule, market: r.market }));
        return json(res, 200, { ok: true, rules });
      }

      if (pathname === '/api/rules' && req.method === 'POST') {
        const body = await readJson(req);
        const rule = createRule({
          marketId: String(body?.marketId || ''),
          name: body?.name,
          type: body?.type,
          priceThreshold: body?.priceThreshold,
          minMyProbability: body?.minMyProbability
        });
        return json(res, 200, { ok: true, rule });
      }

      if (pathname.startsWith('/api/rules/') && req.method === 'PUT') {
        const id = pathname.slice('/api/rules/'.length).trim();
        if (!id) return json(res, 400, { ok: false, error: 'id required' });
        const body = await readJson(req);
        const rule = updateRule(id, {
          name: body?.name,
          type: body?.type,
          priceThreshold: body?.priceThreshold,
          minMyProbability: body?.minMyProbability,
          status: body?.status
        });
        return json(res, 200, { ok: true, rule });
      }

      if (pathname.startsWith('/api/rules/') && req.method === 'DELETE') {
        const id = pathname.slice('/api/rules/'.length).trim();
        if (!id) return json(res, 400, { ok: false, error: 'id required' });
        deleteRule(id);
        return json(res, 200, { ok: true });
      }

      if (pathname === '/api/alerts' && req.method === 'GET') {
        const limitRaw = Number(url.searchParams.get('limit') || '200');
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(2000, Math.floor(limitRaw))) : 200;
        const unseenOnly = url.searchParams.get('unseen') === '1';
        const rows = listAlertsWithMarkets({ limit, unseenOnly });
        const alerts = rows.map((r) => ({ ...r.alert, market: r.market, rule: r.rule }));
        return json(res, 200, { ok: true, alerts });
      }

      if (pathname === '/api/alerts/seen' && req.method === 'POST') {
        const body = await readJson(req);
        const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
        markAlertsSeen(ids);
        return json(res, 200, { ok: true });
      }

      if (pathname === '/api/orderbook/binance/symbols' && req.method === 'GET') {
        const now = Date.now();
        if (binanceSymbolsCache.symbols.length && now - binanceSymbolsCache.ts < 10 * 60 * 1000) {
          return json(res, 200, { ok: true, symbols: binanceSymbolsCache.symbols, cached: true });
        }

        const response = await fetch('https://api.binance.com/api/v3/exchangeInfo', { headers: { Accept: 'application/json' } });
        if (!response.ok) return json(res, 502, { ok: false, error: `Binance HTTP ${response.status}` });
        const data: any = await response.json();
        const list: string[] = [];
        for (const s of data?.symbols || []) {
          if (s?.status !== 'TRADING') continue;
          if (s?.isSpotTradingAllowed === false) continue;
          const base = String(s?.baseAsset || '').toUpperCase();
          const quote = String(s?.quoteAsset || '').toUpperCase();
          if (!base || !quote) continue;
          list.push(`${base}/${quote}`);
        }
        list.sort((a, b) => a.localeCompare(b));
        binanceSymbolsCache.ts = now;
        binanceSymbolsCache.symbols = list;
        return json(res, 200, { ok: true, symbols: list, cached: false });
      }

      if (pathname === '/api/orderbook/polymarket/book' && req.method === 'GET') {
        const conditionId = (url.searchParams.get('conditionId') || '').trim();
        if (!conditionId) return json(res, 400, { ok: false, error: 'conditionId required' });

        const outcomeRaw = (url.searchParams.get('outcome') || 'YES').trim().toUpperCase();
        const outcome: 'YES' | 'NO' = outcomeRaw === 'NO' ? 'NO' : 'YES';

        const depthRaw = Number(url.searchParams.get('depth') || '20');
        const depth = Number.isFinite(depthRaw) ? Math.max(1, Math.min(200, Math.floor(depthRaw))) : 20;

        const market = await fetchGammaMarketByConditionId(conditionId);
        if (!market) return json(res, 404, { ok: false, error: 'Market not found in Gamma (conditionId)' });

        const outcomes = parseGammaJsonArray((market as any).outcomes);
        const tokenIds = parseGammaJsonArray((market as any).clobTokenIds);
        const idx = findOutcomeIndex(outcomes, outcome);
        const tokenId = tokenIds[idx] || tokenIds[0] || '';
        if (!tokenId) return json(res, 502, { ok: false, error: 'Missing clobTokenIds from Gamma response' });

        const book = await fetchPolymarketClobBook(tokenId, depth);
        const bestBid = book.bids.length ? book.bids[0]!.price : null;
        const bestAsk = book.asks.length ? book.asks[0]!.price : null;
        const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : bestBid ?? bestAsk ?? null;

        const endDate = typeof (market as any)?.endDate === 'string' ? String((market as any).endDate) : '';
        const liquidityNumRaw = (market as any)?.liquidityNum;
        const volume24hrRaw = (market as any)?.volume24hr;
        const volume24hrClobRaw = (market as any)?.volume24hrClob;
        const liquidityNum = typeof liquidityNumRaw === 'number' ? liquidityNumRaw : Number(liquidityNumRaw ?? 0);
        const volume24hr = typeof volume24hrRaw === 'number' ? volume24hrRaw : Number(volume24hrRaw ?? 0);
        const volume24hrClob = typeof volume24hrClobRaw === 'number' ? volume24hrClobRaw : Number(volume24hrClobRaw ?? 0);

        const local = getMarketByExternalId('polymarket', conditionId);
        const pos = {
          YES: { shares: 0, avgPrice: null as number | null, cost: 0, value: null as number | null, pnl: null as number | null },
          NO: { shares: 0, avgPrice: null as number | null, cost: 0, value: null as number | null, pnl: null as number | null }
        };
        if (local) {
          const rows = truthDb.prepare(`SELECT outcome, shares, avg_price FROM positions WHERE market_id = ?`).all(local.id) as any[];
          const totals = {
            YES: { shares: 0, notional: 0 },
            NO: { shares: 0, notional: 0 }
          };
          for (const r of rows) {
            const outcome = String(r.outcome || '').toUpperCase() === 'NO' ? 'NO' : 'YES';
            const shares = Number(r.shares);
            const avgPrice = Number(r.avg_price);
            if (!Number.isFinite(shares) || !Number.isFinite(avgPrice)) continue;
            totals[outcome].shares += shares;
            totals[outcome].notional += shares * avgPrice;
          }
          for (const side of ['YES', 'NO'] as const) {
            const shares = totals[side].shares;
            pos[side].shares = shares;
            pos[side].avgPrice = shares > 0 ? totals[side].notional / shares : null;
            pos[side].cost = totals[side].notional;
            if (mid != null && Number.isFinite(mid)) {
              const current = side === 'YES' ? mid : 1 - mid;
              pos[side].value = shares * current;
              pos[side].pnl = pos[side].value - pos[side].cost;
            }
          }
        }

        return json(res, 200, {
          ok: true,
          conditionId,
          outcome,
          tokenId,
          question: String((market as any).question || ''),
          endDate,
          liquidityNum,
          volume24hr,
          volume24hrClob,
          bestBid,
          bestAsk,
          mid,
          bids: book.bids,
          asks: book.asks,
          position: pos,
          ts: Date.now()
        });
      }

      if (pathname === '/api/execution/state' && req.method === 'GET') {
        const limitOrdersRaw = Number(url.searchParams.get('limitOrders') || '100');
        const limitFillsRaw = Number(url.searchParams.get('limitFills') || '100');
        const limitOrders = Number.isFinite(limitOrdersRaw) ? Math.max(1, Math.min(500, Math.floor(limitOrdersRaw))) : 100;
        const limitFillsN = Number.isFinite(limitFillsRaw) ? Math.max(1, Math.min(500, Math.floor(limitFillsRaw))) : 100;
        const pending = listPendingOrders(limitOrders);
        const history = listOrderHistory(limitOrders);
        const fills = listFills(limitFillsN);
        const metrics = computeSlippageMetrics({ windowMs: 24 * 60 * 60 * 1000, maxFills: 500 });
        return json(res, 200, { ok: true, pending, history, fills, metrics, ts: Date.now() });
      }

      if (pathname === '/api/execution/order' && req.method === 'POST') {
        const body = await readJson(req);
        const symbol = typeof body?.symbol === 'string' ? body.symbol : '';
        const side = body?.side;
        const type = body?.type;
        const qty = Number(body?.qty);
        const limitPrice = body?.limitPrice == null ? null : Number(body.limitPrice);
        const expectedPrice = body?.expectedPrice == null ? null : Number(body.expectedPrice);
        const order = createOrder({ symbol, side, qty, type, limitPrice, expectedPrice });
        return json(res, 200, { ok: true, order });
      }

      if (pathname === '/api/execution/fill' && req.method === 'POST') {
        const body = await readJson(req);
        const orderId = typeof body?.orderId === 'string' ? body.orderId : '';
        const price = Number(body?.price);
        const qty = body?.qty == null ? undefined : Number(body.qty);
        if (!orderId) return json(res, 400, { ok: false, error: 'orderId required' });
        const result = createFill({ orderId, price, qty });
        return json(res, 200, { ok: true, ...result });
      }

      if (pathname === '/api/execution/cancel' && req.method === 'POST') {
        const body = await readJson(req);
        const orderId = typeof body?.orderId === 'string' ? body.orderId : '';
        if (!orderId) return json(res, 400, { ok: false, error: 'orderId required' });
        const order = cancelOrder(orderId);
        return json(res, 200, { ok: true, order });
      }

      if (pathname === '/api/polymarket/feed' && req.method === 'GET') {
        const q = (url.searchParams.get('q') || '').trim();
        const category = (url.searchParams.get('category') || '').trim();
        const limitRaw = Number(url.searchParams.get('limit') || '120');
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 120;
        const source = (url.searchParams.get('source') || 'live').trim().toLowerCase();

        const qLower = q.toLowerCase();

        if (source !== 'db') {
          const base = await fetchPolymarketLiveWindow(500);
          const filtered = base.filter((item) => {
            if (category && item.category.toLowerCase() !== category.toLowerCase()) return false;
            if (!qLower) return true;
            return (
              item.question.toLowerCase().includes(qLower) ||
              item.wallet.toLowerCase().includes(qLower) ||
              item.marketId.toLowerCase().includes(qLower)
            );
          });

          const categories = Array.from(new Set(['crypto', 'politics', 'sports', 'tech-personalities', 'uncategorized', ...base.map((i) => i.category).filter(Boolean)])).sort(
            (a, b) => a.localeCompare(b)
          );

          return json(res, 200, {
            ok: true,
            items: filtered.slice(0, limit),
            categories,
            stats: { mode: 'live', window: base.length },
            ts: Date.now()
          });
        }

        const qLike = `%${qLower}%`;

        const stmt = polyDb.prepare(`
          SELECT
            t.id as id,
            t.timestamp as timestamp,
            t.market_id as marketId,
            t.wallet as wallet,
            t.side as side,
            t.outcome as outcome,
            t.size as size,
            t.price as price,
            t.title as title,
            t.slug as slug,
            m.question as question,
            m.category as category
          FROM trades t
          LEFT JOIN market_meta m ON m.id = t.market_id
          WHERE
            (? = '' OR lower(coalesce(
              m.category,
              CASE
                WHEN lower(coalesce(t.slug,'')) LIKE 'eth-%' OR lower(coalesce(t.slug,'')) LIKE 'btc-%' THEN 'crypto'
                WHEN lower(coalesce(t.slug,'')) LIKE 'nhl-%' OR lower(coalesce(t.slug,'')) LIKE 'nba-%' OR lower(coalesce(t.slug,'')) LIKE 'nfl-%' THEN 'sports'
                WHEN lower(coalesce(t.slug,'')) LIKE '%trump%' OR lower(coalesce(t.slug,'')) LIKE '%biden%' OR lower(coalesce(t.slug,'')) LIKE '%election%' THEN 'politics'
                WHEN lower(coalesce(t.slug,'')) LIKE '%musk%' OR lower(coalesce(t.slug,'')) LIKE '%elon%' THEN 'tech-personalities'
                WHEN coalesce(t.slug,'') != '' THEN 'uncategorized'
                ELSE ''
              END
            )) = lower(?))
            AND (
              ? = '' OR
              lower(coalesce(m.question, t.title, '')) LIKE ? OR
              lower(t.wallet) LIKE ? OR
              lower(t.market_id) LIKE ?
            )
          ORDER BY t.timestamp DESC
          LIMIT ?
        `);

        const rows = stmt.all(category, category, qLower, qLike, qLike, qLike, limit) as any[];

        const missingMarketIds: string[] = [];
        const items: PolymarketFeedItem[] = rows.map((r) => {
          const title = typeof r.title === 'string' ? r.title : '';
          const slug = typeof r.slug === 'string' ? r.slug : '';

          const question = typeof r.question === 'string' && r.question ? r.question : title;

          let cat = typeof r.category === 'string' ? r.category : '';
          if (!cat && slug) cat = polymarketCategoryFromSlug(slug);
          if (!question || !cat) missingMarketIds.push(String(r.marketId || ''));
          return {
            id: String(r.id || ''),
            timestamp: Number(r.timestamp || 0),
            marketId: String(r.marketId || ''),
            wallet: String(r.wallet || ''),
            side: String(r.side || ''),
            outcome: String(r.outcome || ''),
            size: Number(r.size || 0),
            price: Number(r.price || 0),
            question,
            category: cat
          };
        });

        // Lazy-enrich missing market metadata so category/search become useful without a separate enrich step.
        if (missingMarketIds.length) {
          await ensureMarketMetaForFeed(missingMarketIds, 8);
          const uniqueMissing = Array.from(new Set(missingMarketIds)).filter(Boolean);
          for (const marketId of uniqueMissing) {
            const meta = getMarketMeta(marketId);
            if (!meta) continue;
            for (const item of items) {
              if (item.marketId !== marketId) continue;
              if (!item.question) item.question = meta.question;
              if (!item.category) item.category = meta.category;
            }
          }
        }

        const defaults = ['crypto', 'politics', 'sports', 'tech-personalities', 'uncategorized'];
        const dbCategories = (polyDb
          .prepare(`SELECT DISTINCT category FROM market_meta WHERE category IS NOT NULL AND category != '' ORDER BY category COLLATE NOCASE ASC`)
          .all() as any[])
          .map((r) => String(r.category || '').trim())
          .filter(Boolean);

        const categories = Array.from(new Set([...defaults, ...dbCategories]));

        return json(res, 200, {
          ok: true,
          items,
          categories,
          stats: { mode: 'db', ...getPolyStats() },
          ts: Date.now()
        });
      }

      if (pathname === '/api/chat' && req.method === 'POST') {
        const body = await readJson(req);
        const sessionId = typeof body?.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : 'default';
        const message = typeof body?.message === 'string' ? body.message.trim() : '';
        if (!message) return json(res, 400, { ok: false, error: 'message is required' });

        const session = getOrCreateSession(sessionId);
        const now = Date.now();
        session.messages.push({ role: 'user', text: message, ts: now });

        const toolEvents: ToolEvent[] = [];
        let assistantText = '';

        if (message.startsWith('/exec ')) {
          const command = message.slice('/exec '.length).trim();
          const outputs = await core.execute(command, buildContext());
          // Allow UI-targeted directives without a full command integration yet.
          // Examples:
          //   /exec book BTC/USDT binance
          //   /exec book open BTC/USDT binance
          const parts = command.split(/\s+/).filter(Boolean);
          let targetWindow = 'intel';
          if (parts[0] === 'book') {
            const symbol = parts[1] === 'open' ? parts[2] : parts[1];
            const source = parts[1] === 'open' ? parts[3] : parts[2];
            if (symbol && source) {
              targetWindow = 'book';
              outputs.push({
                kind: 'json',
                title: 'orderbook',
                value: { symbol, source }
              });
            }
          }
          const event: ToolEvent = {
            id: newId('tool'),
            type: 'tool',
            title: 'exec',
            command,
            outputs,
            targetWindow,
            ts: Date.now()
          };
          session.events.push(event);
          toolEvents.push(event);
          assistantText = `Ran: ${command}`;
        } else {
          const reply = await llmReplyWithTools(session.messages);
          assistantText = reply.assistantText;
          if (reply.toolEvents.length) {
            for (const ev of reply.toolEvents) {
              session.events.push(ev);
              toolEvents.push(ev);
            }
          }
        }

        session.messages.push({ role: 'assistant', text: assistantText, ts: Date.now() });

        return json(res, 200, {
          ok: true,
          sessionId: session.id,
          assistant: assistantText,
          events: toolEvents
        });
      }

      if (pathname === '/api/tools' && req.method === 'GET') {
        return json(res, 200, { ok: true, tools: listToolSummaries() });
      }

      if (pathname === '/api/tools/execute' && req.method === 'POST') {
        const body = await readJson(req);
        const name = typeof body?.name === 'string' ? body.name.trim() : '';
        if (!name) return json(res, 400, { ok: false, error: 'name is required' });
        const tool = getTool(name);
        if (!tool) return json(res, 404, { ok: false, error: `Unknown tool: ${name}` });
        const startedAt = Date.now();
        try {
          const result = await tool.execute(body?.params ?? {});
          const durationMs = Date.now() - startedAt;
          return json(res, 200, { ok: true, result, meta: { durationMs } });
        } catch (err) {
          const durationMs = Date.now() - startedAt;
          const message = err instanceof Error ? err.message : String(err);
          return json(res, 500, { ok: false, error: message, meta: { durationMs } });
        }
      }

      if (pathname === '/api/commands') {
        const commands = core.listCommands().map((c) => ({
          name: c.name,
          usage: c.usage,
          description: c.description
        }));
        return json(res, 200, commands);
      }

      return serveStatic(req, res, pathname);
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  server.listen(port, host, () => {
    console.log(`Truth Terminal UI: http://${host}:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
