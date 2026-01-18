import type { Tool } from './types.js';
import type { ToolOutput } from '../core/types.js';
import { isRecord, pickString } from './utils.js';
import { getNasdaqQuoteWithMeta } from './providers/nasdaq.js';

export const nasdaqQuoteTool: Tool = {
  name: 'nasdaq_quote',
  description: 'Fetch a US stock quote via Nasdaq (free; ~15min delayed).',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      symbol: { type: 'string', description: 'Ticker symbol, e.g. "AAPL".' }
    },
    required: ['symbol']
  },
  execute: async (params) => {
    const p = isRecord(params) ? params : {};
    const symbol = pickString(p.symbol).trim().toUpperCase();
    if (!symbol) throw new Error('symbol is required');
    if (!/^[A-Z0-9.\-=_^]{1,15}$/.test(symbol)) throw new Error('Invalid symbol');

    const { quote, meta } = await getNasdaqQuoteWithMeta(symbol);
    return { quote, meta };
  },
  render: (result): ToolOutput[] => {
    const r = isRecord(result) ? result : {};
    const quote = isRecord(r.quote) ? r.quote : {};
    const meta = isRecord(r.meta) ? r.meta : {};

    const symbol = pickString(quote.symbol).trim();
    const name = pickString(quote.name).trim();
    const exchange = pickString(quote.exchange).trim();
    const currency = pickString(quote.currency).trim();

    const price = typeof quote.price === 'number' && Number.isFinite(quote.price) ? quote.price : null;
    const change = typeof quote.change === 'number' && Number.isFinite(quote.change) ? quote.change : null;
    const changePercent = typeof quote.changePercent === 'number' && Number.isFinite(quote.changePercent) ? quote.changePercent : null;
    const time = typeof quote.time === 'number' && Number.isFinite(quote.time) ? new Date(quote.time).toISOString() : '';

    const cached = meta.cached === true;
    const durationMs = typeof meta.durationMs === 'number' && Number.isFinite(meta.durationMs) ? Math.round(meta.durationMs) : null;

    return [
      { kind: 'text', title: 'Meta', text: [`cached=${cached}`, durationMs == null ? null : `durationMs=${durationMs}`].filter(Boolean).join(' ') },
      {
        kind: 'table',
        title: 'Quote',
        columns: ['symbol', 'name', 'exchange', 'currency', 'price', 'change', 'changePct', 'time'],
        rows: [[symbol, name, exchange, currency, price, change, changePercent, time]]
      }
    ];
  },
  targetWindow: 'des'
};

