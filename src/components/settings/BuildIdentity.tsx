'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
export default function BuildIdentity() {
  const [build, setBuild] = useState<{
    version: string;
    revision: string;
    timezone: string;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiFetch<typeof build>('/api/build')
      .then((data) => {
        if (!cancelled) setBuild(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
      {build
        ? `HealthTrack ${build.version} · ${build.revision} · ${build.timezone}`
        : 'Build information unavailable'}
    </p>
  );
}
