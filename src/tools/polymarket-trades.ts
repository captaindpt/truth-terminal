import type { Tool } from './types.js';
import type { ToolOutput } from '../core/types.js';
import { isRecord, pickInt, pickNumber, pickString } from './utils.js';

const DATA_API_BASE = 'https://data-api.polymarket.com';
const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';

type PolymarketTrade = {
  proxyWallet: string;
  side: 'BUY' | 'SELL';
  asset: string;
  conditionId: string; // onchain conditionId (0x...)
  size: number;
  price: number;
  timestamp: number; // seconds
  title: string;
  slug: string;
  eventSlug: string;
  outcome: string;
  transactionHash: string;
};

type ParsedTrade = {
  ts: number;
  wallet: string;
  side: 'BUY' | 'SELL';
  outcome: string;
  price: number;
  size: number;
  title: string;
  url: string;
  conditionId: string;
  tx: string;
};

function isHexConditionId(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

async function resolveConditionIdHex(marketId: string): Promise<string | null> {
  const raw = marketId.trim();
  if (!raw) return null;
  if (isHexConditionId(raw)) return raw;
  if (!/^\d+$/.test(raw)) return null;

  const response = await fetch(`${GAMMA_API_BASE}/markets/${encodeURIComponent(raw)}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) return null;
  const data = (await response.json()) as any;
  const conditionId = typeof data?.conditionId === 'string' ? data.conditionId.trim() : '';
  return isHexConditionId(conditionId) ? conditionId : null;
}

function toPolymarketUrl(trade: PolymarketTrade): string {
  const slug = String(trade.slug || '').trim();
  if (!slug) return '';
  return `https://polymarket.com/market/${encodeURIComponent(slug)}`;
}

function parseTrade(t: PolymarketTrade): ParsedTrade | null {
  const ts = Number(t.timestamp) * 1000;
  const price = Number(t.price);
  const size = Number(t.size);
  if (!Number.isFinite(ts) || !Number.isFinite(price) || !Number.isFinite(size)) return null;

  const conditionId = typeof t.conditionId === 'string' ? t.conditionId.trim() : '';
  const wallet = typeof t.proxyWallet === 'string' ? t.proxyWallet.trim() : '';
  const side = t.side === 'SELL' ? 'SELL' : 'BUY';
  const outcome = typeof t.outcome === 'string' ? t.outcome.trim() : '';
  const title = typeof t.title === 'string' ? t.title.trim() : '';
  const tx = typeof t.transactionHash === 'string' ? t.transactionHash.trim() : '';

  return { ts, wallet, side, outcome, price, size, title, url: toPolymarketUrl(t), conditionId, tx };
}

export const polymarketTradesTool: Tool = {
  name: 'polymarket_trades',
  description: 'Fetch recent Polymarket trades via the free Data API.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      marketId: {
        type: 'string',
        description: 'Polymarket market id (Gamma id like "516710") or conditionId (0x...). Optional.'
      },
      user: { type: 'string', description: 'Wallet address (0x...). Optional.' },
      limit: { type: 'integer', description: 'Max trades (1-500).', minimum: 1, maximum: 500 },
      minSize: { type: 'number', description: 'Filter out small trades. Optional.' }
    }
  },
  execute: async (params) => {
    const p = isRecord(params) ? params : {};
    const marketId = pickString(p.marketId).trim();
    const user = pickString(p.user).trim();
    const limit = pickInt(p.limit, 50, { min: 1, max: 500 });
    const minSize = pickNumber(p.minSize) ?? 0;

    const conditionId = marketId ? await resolveConditionIdHex(marketId) : null;

    const url = new URL(`${DATA_API_BASE}/trades`);
    url.searchParams.set('limit', String(limit));
    if (user) url.searchParams.set('user', user);
    if (conditionId) url.searchParams.set('market', conditionId);

    const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Polymarket Data API HTTP ${response.status}${text ? `: ${text}` : ''}`);
    }

    const data = (await response.json()) as unknown;
    const rawTrades = Array.isArray(data) ? (data as PolymarketTrade[]) : [];

    const trades: ParsedTrade[] = [];
    for (const t of rawTrades) {
      const parsed = parseTrade(t);
      if (!parsed) continue;
      if (parsed.size < minSize) continue;
      trades.push(parsed);
    }

    return { marketId: marketId || null, conditionId: conditionId || null, user: user || null, trades };
  },
  render: (result): ToolOutput[] => {
    const r = isRecord(result) ? result : {};
    const marketId = pickString(r.marketId).trim();
    const conditionId = pickString(r.conditionId).trim();
    const user = pickString(r.user).trim();
    const tradesRaw = Array.isArray(r.trades) ? r.trades : [];

    const rows: Array<Array<string | number>> = [];
    for (const t of tradesRaw.slice(0, 50)) {
      const trade = isRecord(t) ? t : {};
      rows.push([
        new Date(pickInt(trade.ts, 0)).toISOString(),
        pickString(trade.side).trim(),
        pickString(trade.outcome).trim(),
        Number((pickNumber(trade.price) ?? 0).toFixed(4)),
        Number((pickNumber(trade.size) ?? 0).toFixed(2)),
        pickString(trade.wallet).trim().slice(0, 12),
        pickString(trade.title).trim().slice(0, 80)
      ]);
    }

    const metaLines = [
      marketId ? `marketId=${marketId}` : null,
      conditionId ? `conditionId=${conditionId}` : null,
      user ? `user=${user}` : null,
      `trades=${tradesRaw.length}`
    ].filter(Boolean);

    return [
      { kind: 'text', title: 'Meta', text: metaLines.join(' ') || '—' },
      { kind: 'table', title: 'Trades', columns: ['ts', 'side', 'outcome', 'price', 'size', 'wallet', 'title'], rows }
    ];
  },
  targetWindow: 'poly'
};

