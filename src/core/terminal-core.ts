import { parseCommandLine } from './parse.js';
import type { CommandContext, CommandSpec, ToolOutput } from './types.js';

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
    const command = this.commandsByName.get(commandName);

    if (!command) {
      return [
        {
          kind: 'error',
          message: `Unknown command: ${commandName}. Try: help`
        }
      ];
    }

    try {
      return await command.handler(args, ctx);
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
