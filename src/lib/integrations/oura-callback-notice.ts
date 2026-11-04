export function ouraCallbackNotice(params: { get(name: string): string | null }) {
  if (params.get('oura') === 'connected') {
    const outcomes: Record<string, string> = {
      success: 'Oura authorization saved. Initial sync completed.',
      empty: 'Oura authorization saved. Initial sync succeeded, but no measurements were returned.',
      partial:
        'Oura authorization saved. Some collections could not be retrieved; review the available measurement dates.',
      failed:
        'Oura authorization saved. Initial sync failed; review the status and retry when available.',
    };
    const outcome = params.get('initial_sync') ?? '';
    return Object.hasOwn(outcomes, outcome)
      ? outcomes[outcome]
      : 'Oura authorization saved. Check the current sync status below.';
  }
  if (params.get('oura') !== 'error') return null;
  const reasons: Record<string, string> = {
    access_denied: 'Oura authorization was cancelled. You can connect again when ready.',
    missing_code: 'Oura authorization was not completed. Please try again.',
    invalid_state:
      'This authorization link expired or did not match your session. Please reconnect.',
    token_exchange_failed: 'Could not complete Oura authorization. Please try again.',
    timeout: 'Oura did not respond in time during authorization. Please try again.',
    network_error: 'Could not reach Oura during authorization. Please try again.',
    invalid_response: 'Oura returned an unexpected authorization response. Please try again.',
    save_failed: 'Could not save Oura authorization. Please try again.',
    config_error: 'Ask the instance administrator to configure the Oura OAuth client.',
  };
  const reason = params.get('reason') ?? '';
  return Object.hasOwn(reasons, reason)
    ? reasons[reason]
    : 'Oura authorization failed. Please try again.';
}
