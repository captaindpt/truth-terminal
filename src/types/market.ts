// Polymarket market structure
export interface PolymarketMarket {
  id: string;
  question: string;
  description: string;
  outcomes: string[];
  outcomePrices: number[];  // Current prices for each outcome (0-1)
  volume: number;           // Total volume traded
  liquidity: number;        // Current liquidity
  endDate: string;          // When the market resolves
  category: string;
  active: boolean;
  closed: boolean;
}

// Research case produced by agents
export interface ResearchCase {
  marketId: string;
  market: PolymarketMarket;
  thesis: string;                    // What the agent thinks and why
  recommendedPosition: string;       // Which outcome to bet on
  confidence: 'low' | 'medium' | 'high';
  keyUncertainties: string[];        // What could invalidate the thesis
  whatWouldChangeAssessment: string; // Specific conditions that flip the call
  sources: string[];                 // Where the intel came from
  createdAt: string;
  agentModel: string;                // Which model produced this
}

// Your decision on a case
export interface CaseDecision {
  caseId: string;
  decision: 'approved' | 'rejected' | 'needs_more';
  notes?: string;
  betAmount?: number;
  decidedAt: string;
}

// Trade execution record
export interface TradeRecord {
  id: string;
  marketId: string;
  caseId: string;
  outcome: string;
  amount: number;
  priceAtExecution: number;
  executedAt: string;
  status: 'pending' | 'filled' | 'failed';
}

// Calibration tracking
export interface OutcomeRecord {
  tradeId: string;
  resolved: boolean;
  won: boolean | null;
  pnl: number | null;
  resolvedAt: string | null;
}
