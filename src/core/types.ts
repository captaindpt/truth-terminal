export type ToolOutput =
  | { kind: 'text'; title?: string; text: string }
  | { kind: 'table'; title?: string; columns: string[]; rows: Array<Array<string | number | null>> }
  | { kind: 'json'; title?: string; value: unknown }
  | { kind: 'error'; message: string };

export interface CommandContext {
  now: Date;
  env: NodeJS.ProcessEnv;
}

export type CommandHandler = (args: string[], ctx: CommandContext) => Promise<ToolOutput[]>;

export interface CommandSpec {
  name: string;
  description: string;
  usage: string;
  handler: CommandHandler;
}
