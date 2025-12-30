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
