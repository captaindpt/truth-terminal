import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { TerminalCore } from '../core/index.js';
import type { CommandContext, CommandSpec } from '../core/types.js';
import { edgarCommand, grokCommand } from '../integrations/index.js';
import { renderOutputs } from './render.js';

function helpCommand(getCommands: () => CommandSpec[]): CommandSpec {
  return {
    name: 'help',
    description: 'Show help',
    usage: 'help',
    handler: async () => {
      const commands = [...getCommands()].sort((a, b) => a.name.localeCompare(b.name));
      return [
        {
          kind: 'table',
          title: 'Commands',
          columns: ['command', 'usage', 'description'],
          rows: commands.map((c) => [c.name, c.usage, c.description])
        }
      ];
    }
  };
}

function exitCommand(): CommandSpec {
  return {
    name: 'exit',
    description: 'Exit the terminal',
    usage: 'exit',
    handler: async () => [{ kind: 'text', text: 'bye' }]
  };
}

function quitCommand(): CommandSpec {
  return {
    name: 'quit',
    description: 'Exit the terminal',
    usage: 'quit',
    handler: async () => [{ kind: 'text', text: 'bye' }]
  };
}

function buildCore(): TerminalCore {
  const commands: CommandSpec[] = [];
  commands.push(helpCommand(() => commands));
  commands.push(exitCommand());
  commands.push(quitCommand());
  commands.push(grokCommand());
  commands.push(edgarCommand());
  return new TerminalCore(commands);
}

function buildContext(): CommandContext {
  return {
    now: new Date(),
    env: process.env
  };
}

async function runOnce(core: TerminalCore, line: string): Promise<void> {
  const ctx = buildContext();
  const outputs = await core.execute(line, ctx);
  if (outputs.length > 0) {
    output.write(renderOutputs(outputs) + '\n');
  }
}

async function runRepl(core: TerminalCore): Promise<void> {
  const rl = createInterface({ input, output });
  output.write('Truth Terminal (type: help, exit)\n');

  while (true) {
    const line = await rl.question('tt> ');
    const trimmed = line.trim();
    if (!trimmed) continue;

    const ctx = buildContext();
    const outputs = await core.execute(trimmed, ctx);
    if (outputs.length > 0) {
      output.write(renderOutputs(outputs) + '\n');
    }

    if (trimmed === 'exit' || trimmed === 'quit') break;
  }

  rl.close();
}

function printCliHelp(): void {
  output.write(
    [
      'Usage:',
      '  npm run tt',
      '  npm run tt -- --eval "<command>"',
      '',
      'Examples:',
      '  npm run tt -- --eval "edgar ticker AAPL"',
      '  npm run tt -- --eval "edgar filings AAPL 5"',
      '  npm run tt -- --eval "grok \\"what is the latest on...?\\""'
    ].join('\n') + '\n'
  );
}

async function main(): Promise<void> {
  const core = buildCore();

  const argv = process.argv.slice(2);
  const evalIndex = argv.indexOf('--eval');
  if (argv.includes('--help') || argv.includes('-h')) {
    printCliHelp();
    return;
  }

  if (evalIndex !== -1) {
    const command = argv.slice(evalIndex + 1).join(' ').trim();
    if (!command) {
      printCliHelp();
      process.exitCode = 2;
      return;
    }
    await runOnce(core, command);
    return;
  }

  await runRepl(core);
}

main().catch((error) => {
  output.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
