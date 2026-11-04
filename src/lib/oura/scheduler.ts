import { syncAllOuraUsers, type AllUsersSyncSummary } from './sync';

const DEFAULT_INTERVAL_HOURS = 4;
type SchedulerState = {
  running: boolean;
  timer?: ReturnType<typeof setInterval>;
  nextRunAt?: string;
};
const globalState = globalThis as typeof globalThis & {
  __healthtrackOuraScheduler?: SchedulerState;
};

export function ouraSyncIntervalMs() {
  const hours = Number(process.env.OURA_SYNC_INTERVAL_HOURS ?? DEFAULT_INTERVAL_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_INTERVAL_HOURS) * 60 * 60 * 1000;
}

export function getOuraSchedulerStatus() {
  return {
    scheduled: !!globalState.__healthtrackOuraScheduler?.timer,
    nextRunAt: globalState.__healthtrackOuraScheduler?.nextRunAt ?? null,
  };
}

/** Run one non-overlapping scheduler pass; null means an existing pass is active. */
export async function runOuraSyncOnce(): Promise<AllUsersSyncSummary | null> {
  globalState.__healthtrackOuraScheduler ??= { running: false };
  if (globalState.__healthtrackOuraScheduler.running) return null;
  globalState.__healthtrackOuraScheduler.running = true;
  try {
    const summary = await syncAllOuraUsers();
    if (summary.errors.length > 0) {
      console.error('[oura] scheduler sync errors:', summary.errors.join('; '));
    }
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[oura] scheduler run failed:', message);
    return { usersAttempted: 0, synced: 0, errors: [message] };
  } finally {
    globalState.__healthtrackOuraScheduler.running = false;
  }
}

/** Register exactly one startup + interval scheduler per Node process. */
export function registerOuraScheduler(): void {
  if (
    process.env.OURA_SYNC_ENABLED === 'false' ||
    !process.env.OURA_CLIENT_ID ||
    !process.env.OURA_CLIENT_SECRET
  ) {
    return;
  }
  globalState.__healthtrackOuraScheduler ??= { running: false };
  if (globalState.__healthtrackOuraScheduler.timer) return;
  void runOuraSyncOnce();
  globalState.__healthtrackOuraScheduler.nextRunAt = new Date(
    Date.now() + ouraSyncIntervalMs()
  ).toISOString();
  const timer = setInterval(() => {
    globalState.__healthtrackOuraScheduler!.nextRunAt = new Date(
      Date.now() + ouraSyncIntervalMs()
    ).toISOString();
    void runOuraSyncOnce();
  }, ouraSyncIntervalMs());
  timer.unref?.();
  globalState.__healthtrackOuraScheduler.timer = timer;
}
