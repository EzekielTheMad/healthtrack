import { syncAllOuraUsers } from './sync';

const DEFAULT_INTERVAL_HOURS = 4;
const globalState = globalThis as typeof globalThis & { __healthtrackOuraScheduler?: { running: boolean; timer?: ReturnType<typeof setInterval> } };

function intervalMs() {
  const hours = Number(process.env.OURA_SYNC_INTERVAL_HOURS ?? DEFAULT_INTERVAL_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_INTERVAL_HOURS) * 60 * 60 * 1000;
}

export async function runOuraSyncOnce(): Promise<void> {
  if (globalState.__healthtrackOuraScheduler?.running) return;
  globalState.__healthtrackOuraScheduler ??= { running: false };
  if (globalState.__healthtrackOuraScheduler.running) return;
  globalState.__healthtrackOuraScheduler.running = true;
  try { await syncAllOuraUsers(); } catch (error) { console.error('[oura] scheduler run failed:', error); } finally { globalState.__healthtrackOuraScheduler.running = false; }
}

/** Register exactly one startup + interval scheduler per Node process. */
export function registerOuraScheduler(): void {
  if (process.env.OURA_SYNC_ENABLED === 'false' || !process.env.OURA_CLIENT_ID || !process.env.OURA_CLIENT_SECRET) return;
  globalState.__healthtrackOuraScheduler ??= { running: false };
  if (globalState.__healthtrackOuraScheduler.timer) return;
  void runOuraSyncOnce();
  const timer = setInterval(() => void runOuraSyncOnce(), intervalMs());
  timer.unref?.();
  globalState.__healthtrackOuraScheduler.timer = timer;
}
