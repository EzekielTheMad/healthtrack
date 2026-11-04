const PREFIX = 'healthtrack.idle.v1.';
const WRITE_INTERVAL_MS = 1000;

export function idleActivityKey(sessionId: string) {
  return PREFIX + encodeURIComponent(sessionId);
}

interface IdleSessionOptions {
  sessionId: string;
  timeoutMs: number;
  getCurrentSessionId: () => Promise<string | null>;
  signOut: () => Promise<void>;
  onTimeout: () => void;
  onSessionChanged: () => void;
}

/** Browser coordination contains only a timestamp keyed by a public session record ID. */
export function startIdleSession(
  options: IdleSessionOptions,
  browser: Window = window,
  page: Document = document
) {
  const key = idleActivityKey(options.sessionId);
  let disposed = false;
  let checking = false;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastWrite = 0;
  let lastActivity = Date.now();
  const foreground = () => page.visibilityState === 'visible' && page.hasFocus();
  const stored = () => {
    try {
      const raw = browser.localStorage.getItem(key);
      const value = raw === null || raw.trim() === '' ? NaN : Number(raw);
      return Number.isSafeInteger(value) && value > 0 && value <= Date.now() ? value : null;
    } catch {
      return null;
    }
  };
  const existing = stored();
  if (existing !== null) lastActivity = existing;
  const latest = () => {
    lastActivity = Math.max(lastActivity, stored() ?? 0);
    return lastActivity;
  };
  const persist = () => {
    if (disposed) return;
    if (writeTimer !== undefined) clearTimeout(writeTimer);
    writeTimer = undefined;
    try {
      browser.localStorage.setItem(key, String(latest()));
    } catch {
      /* Local deadline remains bounded. */
    }
    lastWrite = Date.now();
  };
  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!disposed && foreground())
      timer = setTimeout(
        () => {
          void check();
        },
        Math.max(0, latest() + options.timeoutMs - Date.now())
      );
  };
  const check = async () => {
    if (disposed || checking || !foreground()) return;
    if (Date.now() - latest() < options.timeoutMs) {
      expired = false;
      schedule();
      return;
    }
    // Do not let input arriving after an expired deadline renew this login
    // while the current-session request is in flight.
    expired = true;
    checking = true;
    try {
      const currentId = await options.getCurrentSessionId();
      if (disposed || !foreground()) return;
      if (currentId !== options.sessionId) {
        // A confirmed missing session must also clear this document's records.
        // A different live login is never revoked; reload a neutral authorized
        // page so this document cannot keep showing the previous account.
        if (currentId === null) options.onTimeout();
        else options.onSessionChanged();
        disposed = true;
        return;
      }
      // Another document/input may have renewed activity while auth was checked.
      if (Date.now() - latest() < options.timeoutMs) {
        expired = false;
        schedule();
        return;
      }
      await options.signOut();
      if (!disposed && foreground()) options.onTimeout();
    } catch {
      // A failed verification cannot authorize revoking an unknown/new login.
      if (!disposed && foreground()) options.onTimeout();
    } finally {
      checking = false;
    }
  };
  const resume = () => {
    if (writeTimer !== undefined) persist();
    if (!foreground()) {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      return;
    }
    expired = Date.now() - latest() >= options.timeoutMs;
    void check();
  };
  const activity = (event: Event) => {
    if (disposed || !foreground() || !event.isTrusted) return;
    // Returning after a real idle deadline must not reset it with the focus tap.
    if (expired || Date.now() - latest() >= options.timeoutMs) {
      void check();
      return;
    }
    lastActivity = Date.now();
    if (Date.now() - lastWrite >= WRITE_INTERVAL_MS) persist();
    else if (writeTimer === undefined)
      writeTimer = setTimeout(persist, WRITE_INTERVAL_MS - (Date.now() - lastWrite));
    schedule();
  };
  const storage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) {
      latest();
      schedule();
    }
  };
  const pagehide = () => {
    if (writeTimer !== undefined) persist();
  };
  const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
  events.forEach((event) => browser.addEventListener(event, activity, { passive: true }));
  browser.addEventListener('storage', storage);
  browser.addEventListener('focus', resume);
  browser.addEventListener('pagehide', pagehide);
  page.addEventListener('visibilitychange', resume);
  if (existing === null) persist();
  resume();
  return () => {
    if (writeTimer !== undefined) persist();
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
    if (writeTimer !== undefined) clearTimeout(writeTimer);
    events.forEach((event) => browser.removeEventListener(event, activity));
    browser.removeEventListener('storage', storage);
    browser.removeEventListener('focus', resume);
    browser.removeEventListener('pagehide', pagehide);
    page.removeEventListener('visibilitychange', resume);
  };
}
