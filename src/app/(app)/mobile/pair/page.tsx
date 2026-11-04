import PairApproval from '@/components/mobile/PairApproval';
export const dynamic = 'force-dynamic';
export default async function PairPage({
  searchParams,
}: {
  searchParams: Promise<{ request_id?: string }>;
}) {
  const { request_id: id } = await searchParams;
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(id))
    return (
      <p role="alert">
        This pairing link is invalid. Start pairing from HealthTrack on your Android phone.
      </p>
    );
  return <PairApproval key={id} requestId={id} />;
}
