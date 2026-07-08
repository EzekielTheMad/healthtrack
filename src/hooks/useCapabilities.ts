'use client';

import { useEffect, useState } from 'react';
import type { Capabilities } from '@/lib/capabilities';

/**
 * Client-side instance capabilities (GET /api/capabilities).
 *
 * `capabilities` is null until the first fetch resolves; gate UI with
 * `capabilities?.<flag> === false` so nothing flickers out of existence on
 * configured instances while the fetch is in flight. The result is cached
 * module-wide — capabilities are static for the life of the server process.
 */

let cachedFetch: Promise<Capabilities | null> | null = null;

function fetchCapabilities(): Promise<Capabilities | null> {
  cachedFetch ??= fetch('/api/capabilities')
    .then((res) => (res.ok ? (res.json() as Promise<Capabilities>) : null))
    .catch(() => {
      cachedFetch = null; // allow a retry on the next mount
      return null;
    });
  return cachedFetch;
}

export function useCapabilities() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchCapabilities().then((caps) => {
      if (cancelled) return;
      if (caps) setCapabilities(caps);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { capabilities, loading };
}
