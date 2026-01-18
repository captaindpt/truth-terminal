import type { Tool } from './types.js';
import type { ToolOutput } from '../core/types.js';
import { isRecord, pickInt, pickString } from './utils.js';

const SYMBOL_TO_ID: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  DOGE: 'dogecoin',
  ADA: 'cardano',
  BNB: 'binancecoin',
  XRP: 'ripple'
};

function parseQueryToIds(query: string): string[] {
  const parts = query
    .split(/[,\s]+/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const ids: string[] = [];
  for (const p of parts) {
    const upper = p.toUpperCase();
    const id = SYMBOL_TO_ID[upper] || p.toLowerCase();
    ids.push(id);
  }
  return Array.from(new Set(ids)).slice(0, 25);
}

export const coingeckoPriceTool: Tool = {
  name: 'coingecko_price',
  description: 'Fetch crypto spot prices via CoinGecko (free).',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', description: 'Symbols or ids, e.g. "BTC ETH solana".' },
      vsCurrency: { type: 'string', description: 'Quote currency (default: usd).' }
    },
    required: ['query']
  },
  execute: async (params) => {
    const p = isRecord(params) ? params : {};
    const query = pickString(p.query).trim();
    if (!query) throw new Error('query is required');
    const vsCurrency = (pickString(p.vsCurrency).trim() || 'usd').toLowerCase();

    const ids = parseQueryToIds(query);
    if (!ids.length) throw new Error('No valid ids parsed from query');

    const url = new URL('https://api.coingecko.com/api/v3/simple/price');
    url.searchParams.set('ids', ids.join(','));
    url.searchParams.set('vs_currencies', vsCurrency);
    url.searchParams.set('include_24hr_change', 'true');
    url.searchParams.set('include_last_updated_at', 'true');

    const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`CoinGecko HTTP ${response.status}${text ? `: ${text}` : ''}`);
    }
    const data = (await response.json()) as unknown;
    return { ids, vsCurrency, data };
  },
  render: (result): ToolOutput[] => {
    const r = isRecord(result) ? result : {};
    const ids = Array.isArray(r.ids) ? r.ids.map((x) => pickString(x)).filter(Boolean) : [];
    const vs = pickString(r.vsCurrency).trim() || 'usd';
    const data = isRecord(r.data) ? r.data : {};

    const rows: Array<Array<string | number>> = [];
    for (const id of ids) {
      const row = isRecord(data[id]) ? (data[id] as Record<string, unknown>) : {};
      const price = typeof row[vs] === 'number' ? (row[vs] as number) : Number.NaN;
      const ch = typeof row[`${vs}_24hr_change`] === 'number' ? (row[`${vs}_24hr_change`] as number) : Number.NaN;
      const updated = typeof row.last_updated_at === 'number' ? new Date(row.last_updated_at * 1000).toISOString() : '';
      rows.push([id, Number.isFinite(price) ? price : '—', Number.isFinite(ch) ? Number(ch.toFixed(2)) : '—', updated || '']);
    }

    return [{ kind: 'table', title: `CoinGecko (${vs})`, columns: ['id', 'price', '24h_change_%', 'updatedAt'], rows }];
  },
  targetWindow: 'intel'
};

