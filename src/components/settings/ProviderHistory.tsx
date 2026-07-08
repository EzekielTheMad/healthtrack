'use client';

interface ProviderHistoryProps {
  providerId: string;
}

export function ProviderHistory({ providerId: _providerId }: ProviderHistoryProps) {
  // Phase 2+: Show appointments, medications, lab visits, and conditions linked to this provider
  return (
    <div className="text-sm text-text-muted italic p-4">
      Provider history will show linked records here in a future update.
    </div>
  );
}
