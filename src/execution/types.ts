export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';
export type OrderStatus = 'PENDING' | 'PARTIAL' | 'FILLED' | 'CANCELED';

export type ExecOrder = {
  id: string;
  createdAt: number;
  updatedAt: number;
  symbol: string;
  side: OrderSide;
  qty: number;
  type: OrderType;
  limitPrice: number | null;
  expectedPrice: number | null;
  status: OrderStatus;
  filledQty: number;
};

export type ExecFill = {
  id: number;
  orderId: string;
  ts: number;
  symbol: string;
  side: OrderSide;
  qty: number;
  price: number;
  expectedPrice: number | null;
  slippageBps: number | null;
};

export type SlippageMetrics = {
  windowFills: number;
  windowNotional: number;
  avgSlippageBps: number | null;
  medianSlippageBps: number | null;
  p95SlippageBps: number | null;
  worstSlippageBps: number | null;
};

