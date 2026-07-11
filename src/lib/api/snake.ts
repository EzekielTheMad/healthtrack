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

// ---------------------------------------------------------------------------
// Deep variants — fitness-domain payloads only.
//
// Workout writes nest entries and set arrays ({ per_side, warmup }), and the
// read shapes nest resolved exercises, so the fitness v1 routes need recursive
// key conversion. Vitals keeps the SHALLOW converters above on purpose: its
// `metadata` object carries free-form client keys that must never be rewritten.
// The fitness schemas have no free-form object fields, so deep conversion is
// lossless there.
// ---------------------------------------------------------------------------

/** Drizzle/repo value (camelCase keys) → API JSON (snake_case keys), recursive. */
export function deepToSnake(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepToSnake);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[camelToSnakeKey(k)] = deepToSnake(v);
    return out;
  }
  return value;
}

/** Request JSON (snake_case keys) → repo input (camelCase keys), recursive. */
export function deepBodyToCamel(body: unknown): unknown {
  if (Array.isArray(body)) return body.map(deepBodyToCamel);
  if (body !== null && typeof body === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) out[snakeToCamelKey(k)] = deepBodyToCamel(v);
    return out;
  }
  return body;
}
