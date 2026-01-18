export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function pickString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

export function pickNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return null;
  return n;
}

export function pickInt(value: unknown, fallback: number, opts: { min?: number; max?: number } = {}): number {
  const raw = pickNumber(value);
  const n = raw == null ? fallback : Math.floor(raw);
  const min = opts.min ?? -Infinity;
  const max = opts.max ?? Infinity;
  return Math.max(min, Math.min(max, n));
}

export function pickStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => pickString(v)).filter(Boolean);
}

