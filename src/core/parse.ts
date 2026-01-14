export function parseCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quote) {
      if (char === quote) {
        quote = null;
        continue;
      }
      if (char === '\\' && i + 1 < input.length) {
        const next = input[i + 1];
        if (next === quote || next === '\\') {
          current += next;
          i++;
          continue;
        }
      }
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error(`Unclosed quote: ${quote}`);
  }
  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}
