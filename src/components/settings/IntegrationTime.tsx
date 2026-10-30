import { exactIntegrationTime, relativeIntegrationTime } from '@/lib/integrations/presentation';

export function IntegrationTime({
  value,
  timeZone,
  exact = false,
}: {
  value: string | null | undefined;
  timeZone?: string;
  exact?: boolean;
}) {
  const full = exactIntegrationTime(value, timeZone);
  return value && full !== 'Unknown' ? (
    <time dateTime={value} title={full}>
      {exact ? full : relativeIntegrationTime(value)}
    </time>
  ) : (
    <span>Unknown</span>
  );
}
