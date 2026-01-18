import { grokLiveSearch } from '../agents/grok.js';
import type { Tool } from './types.js';
import type { ToolOutput } from '../core/types.js';
import { isRecord, pickInt, pickString, pickStringArray } from './utils.js';

export const grokSearchTool: Tool = {
  name: 'grok_search',
  description: 'Search X/web/news via Grok Live Search (xAI).',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', description: 'Search query (be specific).' },
      sources: {
        type: 'array',
        description: 'Subset of sources to search.',
        items: { type: 'string', enum: ['web', 'x', 'news'] }
      },
      maxResults: { type: 'integer', description: 'Max sources to use (cost scales with this).', minimum: 1, maximum: 50 }
    },
    required: ['query']
  },
  execute: async (params) => {
    const p = isRecord(params) ? params : {};
    const query = pickString(p.query).trim();
    if (!query) throw new Error('query is required');

    const sourcesRaw = pickStringArray(p.sources);
    const sources = sourcesRaw.filter((s) => s === 'web' || s === 'x' || s === 'news') as Array<'web' | 'x' | 'news'>;
    const maxResults = pickInt(p.maxResults, 20, { min: 1, max: 50 });

    return grokLiveSearch({ query, sources: sources.length ? sources : undefined, maxResults });
  },
  render: (result): ToolOutput[] => {
    const r = isRecord(result) ? result : {};
    const content = pickString(r.content).trim();
    const citations = pickStringArray(r.citations);
    const model = pickString(r.model).trim();
    const sourcesUsed = pickInt(r.sourcesUsed, 0, { min: 0, max: 10_000 });

    const outputs: ToolOutput[] = [];
    outputs.push({ kind: 'text', title: 'Answer', text: content || '—' });

    if (citations.length) {
      outputs.push({
        kind: 'table',
        title: 'Citations',
        columns: ['#', 'URL'],
        rows: citations.map((url, i) => [i + 1, url])
      });
    }

    outputs.push({ kind: 'text', title: 'Meta', text: `model=${model || '—'} sourcesUsed=${sourcesUsed}` });
    return outputs;
  },
  targetWindow: 'intel'
};

