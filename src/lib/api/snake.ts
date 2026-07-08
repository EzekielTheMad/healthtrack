/**
 * Key-shape conversion between the Drizzle layer (camelCase properties) and
 * the HTTP layer (snake_case JSON — the shape PostgREST used to return, which
 * all client types in src/lib/types.ts and every component still expect).
 */

export function camelToSnakeKey(key: string): string {
  return key.replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`);
}

export function snakeToCamelKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

/** Drizzle row (camelCase) → API JSON (snake_case). Shallow by design. */
export function rowToSnake<T extends object>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[camelToSnakeKey(k)] = v;
  return out;
}

export function rowsToSnake<T extends object>(rows: T[]): Record<string, unknown>[] {
  return rows.map(rowToSnake);
}

/** Request JSON body (snake_case) → repo input (camelCase). Shallow. */
export function bodyToCamel(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) out[snakeToCamelKey(k)] = v;
  return out;
}
