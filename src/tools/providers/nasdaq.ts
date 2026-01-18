export type NasdaqQuote = {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  price: number;
  change: number;
  changePercent: number;
  marketCap: number | null;
  time: number;
};

export type NasdaqCandles = {
  t: number[]; // ms
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
  meta: { symbol: string; exchange: string; currency: string };
};

export type NasdaqFetchMeta = {
  cached: boolean;
  durationMs: number;
  timeoutMs: number;
};

const quoteCache = new Map<string, { ts: number; quote: NasdaqQuote }>();
const candlesCache = new Map<string, { ts: number; candles: NasdaqCandles }>();

function ymd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseMaybeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return Number.NaN;
  const cleaned = value.replaceAll(/[$,%\s]/g, '').replaceAll(',', '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : Number.NaN;
}

function nasdaqHeaders(): Record<string, string> {
  return {
    Accept: 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0',
    Origin: 'https://www.nasdaq.com',
    Referer: 'https://www.nasdaq.com/'
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fetch(url, init);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && (err as any).name === 'AbortError') {
      throw new Error(`Nasdaq timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchNasdaqChart(symbol: string, params: Record<string, string>, timeoutMs: number): Promise<any> {
  const url = new URL(`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/chart`);
  url.searchParams.set('assetclass', 'stocks');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetchWithTimeout(url.toString(), { headers: nasdaqHeaders() }, timeoutMs);
  if (!res.ok) throw new Error(`Nasdaq chart HTTP ${res.status}`);
  return res.json();
}

async function fetchNasdaqQuoteUncached(symbol: string, timeoutMs: number): Promise<NasdaqQuote> {
  const data: any = await fetchNasdaqChart(symbol, {}, timeoutMs);
  const d = data?.data;
  if (!d) throw new Error('No Nasdaq data');

  const price = parseMaybeNumber(d.lastSalePrice);
  const change = parseMaybeNumber(d.netChange);
  const changePercent = parseMaybeNumber(d.percentageChange);
  const previousClose = parseMaybeNumber(d.previousClose);
  const px = Number.isFinite(price) ? price : Number.isFinite(previousClose) ? previousClose : Number.NaN;

  return {
    symbol,
    name: String(d.company || symbol),
    exchange: String(d.exchange || 'US'),
    currency: 'USD',
    price: px,
    change: Number.isFinite(change) ? change : Number.NaN,
    changePercent: Number.isFinite(changePercent) ? changePercent : Number.NaN,
    marketCap: null,
    time: Date.now()
  };
}

async function fetchNasdaqCandlesUncached(symbol: string, range: string, interval: string, timeoutMs: number): Promise<NasdaqCandles> {
  const allowedRanges = new Set(['1d', '5d', '1mo']);
  const safeRange = allowedRanges.has(range) ? range : '1d';
  const safeInterval = interval;

  if (safeRange === '1d') {
    const data: any = await fetchNasdaqChart(symbol, {}, timeoutMs);
    const points: any[] = Array.isArray(data?.data?.chart) ? data.data.chart : [];
    const exchange = String(data?.data?.exchange || 'US');

    const minutes = safeInterval === '5m' ? 5 : safeInterval === '30m' ? 30 : 1;
    const bucketMs = minutes * 60 * 1000;
    points.sort((a, b) => Number(a?.x || 0) - Number(b?.x || 0));

    const t: number[] = [];
    const o: number[] = [];
    const h: number[] = [];
    const l: number[] = [];
    const c: number[] = [];
    const v: number[] = [];

    let bucket = -1;
    let open = 0;
    let high = -Infinity;
    let low = Infinity;
    let close = 0;
    let has = false;

    function flush() {
      if (!has) return;
      t.push(bucket);
      o.push(open);
      h.push(high);
      l.push(low);
      c.push(close);
      v.push(0);
    }

    for (const p of points) {
      const x = Number(p?.x);
      const y = Number(p?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const b = Math.floor(x / bucketMs) * bucketMs;
      if (bucket !== -1 && b !== bucket) {
        flush();
        has = false;
        high = -Infinity;
        low = Infinity;
      }
      if (!has) {
        bucket = b;
        open = y;
        close = y;
        high = y;
        low = y;
        has = true;
      } else {
        close = y;
        if (y > high) high = y;
        if (y < low) low = y;
      }
    }
    flush();

    return { t, o, h, l, c, v, meta: { symbol, exchange, currency: 'USD' } };
  }

  const lookbackDays = safeRange === '5d' ? 10 : 45;
  const to = new Date();
  const from = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const data: any = await fetchNasdaqChart(symbol, { fromdate: ymd(from), todate: ymd(to) }, timeoutMs);
  const points: any[] = Array.isArray(data?.data?.chart) ? data.data.chart : [];
  const exchange = String(data?.data?.exchange || 'US');

  const t: number[] = [];
  const o: number[] = [];
  const h: number[] = [];
  const l: number[] = [];
  const c: number[] = [];
  const v: number[] = [];

  for (const p of points) {
    const x = Number(p?.x);
    const z = p?.z || {};
    const open = parseMaybeNumber(z.open);
    const high = parseMaybeNumber(z.high);
    const low = parseMaybeNumber(z.low);
    const close = parseMaybeNumber(z.close);
    const vol = typeof z.volume === 'string' ? Number(z.volume.replaceAll(',', '')) : Number(z.volume ?? 0);

    if (!Number.isFinite(x) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) continue;
    t.push(x);
    o.push(open);
    h.push(high);
    l.push(low);
    c.push(close);
    v.push(Number.isFinite(vol) ? vol : 0);
  }

  return { t, o, h, l, c, v, meta: { symbol, exchange, currency: 'USD' } };
}

export async function getNasdaqQuoteWithMeta(
  symbol: string,
  opts: { timeoutMs?: number; cacheTtlMs?: number } = {}
): Promise<{ quote: NasdaqQuote; meta: NasdaqFetchMeta }> {
  const startedAt = Date.now();
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 12_000;
  const cacheTtlMs = typeof opts.cacheTtlMs === 'number' ? opts.cacheTtlMs : 3_000;

  const cached = quoteCache.get(symbol);
  const now = Date.now();
  if (cached && now - cached.ts < cacheTtlMs) {
    return { quote: cached.quote, meta: { cached: true, durationMs: Date.now() - startedAt, timeoutMs } };
  }

  const quote = await fetchNasdaqQuoteUncached(symbol, timeoutMs);
  quoteCache.set(symbol, { ts: Date.now(), quote });
  return { quote, meta: { cached: false, durationMs: Date.now() - startedAt, timeoutMs } };
}

export async function getNasdaqCandlesWithMeta(
  symbol: string,
  range: string,
  interval: string,
  opts: { timeoutMs?: number; cacheTtlMs?: number } = {}
): Promise<{ candles: NasdaqCandles; meta: NasdaqFetchMeta }> {
  const startedAt = Date.now();
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 12_000;
  const cacheTtlMs = typeof opts.cacheTtlMs === 'number' ? opts.cacheTtlMs : 5_000;

  const key = `${symbol}::${range}::${interval}`;
  const cached = candlesCache.get(key);
  const now = Date.now();
  if (cached && now - cached.ts < cacheTtlMs) {
    return { candles: cached.candles, meta: { cached: true, durationMs: Date.now() - startedAt, timeoutMs } };
  }

  const candles = await fetchNasdaqCandlesUncached(symbol, range, interval, timeoutMs);
  candlesCache.set(key, { ts: Date.now(), candles });
  return { candles, meta: { cached: false, durationMs: Date.now() - startedAt, timeoutMs } };
}

