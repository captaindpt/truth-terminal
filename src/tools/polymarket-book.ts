import type { Tool } from './types.js';
import type { ToolOutput } from '../core/types.js';
import { isRecord, pickInt, pickString } from './utils.js';

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';

type GammaMarket = {
  id: string;
  conditionId: string; // 0x...
  slug: string;
  question: string;
  endDate: string;
  outcomes: string; // JSON string
  clobTokenIds?: string; // JSON string
};

type ClobLevel = { price: number; size: number };
type ClobBook = { bids: ClobLevel[]; asks: ClobLevel[]; tokenId: string };

function isHexConditionId(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

function parseJsonArray(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

function findOutcomeIndex(outcomes: string[], outcome: 'YES' | 'NO'): number {
  const target = outcome.toLowerCase();
  const idx = outcomes.findIndex((o) => String(o).trim().toLowerCase() === target);
  if (idx >= 0) return idx;
  if (outcomes.length >= 2) return outcome === 'YES' ? 0 : 1;
  return 0;
}

async function fetchGammaMarketById(id: string): Promise<GammaMarket | null> {
  const response = await fetch(`${GAMMA_API_BASE}/markets/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) return null;
  const data = (await response.json()) as any;
  if (!data) return null;
  return {
    id: String(data.id || ''),
    conditionId: String(data.conditionId || ''),
    slug: String(data.slug || ''),
    question: String(data.question || ''),
    endDate: String(data.endDate || ''),
    outcomes: String(data.outcomes || '[]'),
    clobTokenIds: typeof data.clobTokenIds === 'string' ? data.clobTokenIds : JSON.stringify(data.clobTokenIds || [])
  };
}

async function fetchGammaMarketByConditionId(conditionId: string): Promise<GammaMarket | null> {
  const url = new URL(`${GAMMA_API_BASE}/markets`);
  url.searchParams.set('limit', '1');
  url.searchParams.set('condition_ids', conditionId);
  const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!response.ok) return null;
  const arr = (await response.json()) as any[];
  const data = arr && arr.length ? arr[0] : null;
  if (!data) return null;
  return {
    id: String(data.id || ''),
    conditionId: String(data.conditionId || ''),
    slug: String(data.slug || ''),
    question: String(data.question || ''),
    endDate: String(data.endDate || ''),
    outcomes: String(data.outcomes || '[]'),
    clobTokenIds: typeof data.clobTokenIds === 'string' ? data.clobTokenIds : JSON.stringify(data.clobTokenIds || [])
  };
}

async function resolveMarket(ref: string): Promise<{ market: GammaMarket; conditionId: string }> {
  const raw = ref.trim();
  if (!raw) throw new Error('marketId is required');
  if (isHexConditionId(raw)) {
    const market = await fetchGammaMarketByConditionId(raw);
    if (!market) throw new Error('Market not found in Gamma (conditionId)');
    return { market, conditionId: raw };
  }

  if (/^\d+$/.test(raw)) {
    const market = await fetchGammaMarketById(raw);
    if (!market) throw new Error('Market not found in Gamma (id)');
    const cond = market.conditionId?.trim();
    if (!isHexConditionId(cond)) throw new Error('Gamma market missing conditionId');
    return { market, conditionId: cond };
  }

  throw new Error('marketId must be a Gamma id (digits) or conditionId (0x...)');
}

async function fetchPolymarketClobBook(tokenId: string, depth: number): Promise<ClobBook> {
  const response = await fetch(`https://clob.polymarket.com/book?token_id=${encodeURIComponent(tokenId)}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new Error(`Polymarket CLOB HTTP ${response.status}${text ? `: ${text}` : ''}`) as any;
    err.status = response.status;
    throw err;
  }
  const raw = (await response.json()) as any;

  const bidsRaw = Array.isArray(raw?.bids) ? raw.bids : [];
  const asksRaw = Array.isArray(raw?.asks) ? raw.asks : [];

  const bids: ClobLevel[] = [];
  for (const r of bidsRaw) {
    const price = Number(r?.price);
    const size = Number(r?.size);
    if (!Number.isFinite(price) || !Number.isFinite(size)) continue;
    bids.push({ price, size });
  }
  bids.sort((a, b) => b.price - a.price);

  const asks: ClobLevel[] = [];
  for (const r of asksRaw) {
    const price = Number(r?.price);
    const size = Number(r?.size);
    if (!Number.isFinite(price) || !Number.isFinite(size)) continue;
    asks.push({ price, size });
  }
  asks.sort((a, b) => a.price - b.price);

  return { bids: bids.slice(0, depth), asks: asks.slice(0, depth), tokenId };
}

export const polymarketBookTool: Tool = {
  name: 'polymarket_book',
  description: 'Fetch a Polymarket CLOB order book (YES/NO) via Gamma + CLOB.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      marketId: { type: 'string', description: 'Gamma id (e.g. "516710") or conditionId (0x...).' },
      outcome: { type: 'string', enum: ['YES', 'NO'], description: 'Outcome side for the book.' },
      depth: { type: 'integer', minimum: 1, maximum: 200, description: 'Levels per side.' }
    },
    required: ['marketId']
  },
  execute: async (params) => {
    const p = isRecord(params) ? params : {};
    const marketId = pickString(p.marketId).trim();
    const outcomeRaw = pickString(p.outcome).trim().toUpperCase();
    const outcome: 'YES' | 'NO' = outcomeRaw === 'NO' ? 'NO' : 'YES';
    const depth = pickInt(p.depth, 20, { min: 1, max: 200 });

    const { market, conditionId } = await resolveMarket(marketId);
    const outcomes = parseJsonArray((market as any).outcomes);
    const tokenIds = parseJsonArray((market as any).clobTokenIds);

    const idx = findOutcomeIndex(outcomes, outcome);
    const tokenId = tokenIds[idx] || tokenIds[0] || '';
    if (!tokenId) throw new Error('Missing clobTokenIds from Gamma response');

    let bookAvailable = true;
    let book: ClobBook = { bids: [], asks: [], tokenId };

    try {
      book = await fetchPolymarketClobBook(tokenId, depth);
    } catch (err) {
      const status = typeof (err as any)?.status === 'number' ? Number((err as any).status) : null;
      const message = err instanceof Error ? err.message : String(err);
      if (status === 404 || message.includes('No orderbook exists')) {
        bookAvailable = false;
      } else {
        throw err;
      }
    }

    const bestBid = book.bids.length ? book.bids[0]!.price : null;
    const bestAsk = book.asks.length ? book.asks[0]!.price : null;
    const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : bestBid ?? bestAsk ?? null;

    return {
      marketId: market.id,
      conditionId,
      question: market.question,
      slug: market.slug,
      endDate: market.endDate,
      outcome,
      tokenId,
      bookAvailable,
      bestBid,
      bestAsk,
      mid,
      bids: book.bids,
      asks: book.asks,
      ts: Date.now()
    };
  },
  render: (result): ToolOutput[] => {
    const r = isRecord(result) ? result : {};
    const conditionId = pickString(r.conditionId).trim();
    const outcome = pickString(r.outcome).trim().toUpperCase() || 'YES';
    const question = pickString(r.question).trim();
    const bookAvailable = r.bookAvailable !== false;
    const mid = typeof r.mid === 'number' && Number.isFinite(r.mid) ? r.mid : null;
    const bestBid = typeof r.bestBid === 'number' && Number.isFinite(r.bestBid) ? r.bestBid : null;
    const bestAsk = typeof r.bestAsk === 'number' && Number.isFinite(r.bestAsk) ? r.bestAsk : null;

    const bidsRaw = Array.isArray(r.bids) ? r.bids : [];
    const asksRaw = Array.isArray(r.asks) ? r.asks : [];

    const bids: Array<Array<string | number>> = [];
    for (const lvl of bidsRaw.slice(0, 20)) {
      const row = isRecord(lvl) ? lvl : {};
      bids.push([Number(row.price ?? 0), Number(row.size ?? 0)]);
    }

    const asks: Array<Array<string | number>> = [];
    for (const lvl of asksRaw.slice(0, 20)) {
      const row = isRecord(lvl) ? lvl : {};
      asks.push([Number(row.price ?? 0), Number(row.size ?? 0)]);
    }

    const outputs: ToolOutput[] = [];
    if (bookAvailable) {
      outputs.push({
        kind: 'json',
        title: 'orderbook',
        value: { symbol: conditionId, source: 'polymarket', outcome }
      });
    }

    outputs.push(
      {
        kind: 'text',
        title: 'Market',
        text: `${question || conditionId}${bookAvailable ? '' : ' · no CLOB orderbook'}${mid != null ? ` · mid ${(mid * 100).toFixed(2)}%` : ''}${bestBid != null ? ` · bid ${(bestBid * 100).toFixed(2)}%` : ''}${bestAsk != null ? ` · ask ${(bestAsk * 100).toFixed(2)}%` : ''}`
      },
      { kind: 'table', title: 'Asks', columns: ['price', 'size'], rows: asks },
      { kind: 'table', title: 'Bids', columns: ['price', 'size'], rows: bids }
    );

    return outputs;
  },
  targetWindow: 'book'
};
