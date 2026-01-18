import type { ToolOutput } from '../core/types.js';

export type JSONSchema = Record<string, unknown>;

export interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (params: unknown) => Promise<unknown>;
  render?: (result: unknown) => ToolOutput[];
  targetWindow?: string;
}

