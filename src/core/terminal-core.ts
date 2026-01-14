import { parseCommandLine } from './parse.js';
import type { CommandContext, CommandSpec, ToolOutput } from './types.js';

type RewrittenCommand = { name: string; args: string[] };

function maybeRewriteTickerStyle(parts: string[]): RewrittenCommand | null {
  if (parts.length < 2) return null;

  const upper = parts.map((p) => p.toUpperCase());

  // Supported shapes:
  // - AAPL US DES
  // - AAPL DES
  // - AAPL US CF 5
  const ticker = upper[0];
  const second = upper[1];

  const hasCountry = /^[A-Z]{2,3}$/.test(second);
  const cmd = hasCountry ? upper[2] : second;
  const rest = hasCountry ? parts.slice(3) : parts.slice(2);

  if (!cmd) return null;

  if (cmd === 'HELP' || cmd === '?') return { name: 'help', args: [] };

  if (cmd === 'DES') {
    return { name: 'edgar', args: ['ticker', ticker] };
  }

  if (cmd === 'CF') {
    const count = rest[0] ? String(rest[0]) : '10';
    return { name: 'edgar', args: ['filings', ticker, count] };
  }

  return null;
}

export class TerminalCore {
  private readonly commandsByName: Map<string, CommandSpec>;

  constructor(commands: CommandSpec[]) {
    this.commandsByName = new Map();
    for (const command of commands) {
      this.commandsByName.set(command.name, command);
    }
  }

  listCommands(): CommandSpec[] {
    return [...this.commandsByName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async execute(input: string, ctx: CommandContext): Promise<ToolOutput[]> {
    const trimmed = input.trim();
    if (!trimmed) return [];

    const parts = parseCommandLine(trimmed);
    const [commandName, ...args] = parts;
    let command = this.commandsByName.get(commandName);
    let finalArgs = args;

    if (!command) {
      const rewritten = maybeRewriteTickerStyle(parts);
      if (rewritten) {
        command = this.commandsByName.get(rewritten.name);
        finalArgs = rewritten.args;
      }
    }

    if (!command) {
      return [
        {
          kind: 'error',
          message: `Unknown command: ${commandName}. Try: help`
        }
      ];
    }

    try {
      return await command.handler(finalArgs, ctx);
    } catch (error) {
      return [
        {
          kind: 'error',
          message: error instanceof Error ? error.message : String(error)
        }
      ];
    }
  }
}
