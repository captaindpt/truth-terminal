import type { PolymarketMarket } from '../types/index.js';

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';

interface GammaMarketResponse {
  id: string;
  slug: string;
  question: string;
  description: string;
  category: string;
  outcomes: string;           // JSON string of outcomes array
  outcomePrices: string;      // JSON string of prices array
  volume: string;
  volumeNum: number;
  liquidity: string;
  liquidityNum: number;
  endDate: string;
  active: boolean;
  closed: boolean;
  archived: boolean;
}

function parseMarket(raw: GammaMarketResponse): PolymarketMarket {
  let outcomes: string[] = [];
  let outcomePrices: number[] = [];

  try {
    outcomes = JSON.parse(raw.outcomes);
  } catch {
    outcomes = ['Yes', 'No'];  // Default for binary markets
  }

  try {
    outcomePrices = JSON.parse(raw.outcomePrices).map(Number);
  } catch {
    outcomePrices = [0.5, 0.5];
  }

  return {
    id: raw.id,
    question: raw.question,
    description: raw.description || '',
    outcomes,
    outcomePrices,
    volume: raw.volumeNum || 0,
    liquidity: raw.liquidityNum || 0,
    endDate: raw.endDate,
    category: raw.category || 'uncategorized',
    active: raw.active,
    closed: raw.closed
  };
}

export interface MarketFilters {
  active?: boolean;
  closed?: boolean;
  minVolume?: number;
  minLiquidity?: number;
  category?: string;
  limit?: number;
  offset?: number;
}

export async function fetchMarkets(filters: MarketFilters = {}): Promise<PolymarketMarket[]> {
  const params = new URLSearchParams();

  if (filters.active !== undefined) params.append('active', String(filters.active));
  if (filters.closed !== undefined) params.append('closed', String(filters.closed));
  if (filters.limit) params.append('limit', String(filters.limit));
  if (filters.offset) params.append('offset', String(filters.offset));

  const url = `${GAMMA_API_BASE}/markets?${params.toString()}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Polymarket API error: ${response.status} ${response.statusText}`);
  }

  const rawMarkets: GammaMarketResponse[] = await response.json();

  let markets = rawMarkets.map(parseMarket);

  // Apply local filters
  if (filters.minVolume) {
    markets = markets.filter(m => m.volume >= filters.minVolume!);
  }
  if (filters.minLiquidity) {
    markets = markets.filter(m => m.liquidity >= filters.minLiquidity!);
  }
  if (filters.category) {
    markets = markets.filter(m => m.category.toLowerCase() === filters.category!.toLowerCase());
  }

  return markets;
}

export async function fetchMarketById(id: string): Promise<PolymarketMarket> {
  const url = `${GAMMA_API_BASE}/markets/${id}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Polymarket API error: ${response.status} ${response.statusText}`);
  }

  const raw: GammaMarketResponse = await response.json();
  return parseMarket(raw);
}

export async function fetchMarketBySlug(slug: string): Promise<PolymarketMarket> {
  const url = `${GAMMA_API_BASE}/markets/slug/${slug}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Polymarket API error: ${response.status} ${response.statusText}`);
  }

  const raw: GammaMarketResponse = await response.json();
  return parseMarket(raw);
}

// Quick summary for listing markets
export function marketSummary(market: PolymarketMarket): string {
  const prices = market.outcomes.map((o, i) =>
    `${o}: ${(market.outcomePrices[i] * 100).toFixed(0)}%`
  ).join(' | ');

  return `[${market.category}] ${market.question}\n  ${prices} | Vol: $${market.volume.toLocaleString()} | Liq: $${market.liquidity.toLocaleString()}`;
}
