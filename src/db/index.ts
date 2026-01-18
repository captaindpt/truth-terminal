import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ResearchCase, CaseDecision, TradeRecord, OutcomeRecord } from '../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../data/truth-terminal.db');

const db = new Database(DB_PATH);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS research_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id TEXT NOT NULL,
    market_data TEXT NOT NULL,
    thesis TEXT NOT NULL,
    recommended_position TEXT NOT NULL,
    confidence TEXT NOT NULL,
    key_uncertainties TEXT NOT NULL,
    what_would_change TEXT NOT NULL,
    sources TEXT NOT NULL,
    agent_model TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS case_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL,
    decision TEXT NOT NULL,
    notes TEXT,
    bet_amount REAL,
    decided_at TEXT NOT NULL,
    FOREIGN KEY (case_id) REFERENCES research_cases(id)
  );

  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    market_id TEXT NOT NULL,
    case_id INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    amount REAL NOT NULL,
    price_at_execution REAL NOT NULL,
    executed_at TEXT NOT NULL,
    status TEXT NOT NULL,
    FOREIGN KEY (case_id) REFERENCES research_cases(id)
  );

  CREATE TABLE IF NOT EXISTS outcomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id TEXT NOT NULL,
    resolved INTEGER DEFAULT 0,
    won INTEGER,
    pnl REAL,
    resolved_at TEXT,
    FOREIGN KEY (trade_id) REFERENCES trades(id)
  );

  CREATE INDEX IF NOT EXISTS idx_cases_market ON research_cases(market_id);
  CREATE INDEX IF NOT EXISTS idx_cases_created ON research_cases(created_at);
  CREATE INDEX IF NOT EXISTS idx_decisions_case ON case_decisions(case_id);
`);

// ============================
// Workstation tables (v1)
// ============================

db.exec(`
  CREATE TABLE IF NOT EXISTS markets (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    slug TEXT NOT NULL DEFAULT '',
    question TEXT NOT NULL DEFAULT '',
    end_date TEXT,
    resolution_source TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(source, external_id)
  );

  CREATE INDEX IF NOT EXISTS idx_markets_source_external ON markets(source, external_id);
  CREATE INDEX IF NOT EXISTS idx_markets_updated ON markets(updated_at DESC);

  CREATE TABLE IF NOT EXISTS convictions (
    id TEXT PRIMARY KEY,
    market_id TEXT NOT NULL,
    my_probability REAL NOT NULL,
    entry_thesis TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'watching',
    key_uncertainties TEXT NOT NULL DEFAULT '[]',
    exit_conditions TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(market_id),
    FOREIGN KEY (market_id) REFERENCES markets(id)
  );

  CREATE INDEX IF NOT EXISTS idx_convictions_status_updated ON convictions(status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_convictions_updated ON convictions(updated_at DESC);

  CREATE TABLE IF NOT EXISTS info_events (
    id TEXT PRIMARY KEY,
    market_id TEXT,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    date_confidence TEXT NOT NULL,
    source TEXT,
    impact_hypothesis TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (market_id) REFERENCES markets(id)
  );

  CREATE INDEX IF NOT EXISTS idx_info_events_market_date ON info_events(market_id, date);
  CREATE INDEX IF NOT EXISTS idx_info_events_date ON info_events(date);
  CREATE INDEX IF NOT EXISTS idx_info_events_updated ON info_events(updated_at DESC);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    market_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    shares REAL NOT NULL,
    avg_price REAL NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (market_id) REFERENCES markets(id)
  );

  CREATE INDEX IF NOT EXISTS idx_positions_market ON positions(market_id);
  CREATE INDEX IF NOT EXISTS idx_positions_updated ON positions(updated_at DESC);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    market_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL,
    price_threshold REAL NOT NULL,
    min_my_probability REAL,
    status TEXT NOT NULL DEFAULT 'active',
    triggered_at INTEGER,
    last_evaluated_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (market_id) REFERENCES markets(id)
  );

  CREATE INDEX IF NOT EXISTS idx_rules_market ON rules(market_id);
  CREATE INDEX IF NOT EXISTS idx_rules_status_updated ON rules(status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL,
    market_id TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    seen INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (rule_id) REFERENCES rules(id),
    FOREIGN KEY (market_id) REFERENCES markets(id)
  );

  CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_alerts_seen_created ON alerts(seen, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_alerts_market ON alerts(market_id);
`);

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export type MarketSource = 'polymarket' | 'other';

export type Market = {
  id: string;
  source: MarketSource;
  externalId: string;
  slug: string;
  question: string;
  endDate: string | null;
  resolutionSource: string | null;
  createdAt: number;
  updatedAt: number;
};

function rowToMarket(r: any): Market {
  return {
    id: String(r.id),
    source: (String(r.source) as MarketSource) || 'other',
    externalId: String(r.external_id),
    slug: String(r.slug || ''),
    question: String(r.question || ''),
    endDate: r.end_date == null ? null : String(r.end_date),
    resolutionSource: r.resolution_source == null ? null : String(r.resolution_source),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at)
  };
}

export function getMarketById(id: string): Market | null {
  const row = db.prepare(`SELECT * FROM markets WHERE id = ?`).get(id) as any;
  return row ? rowToMarket(row) : null;
}

export function getMarketByExternalId(source: MarketSource, externalId: string): Market | null {
  const row = db.prepare(`SELECT * FROM markets WHERE source = ? AND external_id = ?`).get(source, externalId) as any;
  return row ? rowToMarket(row) : null;
}

export function upsertMarket(input: {
  source: MarketSource;
  externalId: string;
  slug?: string;
  question?: string;
  endDate?: string | null;
  resolutionSource?: string | null;
}): Market {
  const source = input.source;
  const externalId = String(input.externalId || '').trim();
  if (!externalId) throw new Error('externalId required');

  const existing = getMarketByExternalId(source, externalId);
  const now = Date.now();

  if (!existing) {
    const id = newId('mkt');
    db.prepare(
      `
      INSERT INTO markets (id, source, external_id, slug, question, end_date, resolution_source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      id,
      source,
      externalId,
      input.slug ?? '',
      input.question ?? '',
      input.endDate ?? null,
      input.resolutionSource ?? null,
      now,
      now
    );
    return getMarketById(id)!;
  }

  const next = {
    slug: input.slug ?? existing.slug,
    question: input.question ?? existing.question,
    endDate: input.endDate === undefined ? existing.endDate : input.endDate,
    resolutionSource: input.resolutionSource === undefined ? existing.resolutionSource : input.resolutionSource
  };

  db.prepare(
    `
    UPDATE markets
    SET slug = ?, question = ?, end_date = ?, resolution_source = ?, updated_at = ?
    WHERE id = ?
  `
  ).run(next.slug, next.question, next.endDate, next.resolutionSource, now, existing.id);

  return getMarketById(existing.id)!;
}

export type ConvictionStatus = 'watching' | 'entered' | 'exited';

export type Conviction = {
  id: string;
  marketId: string;
  myProbability: number; // 0..1
  entryThesis: string;
  status: ConvictionStatus;
  keyUncertainties: string[];
  exitConditions: string[];
  createdAt: number;
  updatedAt: number;
};

function rowToConviction(r: any): Conviction {
  const keyUncertainties = (() => {
    try {
      const parsed = JSON.parse(String(r.key_uncertainties || '[]'));
      return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
    } catch {
      return [];
    }
  })();
  const exitConditions = (() => {
    try {
      const parsed = JSON.parse(String(r.exit_conditions || '[]'));
      return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
    } catch {
      return [];
    }
  })();

  return {
    id: String(r.id),
    marketId: String(r.market_id),
    myProbability: Number(r.my_probability),
    entryThesis: String(r.entry_thesis || ''),
    status: (String(r.status) as ConvictionStatus) || 'watching',
    keyUncertainties,
    exitConditions,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at)
  };
}

function normalizeProbability(value: unknown): number {
  const n = typeof value === 'string' ? Number(value.trim()) : typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(n)) throw new Error('Invalid probability');
  // Accept:
  // - 0..1 as fraction
  // - 1..100 as percent (inclusive), i.e. 1 => 1%, 100 => 100%
  if (n >= 1 && n <= 100) return n / 100;
  if (n < 0 || n > 1) throw new Error('Probability must be 0..1 (or 1..100)');
  return n;
}

function normalizePrice(value: unknown): number {
  const n = typeof value === 'string' ? Number(value.trim()) : typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(n)) throw new Error('Invalid price');
  if (n >= 1 && n <= 100) return n / 100;
  if (n <= 0 || n > 1) throw new Error('Price must be 0..1 (or 1..100)');
  return n;
}

function normalizeStatus(value: unknown): ConvictionStatus {
  const s = String(value || '').toLowerCase();
  if (s === 'entered') return 'entered';
  if (s === 'exited') return 'exited';
  return 'watching';
}

export function getConvictionById(id: string): Conviction | null {
  const row = db.prepare(`SELECT * FROM convictions WHERE id = ?`).get(id) as any;
  return row ? rowToConviction(row) : null;
}

export function getConvictionByMarketId(marketId: string): Conviction | null {
  const row = db.prepare(`SELECT * FROM convictions WHERE market_id = ?`).get(marketId) as any;
  return row ? rowToConviction(row) : null;
}

export function upsertConvictionByMarketId(input: {
  marketId: string;
  myProbability: unknown;
  entryThesis?: string;
  status?: unknown;
  keyUncertainties?: unknown;
  exitConditions?: unknown;
}): Conviction {
  const marketId = String(input.marketId || '').trim();
  if (!marketId) throw new Error('marketId required');

  const myProbability = normalizeProbability(input.myProbability);
  const entryThesis = String(input.entryThesis ?? '');
  const status = normalizeStatus(input.status);

  const keyUncertainties =
    Array.isArray(input.keyUncertainties) ? input.keyUncertainties.map((x) => String(x)) : typeof input.keyUncertainties === 'string' ? [input.keyUncertainties] : [];
  const exitConditions =
    Array.isArray(input.exitConditions) ? input.exitConditions.map((x) => String(x)) : typeof input.exitConditions === 'string' ? [input.exitConditions] : [];

  const existing = getConvictionByMarketId(marketId);
  const now = Date.now();

  if (!existing) {
    const id = newId('cvn');
    db.prepare(
      `
      INSERT INTO convictions (id, market_id, my_probability, entry_thesis, status, key_uncertainties, exit_conditions, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(id, marketId, myProbability, entryThesis, status, JSON.stringify(keyUncertainties), JSON.stringify(exitConditions), now, now);
    return getConvictionById(id)!;
  }

  db.prepare(
    `
    UPDATE convictions
    SET my_probability = ?, entry_thesis = ?, status = ?, key_uncertainties = ?, exit_conditions = ?, updated_at = ?
    WHERE id = ?
  `
  ).run(myProbability, entryThesis, status, JSON.stringify(keyUncertainties), JSON.stringify(exitConditions), now, existing.id);

  return getConvictionById(existing.id)!;
}

export function deleteConviction(id: string): void {
  db.prepare(`DELETE FROM convictions WHERE id = ?`).run(id);
}

export type ConvictionWithMarket = { conviction: Conviction; market: Market };

export function listConvictionsWithMarkets(opts?: { limit?: number; status?: ConvictionStatus }): ConvictionWithMarket[] {
  const limitRaw = opts?.limit ?? 200;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : 200;
  const status = opts?.status ?? null;

  const rows = db
    .prepare(
      `
      SELECT
        c.*,
        m.id as m_id,
        m.source as m_source,
        m.external_id as m_external_id,
        m.slug as m_slug,
        m.question as m_question,
        m.end_date as m_end_date,
        m.resolution_source as m_resolution_source,
        m.created_at as m_created_at,
        m.updated_at as m_updated_at
      FROM convictions c
      JOIN markets m ON m.id = c.market_id
      WHERE (? IS NULL OR c.status = ?)
      ORDER BY c.updated_at DESC
      LIMIT ?
    `
    )
    .all(status, status, limit) as any[];

  return rows.map((r) => ({
    conviction: rowToConviction(r),
    market: rowToMarket({
      id: r.m_id,
      source: r.m_source,
      external_id: r.m_external_id,
      slug: r.m_slug,
      question: r.m_question,
      end_date: r.m_end_date,
      resolution_source: r.m_resolution_source,
      created_at: r.m_created_at,
      updated_at: r.m_updated_at
    })
  }));
}

export type DateConfidence = 'exact' | 'approximate' | 'unknown';
export type CreatedBy = 'user' | 'agent';

export type InfoEvent = {
  id: string;
  marketId: string | null;
  title: string;
  date: string;
  dateConfidence: DateConfidence;
  source: string | null;
  impactHypothesis: string;
  createdBy: CreatedBy;
  createdAt: number;
  updatedAt: number;
};

function normalizeDateConfidence(value: unknown): DateConfidence {
  const s = String(value || '').toLowerCase();
  if (s === 'exact') return 'exact';
  if (s === 'approximate' || s === 'approx') return 'approximate';
  return 'unknown';
}

function normalizeCreatedBy(value: unknown): CreatedBy {
  const s = String(value || '').toLowerCase();
  return s === 'agent' ? 'agent' : 'user';
}

function rowToInfoEvent(r: any): InfoEvent {
  return {
    id: String(r.id),
    marketId: r.market_id == null ? null : String(r.market_id),
    title: String(r.title || ''),
    date: String(r.date || ''),
    dateConfidence: normalizeDateConfidence(r.date_confidence),
    source: r.source == null ? null : String(r.source),
    impactHypothesis: String(r.impact_hypothesis || ''),
    createdBy: normalizeCreatedBy(r.created_by),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at)
  };
}

export type InfoEventWithMarket = { event: InfoEvent; market: Market | null };

export function listInfoEventsWithMarkets(opts?: { limit?: number; marketId?: string | null }): InfoEventWithMarket[] {
  const limitRaw = opts?.limit ?? 500;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(2000, Math.floor(limitRaw))) : 500;
  const marketId = opts?.marketId ?? null;

  const rows = db
    .prepare(
      `
      SELECT
        e.*,
        m.id as m_id,
        m.source as m_source,
        m.external_id as m_external_id,
        m.slug as m_slug,
        m.question as m_question,
        m.end_date as m_end_date,
        m.resolution_source as m_resolution_source,
        m.created_at as m_created_at,
        m.updated_at as m_updated_at
      FROM info_events e
      LEFT JOIN markets m ON m.id = e.market_id
      WHERE (? IS NULL OR e.market_id = ?)
      ORDER BY
        CASE
          WHEN e.date GLOB '____-__-__*' THEN e.date
          ELSE '9999-12-31'
        END ASC,
        e.updated_at DESC
      LIMIT ?
    `
    )
    .all(marketId, marketId, limit) as any[];

  return rows.map((r) => {
    const hasMarket = r.m_id != null;
    return {
      event: rowToInfoEvent(r),
      market: hasMarket
        ? rowToMarket({
            id: r.m_id,
            source: r.m_source,
            external_id: r.m_external_id,
            slug: r.m_slug,
            question: r.m_question,
            end_date: r.m_end_date,
            resolution_source: r.m_resolution_source,
            created_at: r.m_created_at,
            updated_at: r.m_updated_at
          })
        : null
    };
  });
}

export function createInfoEvent(input: {
  marketId?: string | null;
  title: string;
  date: string;
  dateConfidence?: unknown;
  source?: string | null;
  impactHypothesis?: string;
  createdBy?: unknown;
}): InfoEvent {
  const id = newId('evt');
  const now = Date.now();
  const marketId = input.marketId == null ? null : String(input.marketId).trim() || null;
  const title = String(input.title || '').trim();
  const date = String(input.date || '').trim();
  if (!title) throw new Error('title required');
  if (!date) throw new Error('date required');

  const dateConfidence = normalizeDateConfidence(input.dateConfidence);
  const source = input.source == null ? null : String(input.source).trim() || null;
  const impactHypothesis = String(input.impactHypothesis ?? '');
  const createdBy = normalizeCreatedBy(input.createdBy);

  db.prepare(
    `
    INSERT INTO info_events (id, market_id, title, date, date_confidence, source, impact_hypothesis, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(id, marketId, title, date, dateConfidence, source, impactHypothesis, createdBy, now, now);

  const row = db.prepare(`SELECT * FROM info_events WHERE id = ?`).get(id) as any;
  return rowToInfoEvent(row);
}

export function updateInfoEvent(id: string, patch: Partial<Omit<InfoEvent, 'id' | 'createdAt' | 'updatedAt'>> & { marketId?: string | null }): InfoEvent {
  const existing = db.prepare(`SELECT * FROM info_events WHERE id = ?`).get(id) as any;
  if (!existing) throw new Error('Event not found');
  const current = rowToInfoEvent(existing);
  const now = Date.now();

  const next: InfoEvent = {
    ...current,
    marketId: patch.marketId === undefined ? current.marketId : patch.marketId,
    title: patch.title === undefined ? current.title : String(patch.title),
    date: patch.date === undefined ? current.date : String(patch.date),
    dateConfidence: patch.dateConfidence === undefined ? current.dateConfidence : normalizeDateConfidence(patch.dateConfidence),
    source: patch.source === undefined ? current.source : patch.source == null ? null : String(patch.source),
    impactHypothesis: patch.impactHypothesis === undefined ? current.impactHypothesis : String(patch.impactHypothesis),
    createdBy: patch.createdBy === undefined ? current.createdBy : normalizeCreatedBy(patch.createdBy),
    createdAt: current.createdAt,
    updatedAt: now
  };

  if (!next.title.trim()) throw new Error('title required');
  if (!next.date.trim()) throw new Error('date required');

  db.prepare(
    `
    UPDATE info_events
    SET market_id = ?, title = ?, date = ?, date_confidence = ?, source = ?, impact_hypothesis = ?, created_by = ?, updated_at = ?
    WHERE id = ?
  `
  ).run(
    next.marketId,
    next.title,
    next.date,
    next.dateConfidence,
    next.source,
    next.impactHypothesis,
    next.createdBy,
    now,
    id
  );

  const row = db.prepare(`SELECT * FROM info_events WHERE id = ?`).get(id) as any;
  return rowToInfoEvent(row);
}

export function deleteInfoEvent(id: string): void {
  db.prepare(`DELETE FROM info_events WHERE id = ?`).run(id);
}

export type PositionOutcome = 'YES' | 'NO';

export type Position = {
  id: string;
  marketId: string;
  outcome: PositionOutcome;
  shares: number;
  avgPrice: number; // 0..1
  createdAt: number;
  updatedAt: number;
};

function normalizeOutcome(value: unknown): PositionOutcome {
  const s = String(value || '').trim().toUpperCase();
  return s === 'NO' ? 'NO' : 'YES';
}

function rowToPosition(r: any): Position {
  return {
    id: String(r.id),
    marketId: String(r.market_id),
    outcome: normalizeOutcome(r.outcome),
    shares: Number(r.shares),
    avgPrice: Number(r.avg_price),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at)
  };
}

export type PositionWithMarket = { position: Position; market: Market };

export function listPositionsWithMarkets(opts?: { limit?: number; marketId?: string }): PositionWithMarket[] {
  const limitRaw = opts?.limit ?? 500;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(2000, Math.floor(limitRaw))) : 500;
  const marketId = opts?.marketId ? String(opts.marketId).trim() : null;

  const rows = db
    .prepare(
      `
      SELECT
        p.*,
        m.id as m_id,
        m.source as m_source,
        m.external_id as m_external_id,
        m.slug as m_slug,
        m.question as m_question,
        m.end_date as m_end_date,
        m.resolution_source as m_resolution_source,
        m.created_at as m_created_at,
        m.updated_at as m_updated_at
      FROM positions p
      JOIN markets m ON m.id = p.market_id
      WHERE (? IS NULL OR p.market_id = ?)
      ORDER BY p.updated_at DESC
      LIMIT ?
    `
    )
    .all(marketId, marketId, limit) as any[];

  return rows.map((r) => ({
    position: rowToPosition(r),
    market: rowToMarket({
      id: r.m_id,
      source: r.m_source,
      external_id: r.m_external_id,
      slug: r.m_slug,
      question: r.m_question,
      end_date: r.m_end_date,
      resolution_source: r.m_resolution_source,
      created_at: r.m_created_at,
      updated_at: r.m_updated_at
    })
  }));
}

export function createPosition(input: { marketId: string; outcome: unknown; shares: unknown; avgPrice: unknown }): Position {
  const marketId = String(input.marketId || '').trim();
  if (!marketId) throw new Error('marketId required');

  const outcome = normalizeOutcome(input.outcome);
  const shares = typeof input.shares === 'string' ? Number(input.shares.trim()) : Number(input.shares);
  if (!Number.isFinite(shares) || shares <= 0) throw new Error('shares must be > 0');

  const avgPrice = normalizePrice(input.avgPrice);

  const now = Date.now();
  const id = newId('pos');
  db.prepare(
    `
    INSERT INTO positions (id, market_id, outcome, shares, avg_price, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  ).run(id, marketId, outcome, shares, avgPrice, now, now);

  const row = db.prepare(`SELECT * FROM positions WHERE id = ?`).get(id) as any;
  return rowToPosition(row);
}

export function updatePosition(id: string, patch: Partial<Pick<Position, 'outcome' | 'shares' | 'avgPrice'>>): Position {
  const existing = db.prepare(`SELECT * FROM positions WHERE id = ?`).get(id) as any;
  if (!existing) throw new Error('Position not found');
  const current = rowToPosition(existing);
  const now = Date.now();

  const outcome = patch.outcome === undefined ? current.outcome : normalizeOutcome(patch.outcome);
  const shares =
    patch.shares === undefined
      ? current.shares
      : typeof patch.shares === 'string'
        ? Number(patch.shares.trim())
        : Number(patch.shares);
  if (!Number.isFinite(shares) || shares <= 0) throw new Error('shares must be > 0');

  const avgPrice = patch.avgPrice === undefined ? current.avgPrice : normalizePrice(patch.avgPrice);

  db.prepare(`UPDATE positions SET outcome = ?, shares = ?, avg_price = ?, updated_at = ? WHERE id = ?`).run(outcome, shares, avgPrice, now, id);
  const row = db.prepare(`SELECT * FROM positions WHERE id = ?`).get(id) as any;
  return rowToPosition(row);
}

export function deletePosition(id: string): void {
  db.prepare(`DELETE FROM positions WHERE id = ?`).run(id);
}

export type RuleType = 'price_below' | 'price_above';
export type RuleStatus = 'active' | 'triggered' | 'disabled';

export type Rule = {
  id: string;
  marketId: string;
  name: string;
  type: RuleType;
  priceThreshold: number; // 0..1
  minMyProbability: number | null; // 0..1
  status: RuleStatus;
  triggeredAt: number | null;
  lastEvaluatedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

function normalizeRuleType(value: unknown): RuleType {
  const s = String(value || '').trim().toLowerCase();
  return s === 'price_above' ? 'price_above' : 'price_below';
}

function normalizeRuleStatus(value: unknown): RuleStatus {
  const s = String(value || '').trim().toLowerCase();
  if (s === 'triggered') return 'triggered';
  if (s === 'disabled') return 'disabled';
  return 'active';
}

function rowToRule(r: any): Rule {
  return {
    id: String(r.id),
    marketId: String(r.market_id),
    name: String(r.name || ''),
    type: normalizeRuleType(r.type),
    priceThreshold: Number(r.price_threshold),
    minMyProbability: r.min_my_probability == null ? null : Number(r.min_my_probability),
    status: normalizeRuleStatus(r.status),
    triggeredAt: r.triggered_at == null ? null : Number(r.triggered_at),
    lastEvaluatedAt: r.last_evaluated_at == null ? null : Number(r.last_evaluated_at),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at)
  };
}

export type RuleWithMarket = { rule: Rule; market: Market };

export function listRulesWithMarkets(opts?: { limit?: number; status?: RuleStatus }): RuleWithMarket[] {
  const limitRaw = opts?.limit ?? 500;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(2000, Math.floor(limitRaw))) : 500;
  const status = opts?.status ?? null;

  const rows = db
    .prepare(
      `
      SELECT
        r.*,
        m.id as m_id,
        m.source as m_source,
        m.external_id as m_external_id,
        m.slug as m_slug,
        m.question as m_question,
        m.end_date as m_end_date,
        m.resolution_source as m_resolution_source,
        m.created_at as m_created_at,
        m.updated_at as m_updated_at
      FROM rules r
      JOIN markets m ON m.id = r.market_id
      WHERE (? IS NULL OR r.status = ?)
      ORDER BY r.updated_at DESC
      LIMIT ?
    `
    )
    .all(status, status, limit) as any[];

  return rows.map((r) => ({
    rule: rowToRule(r),
    market: rowToMarket({
      id: r.m_id,
      source: r.m_source,
      external_id: r.m_external_id,
      slug: r.m_slug,
      question: r.m_question,
      end_date: r.m_end_date,
      resolution_source: r.m_resolution_source,
      created_at: r.m_created_at,
      updated_at: r.m_updated_at
    })
  }));
}

export function createRule(input: {
  marketId: string;
  name?: string;
  type: unknown;
  priceThreshold: unknown;
  minMyProbability?: unknown;
}): Rule {
  const marketId = String(input.marketId || '').trim();
  if (!marketId) throw new Error('marketId required');
  const type = normalizeRuleType(input.type);
  const priceThreshold = normalizeProbability(input.priceThreshold);
  const minMyProbability = input.minMyProbability == null ? null : normalizeProbability(input.minMyProbability);
  const name = String(input.name ?? '');

  const now = Date.now();
  const id = newId('rule');

  db.prepare(
    `
    INSERT INTO rules (id, market_id, name, type, price_threshold, min_my_probability, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `
  ).run(id, marketId, name, type, priceThreshold, minMyProbability, now, now);

  const row = db.prepare(`SELECT * FROM rules WHERE id = ?`).get(id) as any;
  return rowToRule(row);
}

export function updateRule(id: string, patch: Partial<Pick<Rule, 'name' | 'status' | 'type' | 'priceThreshold' | 'minMyProbability'>>): Rule {
  const existing = db.prepare(`SELECT * FROM rules WHERE id = ?`).get(id) as any;
  if (!existing) throw new Error('Rule not found');
  const current = rowToRule(existing);
  const now = Date.now();

  const next: Rule = {
    ...current,
    name: patch.name === undefined ? current.name : String(patch.name),
    status: patch.status === undefined ? current.status : normalizeRuleStatus(patch.status),
    type: patch.type === undefined ? current.type : normalizeRuleType(patch.type),
    priceThreshold: patch.priceThreshold === undefined ? current.priceThreshold : normalizeProbability(patch.priceThreshold),
    minMyProbability: patch.minMyProbability === undefined ? current.minMyProbability : patch.minMyProbability == null ? null : normalizeProbability(patch.minMyProbability),
    updatedAt: now
  };

  db.prepare(
    `
    UPDATE rules
    SET name = ?, type = ?, price_threshold = ?, min_my_probability = ?, status = ?, updated_at = ?
    WHERE id = ?
  `
  ).run(next.name, next.type, next.priceThreshold, next.minMyProbability, next.status, now, id);

  const row = db.prepare(`SELECT * FROM rules WHERE id = ?`).get(id) as any;
  return rowToRule(row);
}

export function setRuleEvaluated(id: string, patch: { status?: RuleStatus; triggeredAt?: number | null; lastEvaluatedAt: number }): void {
  const status = patch.status == null ? null : normalizeRuleStatus(patch.status);
  db.prepare(
    `
    UPDATE rules
    SET status = coalesce(?, status),
        triggered_at = coalesce(?, triggered_at),
        last_evaluated_at = ?,
        updated_at = ?
    WHERE id = ?
  `
  ).run(status, patch.triggeredAt ?? null, patch.lastEvaluatedAt, patch.lastEvaluatedAt, id);
}

export function deleteRule(id: string): void {
  db.prepare(`DELETE FROM rules WHERE id = ?`).run(id);
}

export type Alert = {
  id: string;
  ruleId: string;
  marketId: string;
  message: string;
  createdAt: number;
  seen: boolean;
};

function rowToAlert(r: any): Alert {
  return {
    id: String(r.id),
    ruleId: String(r.rule_id),
    marketId: String(r.market_id),
    message: String(r.message || ''),
    createdAt: Number(r.created_at),
    seen: Boolean(Number(r.seen || 0))
  };
}

export type AlertWithMarket = { alert: Alert; market: Market | null; rule: Rule | null };

export function createAlert(input: { ruleId: string; marketId: string; message: string }): Alert {
  const ruleId = String(input.ruleId || '').trim();
  const marketId = String(input.marketId || '').trim();
  const message = String(input.message || '').trim();
  if (!ruleId) throw new Error('ruleId required');
  if (!marketId) throw new Error('marketId required');
  if (!message) throw new Error('message required');

  const id = newId('alert');
  const now = Date.now();
  db.prepare(`INSERT INTO alerts (id, rule_id, market_id, message, created_at, seen) VALUES (?, ?, ?, ?, ?, 0)`).run(id, ruleId, marketId, message, now);
  const row = db.prepare(`SELECT * FROM alerts WHERE id = ?`).get(id) as any;
  return rowToAlert(row);
}

export function listAlertsWithMarkets(opts?: { limit?: number; unseenOnly?: boolean }): AlertWithMarket[] {
  const limitRaw = opts?.limit ?? 200;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(2000, Math.floor(limitRaw))) : 200;
  const unseenOnly = Boolean(opts?.unseenOnly);

  const rows = db
    .prepare(
      `
      SELECT
        a.*,
        m.id as m_id,
        m.source as m_source,
        m.external_id as m_external_id,
        m.slug as m_slug,
        m.question as m_question,
        m.end_date as m_end_date,
        m.resolution_source as m_resolution_source,
        m.created_at as m_created_at,
        m.updated_at as m_updated_at,
        r.id as r_id,
        r.market_id as r_market_id,
        r.name as r_name,
        r.type as r_type,
        r.price_threshold as r_price_threshold,
        r.min_my_probability as r_min_my_probability,
        r.status as r_status,
        r.triggered_at as r_triggered_at,
        r.last_evaluated_at as r_last_evaluated_at,
        r.created_at as r_created_at,
        r.updated_at as r_updated_at
      FROM alerts a
      LEFT JOIN markets m ON m.id = a.market_id
      LEFT JOIN rules r ON r.id = a.rule_id
      WHERE (? = 0 OR a.seen = 0)
      ORDER BY a.created_at DESC
      LIMIT ?
    `
    )
    .all(unseenOnly ? 1 : 0, limit) as any[];

  return rows.map((r) => ({
    alert: rowToAlert(r),
    market:
      r.m_id == null
        ? null
        : rowToMarket({
            id: r.m_id,
            source: r.m_source,
            external_id: r.m_external_id,
            slug: r.m_slug,
            question: r.m_question,
            end_date: r.m_end_date,
            resolution_source: r.m_resolution_source,
            created_at: r.m_created_at,
            updated_at: r.m_updated_at
          }),
    rule:
      r.r_id == null
        ? null
        : rowToRule({
            id: r.r_id,
            market_id: r.r_market_id,
            name: r.r_name,
            type: r.r_type,
            price_threshold: r.r_price_threshold,
            min_my_probability: r.r_min_my_probability,
            status: r.r_status,
            triggered_at: r.r_triggered_at,
            last_evaluated_at: r.r_last_evaluated_at,
            created_at: r.r_created_at,
            updated_at: r.r_updated_at
          })
  }));
}

export function markAlertsSeen(ids: string[]): void {
  const unique = Array.from(new Set(ids.map((x) => String(x || '').trim()).filter(Boolean)));
  if (!unique.length) return;
  const placeholders = unique.map(() => '?').join(',');
  db.prepare(`UPDATE alerts SET seen = 1 WHERE id IN (${placeholders})`).run(...unique);
}

// Save a research case
export function saveCase(researchCase: ResearchCase): number {
  const stmt = db.prepare(`
    INSERT INTO research_cases
    (market_id, market_data, thesis, recommended_position, confidence, key_uncertainties, what_would_change, sources, agent_model, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    researchCase.marketId,
    JSON.stringify(researchCase.market),
    researchCase.thesis,
    researchCase.recommendedPosition,
    researchCase.confidence,
    JSON.stringify(researchCase.keyUncertainties),
    researchCase.whatWouldChangeAssessment,
    JSON.stringify(researchCase.sources),
    researchCase.agentModel,
    researchCase.createdAt
  );

  return result.lastInsertRowid as number;
}

// Get case by ID
export function getCase(id: number): ResearchCase | null {
  const stmt = db.prepare('SELECT * FROM research_cases WHERE id = ?');
  const row = stmt.get(id) as any;

  if (!row) return null;

  return {
    marketId: row.market_id,
    market: JSON.parse(row.market_data),
    thesis: row.thesis,
    recommendedPosition: row.recommended_position,
    confidence: row.confidence,
    keyUncertainties: JSON.parse(row.key_uncertainties),
    whatWouldChangeAssessment: row.what_would_change,
    sources: JSON.parse(row.sources),
    createdAt: row.created_at,
    agentModel: row.agent_model
  };
}

// Get recent cases
export function getRecentCases(limit = 20): (ResearchCase & { dbId: number })[] {
  const stmt = db.prepare('SELECT * FROM research_cases ORDER BY created_at DESC LIMIT ?');
  const rows = stmt.all(limit) as any[];

  return rows.map(row => ({
    dbId: row.id,
    marketId: row.market_id,
    market: JSON.parse(row.market_data),
    thesis: row.thesis,
    recommendedPosition: row.recommended_position,
    confidence: row.confidence,
    keyUncertainties: JSON.parse(row.key_uncertainties),
    whatWouldChangeAssessment: row.what_would_change,
    sources: JSON.parse(row.sources),
    createdAt: row.created_at,
    agentModel: row.agent_model
  }));
}

// Get cases pending decision
export function getPendingCases(): (ResearchCase & { dbId: number })[] {
  const stmt = db.prepare(`
    SELECT rc.* FROM research_cases rc
    LEFT JOIN case_decisions cd ON cd.case_id = rc.id
    WHERE cd.id IS NULL
    ORDER BY rc.created_at DESC
  `);
  const rows = stmt.all() as any[];

  return rows.map(row => ({
    dbId: row.id,
    marketId: row.market_id,
    market: JSON.parse(row.market_data),
    thesis: row.thesis,
    recommendedPosition: row.recommended_position,
    confidence: row.confidence,
    keyUncertainties: JSON.parse(row.key_uncertainties),
    whatWouldChangeAssessment: row.what_would_change,
    sources: JSON.parse(row.sources),
    createdAt: row.created_at,
    agentModel: row.agent_model
  }));
}

// Save a decision
export function saveDecision(decision: CaseDecision & { caseId: number }): void {
  const stmt = db.prepare(`
    INSERT INTO case_decisions (case_id, decision, notes, bet_amount, decided_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(
    decision.caseId,
    decision.decision,
    decision.notes || null,
    decision.betAmount || null,
    decision.decidedAt
  );
}

export { db };
