import { grokLiveSearch } from '../agents/grok.js';
import type { CommandSpec, ToolOutput } from '../core/types.js';

export function grokCommand(): CommandSpec {
  return {
    name: 'grok',
    description: 'Search X/web/news via Grok Live Search',
    usage: 'grok <query>',
    handler: async (args) => {
      const query = args.join(' ').trim();
      if (!query) {
        return [{ kind: 'error', message: 'Usage: grok <query>' }];
      }

      const result = await grokLiveSearch({ query });

      const outputs: ToolOutput[] = [];
      outputs.push({ kind: 'text', title: 'Answer', text: result.content });

      if (result.citations?.length) {
        outputs.push({
          kind: 'table',
          title: 'Citations',
          columns: ['#', 'URL'],
          rows: result.citations.map((url, i) => [i + 1, url])
        });
      }

      outputs.push({
        kind: 'text',
        title: 'Meta',
        text: `model=${result.model} sourcesUsed=${result.sourcesUsed}`
      });

      return outputs;
    }
  };
}
