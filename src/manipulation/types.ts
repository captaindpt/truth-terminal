// Types for manipulation detection system

// Raw trade from RTDS WebSocket
export interface RTDSTrade {
  id: string;
  timestamp: number;
  market: string;           // condition_id or asset_id
  maker: string;            // wallet address
  taker: string;            // wallet address
  side: 'BUY' | 'SELL';
  outcome: string;          // YES or NO
  size: number;             // amount in USDC
  price: number;            // 0-1
  feeRateBps: number;
}

// Normalized trade we store
export interface StoredTrade {
  id: string;
  timestamp: number;
  marketId: string;
  wallet: string;           // the active side (taker usually)
  side: 'BUY' | 'SELL';
  outcome: string;
  size: number;
  price: number;
}

// Wallet profile computed from trades
export interface WalletProfile {
  address: string;
  firstSeen: number;
  lastSeen: number;
  tradeCount: number;
  uniqueMarkets: number;
  totalVolume: number;
  avgTradeSize: number;
  // Computed later once we have resolution data
  winRate?: number;
  resolvedPositions?: number;
}

// Market metadata we cache
export interface MarketMeta {
  id: string;
  question: string;
  category: string;
  endDate: string;
  fetchedAt: number;
}

// Signature tally for pattern detection (Phase 2)
export interface SignatureTally {
  signatureHash: string;
  count: number;
  wallets: string[];
  markets: string[];
  firstSeen: number;
  lastSeen: number;
  alertTriggered: boolean;
}

// Alert when pattern detected
export interface ManipulationAlert {
  id?: number;
  type: 'REPEATED_PATTERN' | 'COORDINATED_ACTIVITY' | 'SUSPICIOUS_NEW_WALLET' | 'IMPROBABLE_SUCCESS';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  signatureHash?: string;
  wallets: string[];
  markets: string[];
  details: string;
  createdAt: number;
  reviewed: boolean;
}
