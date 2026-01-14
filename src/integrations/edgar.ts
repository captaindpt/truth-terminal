import type { CommandSpec, ToolOutput } from '../core/types.js';

type EdgarTickerRow = {
  cik_str: number;
  ticker: string;
  title: string;
};

let cachedTickers: EdgarTickerRow[] | null = null;

function getSecUserAgent(env: NodeJS.ProcessEnv): string {
  const ua = env.SEC_USER_AGENT?.trim();
  if (!ua) {
    throw new Error(
      'SEC_USER_AGENT env var is required for SEC requests (example: SEC_USER_AGENT="truth-terminal (email@example.com)")'
    );
  }
  return ua;
}

async function secFetchJson(url: string, env: NodeJS.ProcessEnv): Promise<any> {
  const userAgent = getSecUserAgent(env);
  const response = await fetch(url, {
    headers: {
      'User-Agent': userAgent,
      'Accept': 'application/json,text/plain;q=0.9,*/*;q=0.8'
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const retryAfter = response.headers.get('retry-after');
    const rateHint =
      response.status === 403
        ? ` SEC may be rate-limiting your IP/User-Agent; slow down and try again${retryAfter ? ` (retry-after=${retryAfter}s)` : ''
          }.`
        : '';
    throw new Error(`SEC HTTP ${response.status} for ${url}.${rateHint}${body ? ` Body: ${body}` : ''}`);
  }

  return response.json();
}

async function loadTickers(env: NodeJS.ProcessEnv): Promise<EdgarTickerRow[]> {
  if (cachedTickers) return cachedTickers;
  const raw = await secFetchJson('https://www.sec.gov/files/company_tickers.json', env);
  const rows = Object.values(raw) as EdgarTickerRow[];
  cachedTickers = rows;
  return rows;
}

function formatCik10(cik: number): string {
  return String(cik).padStart(10, '0');
}

function findTickerRow(rows: EdgarTickerRow[], ticker: string): EdgarTickerRow | undefined {
  const wanted = ticker.trim().toUpperCase();
  return rows.find((row) => row.ticker.toUpperCase() === wanted);
}

function buildPrimaryDocUrl(cik: number, accessionNumber: string, primaryDocument: string): string {
  const cikNoPad = String(cik);
  const accessionNoDashes = accessionNumber.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${cikNoPad}/${accessionNoDashes}/${primaryDocument}`;
}

async function tickerInfo(args: string[], env: NodeJS.ProcessEnv): Promise<ToolOutput[]> {
  const ticker = args[0];
  if (!ticker) return [{ kind: 'error', message: 'Usage: edgar ticker <TICKER>' }];

  const rows = await loadTickers(env);
  const row = findTickerRow(rows, ticker);
  if (!row) return [{ kind: 'error', message: `Ticker not found in SEC list: ${ticker}` }];

  return [
    {
      kind: 'table',
      title: 'Company',
      columns: ['ticker', 'cik', 'name'],
      rows: [[row.ticker, formatCik10(row.cik_str), row.title]]
    }
  ];
}

async function recentFilings(args: string[], env: NodeJS.ProcessEnv): Promise<ToolOutput[]> {
  const ticker = args[0];
  const count = args[1] ? Number(args[1]) : 10;

  if (!ticker) return [{ kind: 'error', message: 'Usage: edgar filings <TICKER> [count]' }];
  if (!Number.isFinite(count) || count <= 0 || count > 50) {
    return [{ kind: 'error', message: 'count must be 1-50' }];
  }

  const rows = await loadTickers(env);
  const row = findTickerRow(rows, ticker);
  if (!row) return [{ kind: 'error', message: `Ticker not found in SEC list: ${ticker}` }];

  const cik10 = formatCik10(row.cik_str);
  const submissions = await secFetchJson(`https://data.sec.gov/submissions/CIK${cik10}.json`, env);
  const recent = submissions?.filings?.recent;

  if (!recent?.accessionNumber?.length) {
    return [{ kind: 'error', message: `No recent filings found for ${row.ticker}` }];
  }

  const accessionNumbers: string[] = recent.accessionNumber;
  const filingDates: string[] = recent.filingDate;
  const forms: string[] = recent.form;
  const primaryDocuments: string[] = recent.primaryDocument;

  const limit = Math.min(count, accessionNumbers.length);
  const outRows: Array<Array<string>> = [];

  for (let i = 0; i < limit; i++) {
    const accession = accessionNumbers[i];
    const form = forms[i] ?? '';
    const date = filingDates[i] ?? '';
    const doc = primaryDocuments[i] ?? '';
    const url = doc ? buildPrimaryDocUrl(row.cik_str, accession, doc) : '';
    outRows.push([date, form, accession, url]);
  }

  return [
    {
      kind: 'table',
      title: `Recent Filings (${row.ticker})`,
      columns: ['date', 'form', 'accession', 'primaryDocumentUrl'],
      rows: outRows
    }
  ];
}

export function edgarCommand(): CommandSpec {
  return {
    name: 'edgar',
    description: 'SEC EDGAR lookups (tickers, filings)',
    usage: 'edgar <ticker|filings> ...',
    handler: async (args, ctx) => {
      const sub = args[0];
      const rest = args.slice(1);

      if (!sub || sub === 'help') {
        return [
          {
            kind: 'text',
            title: 'Usage',
            text: [
              'edgar ticker <TICKER>',
              'edgar filings <TICKER> [count]',
              '',
              'Requires env: SEC_USER_AGENT="truth-terminal (email@example.com)"'
            ].join('\n')
          }
        ];
      }

      if (sub === 'ticker') return tickerInfo(rest, ctx.env);
      if (sub === 'filings') return recentFilings(rest, ctx.env);

      return [{ kind: 'error', message: `Unknown edgar subcommand: ${sub}` }];
    }
  };
}
