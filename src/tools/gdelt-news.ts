import type { Tool } from './types.js';
import type { ToolOutput } from '../core/types.js';
import { isRecord, pickInt, pickString } from './utils.js';
import { fetchGdeltNewsWithMeta } from './providers/gdelt.js';

export const gdeltNewsTool: Tool = {
  name: 'gdelt_news',
  description: 'Fetch recent news headlines via GDELT (free).',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', description: 'Search query (optional; defaults to a broad breaking-news query).' },
      limit: { type: 'integer', description: 'Max headlines (1-50).', minimum: 1, maximum: 50 }
    },
    required: []
  },
  execute: async (params) => {
    const p = isRecord(params) ? params : {};
    let query = pickString(p.query).trim();
    if (!query) query = '(breaking OR announced OR report OR reports)';

    if (query.length > 0 && query.length < 3) {
      if (query.toLowerCase() === 'ai') query = 'artificial intelligence';
      else throw new Error('Query too short; use a longer phrase (e.g. "artificial intelligence")');
    }

    const limit = pickInt(p.limit, 20, { min: 1, max: 50 });
    const { items, meta } = await fetchGdeltNewsWithMeta(query, limit);
    return { query, items, cached: Boolean(meta?.cached), meta };
  },
  render: (result): ToolOutput[] => {
    const r = isRecord(result) ? result : {};
    const q = pickString(r.query).trim();
    const itemsRaw = Array.isArray(r.items) ? r.items : [];
    const meta = isRecord(r.meta) ? r.meta : {};
    const cached = meta.cached === true;
    const shared = meta.shared === true;
    const durationMs = typeof meta.durationMs === 'number' && Number.isFinite(meta.durationMs) ? Math.round(meta.durationMs) : null;
    const timeoutMs = typeof meta.timeoutMs === 'number' && Number.isFinite(meta.timeoutMs) ? Math.round(meta.timeoutMs) : null;
    const rows: Array<[string, string, string, string]> = [];

    for (const it of itemsRaw) {
      const item = isRecord(it) ? it : {};
      rows.push([
        pickString(item.publishedAt).trim(),
        pickString(item.source).trim(),
        pickString(item.title).trim(),
        pickString(item.url).trim()
      ]);
    }

    return [
      { kind: 'text', title: 'Query', text: q || '—' },
      {
        kind: 'text',
        title: 'Meta',
        text: [`cached=${cached}`, `shared=${shared}`, durationMs == null ? null : `durationMs=${durationMs}`, timeoutMs == null ? null : `timeoutMs=${timeoutMs}`]
          .filter(Boolean)
          .join(' ')
      },
      { kind: 'table', title: 'Headlines', columns: ['publishedAt', 'source', 'title', 'url'], rows }
    ];
  },
  targetWindow: 'news'
};
