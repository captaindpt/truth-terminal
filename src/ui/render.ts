import type { ToolOutput } from '../core/types.js';

function padRight(text: string, width: number): string {
  if (text.length >= width) return text;
  return text + ' '.repeat(width - text.length);
}

function stringifyCell(value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  return value;
}

export function renderOutputs(outputs: ToolOutput[]): string {
  const lines: string[] = [];

  for (const output of outputs) {
    if (output.kind === 'error') {
      lines.push(`Error: ${output.message}`);
      continue;
    }

    if (output.kind === 'text') {
      if (output.title) lines.push(output.title);
      lines.push(output.text);
      continue;
    }

    if (output.kind === 'json') {
      if (output.title) lines.push(output.title);
      lines.push(JSON.stringify(output.value, null, 2));
      continue;
    }

    if (output.kind === 'table') {
      if (output.title) lines.push(output.title);

      const rows = output.rows.map((row) => row.map(stringifyCell));
      const widths = output.columns.map((column, index) => {
        const maxCell = Math.max(column.length, ...rows.map((row) => (row[index] ?? '').length));
        return Math.min(maxCell, 80);
      });

      const header = output.columns.map((column, i) => padRight(column, widths[i])).join('  ');
      lines.push(header);
      lines.push(widths.map((w) => '-'.repeat(w)).join('  '));

      for (const row of rows) {
        const line = row.map((cell, i) => padRight(cell.slice(0, widths[i]), widths[i])).join('  ');
        lines.push(line);
      }
      continue;
    }
  }

  return lines.join('\n');
}

