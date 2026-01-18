import type { Tool } from './types.js';
import type { ToolOutput } from '../core/types.js';
import { isRecord, pickString } from './utils.js';
import { getNasdaqCandlesWithMeta } from './providers/nasdaq.js';

export const nasdaqCandlesTool: Tool = {
  name: 'nasdaq_candles',
  description: 'Fetch OHLCV candles via Nasdaq (free).',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      symbol: { type: 'string', description: 'Ticker symbol, e.g. "AAPL".' },
      range: { type: 'string', description: '1d | 5d | 1mo (default: 1d).' },
      interval: { type: 'string', description: '1m | 5m | 30m (default: 1m). For 5d/1mo, interval is ignored.' }
    },
    required: ['symbol']
  },
  execute: async (params) => {
    const p = isRecord(params) ? params : {};
    const symbol = pickString(p.symbol).trim().toUpperCase();
    if (!symbol) throw new Error('symbol is required');
    if (!/^[A-Z0-9.\-=_^]{1,15}$/.test(symbol)) throw new Error('Invalid symbol');

    const range = (pickString(p.range).trim() || '1d').toLowerCase();
    const interval = (pickString(p.interval).trim() || '1m').toLowerCase();

    const { candles, meta } = await getNasdaqCandlesWithMeta(symbol, range, interval);
    return { candles, meta };
  },
  render: (result): ToolOutput[] => {
    const r = isRecord(result) ? result : {};
    const candles = isRecord(r.candles) ? r.candles : {};
    const meta = isRecord(r.meta) ? r.meta : {};

    const t = Array.isArray(candles.t) ? candles.t : [];
    const o = Array.isArray(candles.o) ? candles.o : [];
    const h = Array.isArray(candles.h) ? candles.h : [];
    const l = Array.isArray(candles.l) ? candles.l : [];
    const c = Array.isArray(candles.c) ? candles.c : [];

    const cached = meta.cached === true;
    const durationMs = typeof meta.durationMs === 'number' && Number.isFinite(meta.durationMs) ? Math.round(meta.durationMs) : null;

    const points = Math.min(t.length, o.length, h.length, l.length, c.length);
    const lastIdx = points > 0 ? points - 1 : -1;
    const last = lastIdx >= 0 ? [new Date(Number(t[lastIdx])).toISOString(), o[lastIdx], h[lastIdx], l[lastIdx], c[lastIdx]] : [];

    return [
      { kind: 'text', title: 'Meta', text: [`cached=${cached}`, durationMs == null ? null : `durationMs=${durationMs}`, `points=${points}`].filter(Boolean).join(' ') },
      { kind: 'json', title: 'Last Candle', value: lastIdx >= 0 ? { t: last[0], o: last[1], h: last[2], l: last[3], c: last[4] } : null }
    ];
  },
  targetWindow: 'des'
};

