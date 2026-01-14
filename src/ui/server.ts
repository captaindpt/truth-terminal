import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TerminalCore } from '../core/index.js';
import type { CommandContext, CommandSpec } from '../core/types.js';
import { edgarCommand, grokCommand } from '../integrations/index.js';
import Anthropic from '@anthropic-ai/sdk';

type ChatRole = 'user' | 'assistant';
type ChatMessage = { role: ChatRole; text: string; ts: number };
type ToolEvent = {
  id: string;
  type: 'tool';
  title: string;
  command: string;
  outputs: unknown;
  targetWindow: string;
  ts: number;
};

type ChatSession = {
  id: string;
  messages: ChatMessage[];
  events: ToolEvent[];
};

const sessions = new Map<string, ChatSession>();
const anthropic = new Anthropic();

function buildContext(): CommandContext {
  return { now: new Date(), env: process.env };
}

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

function buildCore(): TerminalCore {
  const commands: CommandSpec[] = [];
  commands.push(helpCommand(() => commands));
  commands.push(grokCommand());
  commands.push(edgarCommand());
  return new TerminalCore(commands);
}

function getOrCreateSession(sessionId: string): ChatSession {
  const existing = sessions.get(sessionId);
  if (existing) return existing;
  const created: ChatSession = { id: sessionId, messages: [], events: [] };
  sessions.set(sessionId, created);
  return created;
}

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

async function llmReply(messages: ChatMessage[]): Promise<string> {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (!hasKey) {
    return 'Set ANTHROPIC_API_KEY to enable the agent. Meanwhile you can run tools via /exec, e.g. "/exec grok <query>" or "/exec edgar filings AAPL 5".';
  }

  const model = process.env.TT_AGENT_MODEL || 'claude-sonnet-4-20250514';
  const trimmed = messages.slice(-20).map((m) => ({
    role: m.role,
    content: m.text
  })) as Array<{ role: 'user' | 'assistant'; content: string }>;

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 800,
      system:
        'You are Truth Terminal: a concise research assistant. Be direct, use bullet points when helpful. If you need external data, ask the user to run a tool with /exec (for now).',
      messages: trimmed
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') throw new Error('No text response from Claude');
    return textBlock.text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Agent unavailable right now (${message}). Use /exec to run tools, e.g. "/exec grok <query>" or "/exec edgar filings AAPL 5".`;
  }
}

function json(res: any, statusCode: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(data));
  res.end(data);
}

function notFound(res: any): void {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Not found');
}

function contentTypeForPath(pathname: string): string {
  const ext = extname(pathname).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

async function readJson(req: any): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WEB_ROOT = join(__dirname, '..', '..', 'web');

async function serveStatic(req: any, res: any, pathname: string): Promise<void> {
  const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (relPath.includes('..')) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Bad request');
    return;
  }

  const filePath = join(WEB_ROOT, relPath);

  try {
    const bytes = await readFile(filePath);
    res.statusCode = 200;
    res.setHeader('Content-Type', contentTypeForPath(filePath));
    res.setHeader('Cache-Control', 'no-store');
    res.end(bytes);
  } catch {
    notFound(res);
  }
}

async function main(): Promise<void> {
  const core = buildCore();

  const port = Number(process.env.TT_UI_PORT || 7777);
  const host = process.env.TT_UI_HOST || '127.0.0.1';

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      if (pathname === '/api/health') {
        return json(res, 200, { ok: true });
      }

      if (pathname === '/api/exec' && req.method === 'POST') {
        const body = await readJson(req);
        const line = typeof body?.line === 'string' ? body.line : '';
        const outputs = await core.execute(line, buildContext());
        return json(res, 200, outputs);
      }

      if (pathname === '/api/chat' && req.method === 'POST') {
        const body = await readJson(req);
        const sessionId = typeof body?.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : 'default';
        const message = typeof body?.message === 'string' ? body.message.trim() : '';
        if (!message) return json(res, 400, { ok: false, error: 'message is required' });

        const session = getOrCreateSession(sessionId);
        const now = Date.now();
        session.messages.push({ role: 'user', text: message, ts: now });

        const toolEvents: ToolEvent[] = [];
        let assistantText = '';

        if (message.startsWith('/exec ')) {
          const command = message.slice('/exec '.length).trim();
          const outputs = await core.execute(command, buildContext());
          const event: ToolEvent = {
            id: newId('tool'),
            type: 'tool',
            title: 'exec',
            command,
            outputs,
            targetWindow: 'intel',
            ts: Date.now()
          };
          session.events.push(event);
          toolEvents.push(event);
          assistantText = `Ran: ${command}`;
        } else {
          assistantText = await llmReply(session.messages);
        }

        session.messages.push({ role: 'assistant', text: assistantText, ts: Date.now() });

        return json(res, 200, {
          ok: true,
          sessionId: session.id,
          assistant: assistantText,
          events: toolEvents
        });
      }

      if (pathname === '/api/commands') {
        const commands = core.listCommands().map((c) => ({
          name: c.name,
          usage: c.usage,
          description: c.description
        }));
        return json(res, 200, commands);
      }

      return serveStatic(req, res, pathname);
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  server.listen(port, host, () => {
    console.log(`Truth Terminal UI: http://${host}:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
