import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ExecFill, ExecOrder, OrderSide, OrderType, OrderStatus, SlippageMetrics } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../data/execution.db');

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    qty REAL NOT NULL,
    type TEXT NOT NULL,
    limit_price REAL,
    expected_price REAL,
    status TEXT NOT NULL,
    filled_qty REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS fills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    qty REAL NOT NULL,
    price REAL NOT NULL,
    expected_price REAL,
    slippage_bps REAL,
    FOREIGN KEY(order_id) REFERENCES orders(id)
  );

  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_updated ON orders(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_fills_ts ON fills(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_fills_order ON fills(order_id);
`);

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function toSide(value: unknown): OrderSide {
  return String(value).toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
}

function toType(value: unknown): OrderType {
  return String(value).toUpperCase() === 'LIMIT' ? 'LIMIT' : 'MARKET';
}

function normalizeSymbol(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,15}$/.test(s)) return '';
  return s;
}

function rowToOrder(r: any): ExecOrder {
  return {
    id: String(r.id),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    symbol: String(r.symbol),
    side: toSide(r.side),
    qty: Number(r.qty),
    type: toType(r.type),
    limitPrice: r.limit_price == null ? null : Number(r.limit_price),
    expectedPrice: r.expected_price == null ? null : Number(r.expected_price),
    status: String(r.status) as OrderStatus,
    filledQty: Number(r.filled_qty)
  };
}

function rowToFill(r: any): ExecFill {
  return {
    id: Number(r.id),
    orderId: String(r.order_id),
    ts: Number(r.ts),
    symbol: String(r.symbol),
    side: toSide(r.side),
    qty: Number(r.qty),
    price: Number(r.price),
    expectedPrice: r.expected_price == null ? null : Number(r.expected_price),
    slippageBps: r.slippage_bps == null ? null : Number(r.slippage_bps)
  };
}

export function createOrder(input: {
  symbol: string;
  side: unknown;
  qty: number;
  type: unknown;
  limitPrice?: number | null;
  expectedPrice?: number | null;
}): ExecOrder {
  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) throw new Error('Invalid symbol');
  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Invalid qty');

  const side = toSide(input.side);
  const type = toType(input.type);

  const limitPrice = input.limitPrice == null ? null : Number(input.limitPrice);
  if (type === 'LIMIT' && (!Number.isFinite(limitPrice) || limitPrice! <= 0)) throw new Error('limitPrice required for LIMIT orders');

  const expectedPrice = input.expectedPrice == null ? null : Number(input.expectedPrice);
  if (expectedPrice != null && (!Number.isFinite(expectedPrice) || expectedPrice <= 0)) throw new Error('Invalid expectedPrice');

  const now = Date.now();
  const id = newId('ord');

  const stmt = db.prepare(`
    INSERT INTO orders (id, created_at, updated_at, symbol, side, qty, type, limit_price, expected_price, status, filled_qty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, now, now, symbol, side, qty, type, limitPrice, expectedPrice, 'PENDING', 0);
  return getOrder(id)!;
}

export function getOrder(orderId: string): ExecOrder | null {
  const row = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
  return row ? rowToOrder(row) : null;
}

export function listPendingOrders(limit = 50): ExecOrder[] {
  const rows = db
    .prepare(`SELECT * FROM orders WHERE status IN ('PENDING','PARTIAL') ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as any[];
  return rows.map(rowToOrder);
}

export function listOrderHistory(limit = 100): ExecOrder[] {
  const rows = db.prepare(`SELECT * FROM orders ORDER BY created_at DESC LIMIT ?`).all(limit) as any[];
  return rows.map(rowToOrder);
}

export function listFills(limit = 100): ExecFill[] {
  const rows = db.prepare(`SELECT * FROM fills ORDER BY ts DESC LIMIT ?`).all(limit) as any[];
  return rows.map(rowToFill);
}

export function cancelOrder(orderId: string): ExecOrder {
  const existing = getOrder(orderId);
  if (!existing) throw new Error('Order not found');
  if (existing.status === 'FILLED') throw new Error('Order already filled');

  const now = Date.now();
  db.prepare(`UPDATE orders SET status = 'CANCELED', updated_at = ? WHERE id = ?`).run(now, orderId);
  return getOrder(orderId)!;
}

export function createFill(input: { orderId: string; qty?: number; price: number }): { order: ExecOrder; fill: ExecFill } {
  const order = getOrder(input.orderId);
  if (!order) throw new Error('Order not found');
  if (order.status === 'CANCELED') throw new Error('Order is canceled');
  if (order.status === 'FILLED') throw new Error('Order already filled');

  const price = Number(input.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid price');

  const remaining = Math.max(0, order.qty - order.filledQty);
  if (remaining <= 0) throw new Error('Nothing left to fill');

  const qty = input.qty == null ? remaining : Number(input.qty);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Invalid fill qty');
  const fillQty = Math.min(remaining, qty);

  const expected = order.expectedPrice;
  const slippageBps =
    expected != null && Number.isFinite(expected) && expected > 0 ? ((price - expected) / expected) * 10_000 : null;

  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO fills (order_id, ts, symbol, side, qty, price, expected_price, slippage_bps) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(order.id, now, order.symbol, order.side, fillQty, price, expected, slippageBps);

    const nextFilled = order.filledQty + fillQty;
    const nextStatus: OrderStatus = nextFilled >= order.qty ? 'FILLED' : 'PARTIAL';
    db.prepare(`UPDATE orders SET filled_qty = ?, status = ?, updated_at = ? WHERE id = ?`).run(nextFilled, nextStatus, now, order.id);
  });

  tx();

  const updated = getOrder(order.id)!;
  const fill = db.prepare(`SELECT * FROM fills WHERE order_id = ? ORDER BY id DESC LIMIT 1`).get(order.id) as any;
  return { order: updated, fill: rowToFill(fill) };
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const a = sorted[base]!;
  const b = sorted[Math.min(sorted.length - 1, base + 1)]!;
  return a + (b - a) * rest;
}

export function computeSlippageMetrics(opts?: { windowMs?: number; maxFills?: number }): SlippageMetrics {
  const windowMs = opts?.windowMs ?? 24 * 60 * 60 * 1000;
  const maxFills = opts?.maxFills ?? 500;
  const since = Date.now() - windowMs;

  const rows = db
    .prepare(`SELECT qty, price, slippage_bps FROM fills WHERE ts >= ? ORDER BY ts DESC LIMIT ?`)
    .all(since, maxFills) as any[];

  let notional = 0;
  const slips: number[] = [];

  for (const r of rows) {
    const qty = Number(r.qty);
    const price = Number(r.price);
    if (Number.isFinite(qty) && Number.isFinite(price)) notional += qty * price;
    const sb = r.slippage_bps == null ? null : Number(r.slippage_bps);
    if (sb != null && Number.isFinite(sb)) slips.push(sb);
  }

  slips.sort((a, b) => a - b);
  const avg = slips.length ? slips.reduce((s, x) => s + x, 0) / slips.length : null;

  return {
    windowFills: rows.length,
    windowNotional: notional,
    avgSlippageBps: avg,
    medianSlippageBps: quantile(slips, 0.5),
    p95SlippageBps: quantile(slips, 0.95),
    worstSlippageBps: slips.length ? slips[slips.length - 1]! : null
  };
}

export { db };

