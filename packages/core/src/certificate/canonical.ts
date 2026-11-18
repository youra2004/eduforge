import { createHash } from 'node:crypto';

/**
 * The signing input of a certificate (F10-R2): JSON with object keys sorted at every level, no whitespace,
 * arrays in their order. The same payload always gives the same string, whatever order its keys were built in
 * or Postgres returned them in. `scripts/verify-certificate.mjs` repeats these rules on its own.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalize: numbers must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
  }
  throw new Error(`canonicalize: unsupported value of type ${typeof value}`);
}

export const signingInput = (payload: unknown) => Buffer.from(canonicalize(payload), 'utf8');

export const sha256Hex = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
