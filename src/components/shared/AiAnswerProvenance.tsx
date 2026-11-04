'use client';
import type { AiProvenance } from '@/lib/ai/types';
export default function AiAnswerProvenance({
  evidence,
  currentRevision,
}: {
  evidence?: AiProvenance;
  currentRevision?: string;
}) {
  return (
    <p className="text-xs break-words" style={{ color: 'var(--color-text-muted)' }}>
      {evidence ? (
        <>
          AI: {evidence.provider} · {evidence.model}
          {currentRevision && currentRevision !== evidence.configuration_revision
            ? ' · Saved under earlier AI settings'
            : ''}
        </>
      ) : (
        'Earlier AI answer · provider settings were not recorded'
      )}
    </p>
  );
}
