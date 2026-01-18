export type GdeltNewsItem = {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
};

export type GdeltFetchMeta = {
  cached: boolean;
  shared: boolean;
  durationMs: number;
  timeoutMs: number;
};

const CACHE_TTL_MS = 30_000;
const MIN_INTERVAL_MS = 5200; // GDELT asks for <= 1 request per ~5s
const cache = new Map<string, { ts: number; items: GdeltNewsItem[] }>();
const inflight = new Map<string, Promise<GdeltNewsItem[]>>();

let gate: Promise<unknown> = Promise.resolve();
let nextAllowedAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runRateLimited<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const now = Date.now();
    const waitMs = Math.max(0, nextAllowedAt - now);
    if (waitMs) await sleep(waitMs);
    nextAllowedAt = Date.now() + MIN_INTERVAL_MS;
    return fn();
  };
  const p = gate.then(run, run);
  gate = p.then(
    () => undefined,
    () => undefined
  );
  return p;
}

function normalizeQuery(query: string): string {
  return query.trim() ? query.trim() : '(breaking OR announced OR report OR reports)';
}

function normalizeLimit(limit: number): number {
  return Math.max(1, Math.min(50, limit));
}

function toIsoOrEmpty(value: unknown): string {
  if (typeof value !== 'string') return '';
  // GDELT uses: YYYYMMDDTHHMMSSZ
  const gdelt = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (gdelt) {
    const [, y, mo, d, h, mi, s] = gdelt;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return '';
  return parsed.toISOString();
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fetch(url, init);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && (err as any).name === 'AbortError') {
      throw new Error(`GDELT timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchGdeltNewsWithMeta(
  query: string,
  limit: number,
  opts: { timeoutMs?: number } = {}
): Promise<{ items: GdeltNewsItem[]; meta: GdeltFetchMeta }> {
  const startedAt = Date.now();
  const q = normalizeQuery(query);
  const max = normalizeLimit(limit);
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 15000;

  const cacheKey = `${q}::${max}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return { items: cached.items, meta: { cached: true, shared: false, durationMs: Date.now() - startedAt, timeoutMs } };
  }

  const existing = inflight.get(cacheKey);
  if (existing) {
    const items = await existing;
    return { items, meta: { cached: false, shared: true, durationMs: Date.now() - startedAt, timeoutMs } };
  }

  const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  url.searchParams.set('query', q);
  url.searchParams.set('mode', 'ArtList');
  url.searchParams.set('format', 'json');
  url.searchParams.set('maxrecords', String(max));
  url.searchParams.set('sort', 'HybridRel');

  const p = runRateLimited(async () => {
    const res = await fetchWithTimeout(
      url.toString(),
      {
        headers: {
          Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
          'User-Agent': 'truth-terminal/1.0 (+https://localhost)'
        }
      },
      timeoutMs
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 429) {
        throw new Error('GDELT rate limited (HTTP 429). Try again in ~5 seconds.');
      }
      throw new Error(`GDELT HTTP ${res.status}${text ? `: ${text}` : ''}`);
    }

    const raw = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`GDELT returned non-JSON: ${raw.slice(0, 200)}`);
    }

    const parsed = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
    const articles = Array.isArray(parsed.articles) ? parsed.articles : [];

    const out: GdeltNewsItem[] = [];
    for (const a of articles) {
      const row = typeof a === 'object' && a !== null ? (a as Record<string, unknown>) : {};
      const title = typeof row.title === 'string' ? row.title.trim() : '';
      const url = typeof row.url === 'string' ? row.url.trim() : '';
      if (!title || !url) continue;
      const source =
        (typeof row.domain === 'string' ? row.domain.trim() : '') ||
        (typeof row.sourcecountry === 'string' ? row.sourcecountry.trim() : '') ||
        (typeof row.source === 'string' ? row.source.trim() : '') ||
        'unknown';
      const publishedAt = toIsoOrEmpty(row.seendate) || toIsoOrEmpty(row.date) || toIsoOrEmpty(row.publishedat) || '';
      out.push({ title, url, source, publishedAt });
    }

    cache.set(cacheKey, { ts: Date.now(), items: out });
    return out;
  });

  inflight.set(cacheKey, p);
  try {
    const items = await p;
    return { items, meta: { cached: false, shared: false, durationMs: Date.now() - startedAt, timeoutMs } };
  } finally {
    inflight.delete(cacheKey);
  }
}

export async function fetchGdeltNews(
  query: string,
  limit: number,
  opts: { timeoutMs?: number } = {}
): Promise<GdeltNewsItem[]> {
  const { items } = await fetchGdeltNewsWithMeta(query, limit, opts);
  return items;
}
