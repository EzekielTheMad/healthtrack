import { StrictMode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { idleActivityKey, startIdleSession } from '@/lib/auth/idle-activity';
import { AutoLogout } from './AutoLogout';

const auth = vi.hoisted(() => ({
  data: { session: { id: 'login-one' }, user: { id: 'synthetic-owner' } } as {
    session: { id: string };
    user: { id: string };
  } | null,
  isPending: false,
  getSession: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('@/lib/auth/client', () => ({
  useSession: () => auth,
  authClient: { getSession: auth.getSession, signOut: auth.signOut },
}));

const MINUTE = 60_000;
const LIMIT = 15 * MINUTE;
type Listener = (event: Event) => void;
type TestTab = {
  browser: Window;
  page: Document;
  state: { visible: boolean; focused: boolean; blocked: boolean };
  emit: (type: string, extra?: object, trusted?: boolean) => void;
  visibility: (visible: boolean) => void;
  setItem: Mock<(key: string, value: string) => void>;
  listeners: Map<string, Set<Listener>>;
  pageListeners: Map<string, Set<Listener>>;
};
function twoDocuments() {
  const values = new Map<string, string>();
  const tabs: TestTab[] = [];
  function makeTab(): TestTab {
    const listeners = new Map<string, Set<Listener>>();
    const pageListeners = new Map<string, Set<Listener>>();
    const state = { visible: true, focused: true, blocked: false };
    const add = (map: Map<string, Set<Listener>>, type: string, listener: Listener) => {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type)!.add(listener);
    };
    const emit = (type: string, extra: object = {}, trusted = true) => {
      for (const listener of listeners.get(type) ?? [])
        listener({ type, isTrusted: trusted, ...extra } as Event);
    };
    const setItem = vi.fn((key: string, value: string) => {
      if (state.blocked) throw new Error('storage unavailable');
      values.set(key, value);
      for (const other of tabs) if (other !== tab) other.emit('storage', { key });
    });
    const browser = {
      localStorage: {
        getItem: (key: string) => {
          if (state.blocked) throw new Error('storage unavailable');
          return values.get(key) ?? null;
        },
        setItem,
      },
      addEventListener: (type: string, listener: Listener) => add(listeners, type, listener),
      removeEventListener: (type: string, listener: Listener) =>
        listeners.get(type)?.delete(listener),
    } as unknown as Window;
    const page = {
      get visibilityState() {
        return state.visible ? 'visible' : 'hidden';
      },
      hasFocus: () => state.focused,
      addEventListener: (type: string, listener: Listener) => add(pageListeners, type, listener),
      removeEventListener: (type: string, listener: Listener) =>
        pageListeners.get(type)?.delete(listener),
    } as unknown as Document;
    const visibility = (visible: boolean) => {
      state.visible = visible;
      for (const listener of pageListeners.get('visibilitychange') ?? [])
        listener({ type: 'visibilitychange' } as Event);
    };
    const tab = { browser, page, state, emit, visibility, setItem, listeners, pageListeners };
    tabs.push(tab);
    return tab;
  }
  return { values, makeTab };
}
function options(sessionId = 'login-one') {
  return {
    sessionId,
    timeoutMs: LIMIT,
    getCurrentSessionId: vi.fn(async () => sessionId as string | null),
    signOut: vi.fn(async () => {}),
    onTimeout: vi.fn(),
    onSessionChanged: vi.fn(),
  };
}
const stops: (() => void)[] = [];
function start(tab: TestTab, opt = options()) {
  const stop = startIdleSession(opt, tab.browser, tab.page);
  stops.push(stop);
  return { opt, stop };
}
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
  auth.data = { session: { id: 'login-one' }, user: { id: 'synthetic-owner' } };
  auth.isPending = false;
  localStorage.clear();
  auth.getSession.mockReset().mockResolvedValue({ data: auth.data, error: null });
  auth.signOut.mockReset().mockResolvedValue({ data: { success: true }, error: null });
});
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('one inactivity deadline across website documents', () => {
  it('active touch at minute 14 prevents another document signing out at minute 15', async () => {
    const env = twoDocuments(),
      old = env.makeTab(),
      active = env.makeTab();
    const first = start(old).opt,
      second = start(active).opt;
    await advance(14 * MINUTE);
    active.emit('touchstart');
    await advance(MINUTE);
    expect(first.signOut).not.toHaveBeenCalled();
    expect(second.signOut).not.toHaveBeenCalled();
    await advance(14 * MINUTE);
    expect(first.signOut.mock.calls.length + second.signOut.mock.calls.length).toBeGreaterThan(0);
  });
  it('a hidden overdue document never revokes an active foreground document', async () => {
    const env = twoDocuments(),
      old = env.makeTab(),
      active = env.makeTab();
    const first = start(old).opt,
      second = start(active).opt;
    old.visibility(false);
    await advance(14 * MINUTE);
    active.emit('keydown');
    await advance(2 * MINUTE);
    old.visibility(true);
    old.emit('focus');
    await advance(0);
    expect(first.signOut).not.toHaveBeenCalled();
    expect(second.signOut).not.toHaveBeenCalled();
  });
  it('does not sign out from an unfocused visible window', async () => {
    const env = twoDocuments(),
      old = env.makeTab(),
      active = env.makeTab();
    const first = start(old).opt;
    start(active);
    old.state.focused = false;
    await advance(14 * MINUTE);
    active.emit('mousedown');
    await advance(2 * MINUTE);
    expect(first.signOut).not.toHaveBeenCalled();
  });
  it('retains the exact fifteen-minute idle deadline', async () => {
    const env = twoDocuments(),
      tab = env.makeTab(),
      { opt } = start(tab);
    await advance(LIMIT - 1);
    expect(opt.signOut).not.toHaveBeenCalled();
    await advance(1);
    expect(opt.signOut).toHaveBeenCalledTimes(1);
    expect(opt.onTimeout).toHaveBeenCalledTimes(1);
  });
  it('does not renew inactivity merely through focus or visibility', async () => {
    const env = twoDocuments(),
      tab = env.makeTab(),
      { opt } = start(tab);
    await advance(14 * MINUTE);
    tab.emit('focus');
    tab.visibility(false);
    tab.visibility(true);
    await advance(MINUTE);
    expect(opt.signOut).toHaveBeenCalledTimes(1);
  });
  it('checks an overdue hidden page before accepting the resume touch', async () => {
    const env = twoDocuments(),
      tab = env.makeTab(),
      { opt } = start(tab);
    tab.visibility(false);
    await advance(LIMIT + MINUTE);
    tab.visibility(true);
    tab.emit('touchstart');
    await advance(0);
    expect(opt.signOut).toHaveBeenCalledTimes(1);
  });
  it('re-reads shared storage at the deadline even if its storage event was missed', async () => {
    const env = twoDocuments(),
      tab = env.makeTab(),
      { opt } = start(tab);
    await advance(14 * MINUTE);
    env.values.set(idleActivityKey('login-one'), String(Date.now()));
    await advance(MINUTE);
    expect(opt.signOut).not.toHaveBeenCalled();
  });
  it('does not publish synthetic activity or turn storage notifications into activity', async () => {
    const env = twoDocuments(),
      tab = env.makeTab(),
      { opt } = start(tab);
    const writes = tab.setItem.mock.calls.length;
    await advance(14 * MINUTE);
    tab.emit('scroll', {}, false);
    tab.emit('storage', { key: idleActivityKey('login-one') });
    tab.emit('focus');
    expect(tab.setItem).toHaveBeenCalledTimes(writes);
    await advance(MINUTE);
    expect(opt.signOut).toHaveBeenCalledTimes(1);
  });
  it('throttles scrolling writes and flushes the last genuine timestamp on hiding', async () => {
    const env = twoDocuments(),
      tab = env.makeTab();
    start(tab);
    for (let i = 0; i < 60; i++) {
      await advance(10);
      tab.emit('scroll');
    }
    expect(tab.setItem.mock.calls.length).toBeLessThanOrEqual(2);
    tab.visibility(false);
    expect(env.values.get(idleActivityKey('login-one'))).toBe(String(Date.now()));
  });
  it.each(['corrupt', '', 'NaN', 'Infinity', '999999999999999999999'])(
    'keeps a local deadline for invalid storage %s',
    async (value) => {
      const env = twoDocuments(),
        tab = env.makeTab();
      env.values.set(idleActivityKey('login-one'), value);
      const { opt } = start(tab);
      await advance(LIMIT);
      expect(opt.signOut).toHaveBeenCalledTimes(1);
    }
  );
  it('ignores future timestamps and retains a bounded local deadline', async () => {
    const env = twoDocuments(),
      tab = env.makeTab();
    env.values.set(idleActivityKey('login-one'), String(Date.now() + LIMIT));
    const { opt } = start(tab);
    await advance(LIMIT);
    expect(opt.signOut).toHaveBeenCalledTimes(1);
  });
  it('preserves inactivity limits when storage is unavailable', async () => {
    const env = twoDocuments(),
      tab = env.makeTab();
    tab.state.blocked = true;
    const { opt } = start(tab);
    await advance(14 * MINUTE);
    tab.emit('touchstart');
    await advance(LIMIT - 1);
    expect(opt.signOut).not.toHaveBeenCalled();
    await advance(1);
    expect(opt.signOut).toHaveBeenCalledTimes(1);
  });
  it('new login gets its own deadline without inheriting expired activity', async () => {
    const env = twoDocuments(),
      tab = env.makeTab();
    env.values.set(idleActivityKey('login-one'), String(Date.now() - LIMIT));
    const { opt } = start(tab, options('login-two'));
    await advance(0);
    expect(opt.signOut).not.toHaveBeenCalled();
    await advance(LIMIT);
    expect(opt.signOut).toHaveBeenCalledTimes(1);
    expect([...env.values.keys()].sort()).toEqual(
      [idleActivityKey('login-one'), idleActivityKey('login-two')].sort()
    );
  });
  it('clears an expired document when the server confirms no session remains', async () => {
    const env = twoDocuments(),
      tab = env.makeTab(),
      opt = options();
    opt.getCurrentSessionId.mockResolvedValue(null);
    start(tab, opt);
    await advance(LIMIT);
    expect(opt.signOut).not.toHaveBeenCalled();
    expect(opt.onTimeout).toHaveBeenCalledTimes(1);
  });
  it('cannot revoke a replacement login returned by the final session check', async () => {
    const env = twoDocuments(),
      tab = env.makeTab(),
      opt = options();
    opt.getCurrentSessionId.mockResolvedValue('login-two');
    start(tab, opt);
    await advance(LIMIT);
    expect(opt.signOut).not.toHaveBeenCalled();
    expect(opt.onTimeout).not.toHaveBeenCalled();
  });
  it('clears prior-account state through neutral navigation when the server confirms a different login', async () => {
    const env = twoDocuments(),
      tab = env.makeTab(),
      opt = options();
    opt.getCurrentSessionId.mockResolvedValue('replacement-login');
    start(tab, opt);
    await advance(LIMIT);
    expect(opt.onSessionChanged).toHaveBeenCalledTimes(1);
    expect(opt.signOut).not.toHaveBeenCalled();
    expect(opt.onTimeout).not.toHaveBeenCalled();
  });
  it('does not renew a genuine expired deadline with input during awaited verification', async () => {
    const env = twoDocuments(),
      tab = env.makeTab(),
      opt = options(),
      pending = deferred<string | null>();
    opt.getCurrentSessionId.mockImplementation(() => pending.promise);
    start(tab, opt);
    await advance(LIMIT);
    tab.emit('touchstart');
    pending.resolve('login-one');
    await advance(0);
    expect(opt.signOut).toHaveBeenCalledTimes(1);
  });
  it('accepts a delayed shared write of pre-deadline activity during verification', async () => {
    const env = twoDocuments(),
      tab = env.makeTab(),
      opt = options(),
      pending = deferred<string | null>();
    opt.getCurrentSessionId.mockImplementation(() => pending.promise);
    start(tab, opt);
    await advance(LIMIT);
    env.values.set(idleActivityKey('login-one'), String(Date.now() - 1));
    pending.resolve('login-one');
    await advance(0);
    expect(opt.signOut).not.toHaveBeenCalled();
  });
  it('does not revoke after unmount while a verification is pending', async () => {
    const env = twoDocuments(),
      tab = env.makeTab(),
      opt = options(),
      pending = deferred<string | null>();
    opt.getCurrentSessionId.mockImplementation(() => pending.promise);
    const { stop } = start(tab, opt);
    await advance(LIMIT);
    stop();
    pending.resolve('login-one');
    await advance(0);
    expect(opt.signOut).not.toHaveBeenCalled();
    expect(opt.onTimeout).not.toHaveBeenCalled();
  });
  it('never signs out while session verification fails', async () => {
    const env = twoDocuments(),
      tab = env.makeTab(),
      opt = options();
    opt.getCurrentSessionId.mockRejectedValue(new Error('offline'));
    start(tab, opt);
    await advance(LIMIT);
    expect(opt.signOut).not.toHaveBeenCalled();
    expect(opt.onTimeout).toHaveBeenCalledTimes(1);
  });
  it('cleanup removes listeners, timers and duplicate StrictMode effects', () => {
    const env = twoDocuments(),
      tab = env.makeTab();
    const first = start(tab);
    first.stop();
    const second = start(tab);
    second.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect([...tab.listeners.values()].every((set) => set.size === 0)).toBe(true);
    expect([...tab.pageListeners.values()].every((set) => set.size === 0)).toBe(true);
  });
  it('does not create controller effects until the current public session exists', () => {
    auth.isPending = true;
    const add = vi.spyOn(window, 'addEventListener');
    const view = render(
      <StrictMode>
        <AutoLogout timeoutMinutes={15} />
      </StrictMode>
    );
    expect(add.mock.calls.filter((call) => call[0] === 'storage')).toHaveLength(0);
    auth.isPending = false;
    auth.data = null;
    view.rerender(<AutoLogout timeoutMinutes={15} />);
    expect(add.mock.calls.filter((call) => call[0] === 'storage')).toHaveLength(0);
  });
  it('reactive session changes clean up the previous scope', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    const view = render(<AutoLogout timeoutMinutes={15} />);
    await act(() => advance(14 * MINUTE));
    auth.data = { session: { id: 'login-two' }, user: { id: 'synthetic-owner' } };
    auth.getSession.mockResolvedValue({ data: auth.data, error: null });
    view.rerender(<AutoLogout timeoutMinutes={15} />);
    await act(() => advance(MINUTE));
    expect(auth.signOut).not.toHaveBeenCalled();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels an old pending session check when the known reactive login changes', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    const oldData = auth.data;
    const pending = deferred<{ data: typeof auth.data; error: null }>();
    auth.getSession.mockImplementation(() => pending.promise);
    const view = render(<AutoLogout timeoutMinutes={15} />);
    await act(() => advance(LIMIT));
    expect(auth.getSession).toHaveBeenCalledWith({
      query: { disableCookieCache: true, disableRefresh: true },
    });
    auth.data = { session: { id: 'replacement-login' }, user: { id: 'synthetic-owner' } };
    view.rerender(<AutoLogout timeoutMinutes={15} />);
    pending.resolve({ data: oldData, error: null });
    await act(() => advance(0));
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(localStorage.getItem(idleActivityKey('replacement-login'))).toBe(String(Date.now()));
  });
  it('cleans up replayed active StrictMode effects without duplicate deadlines', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    const view = render(
      <StrictMode>
        <AutoLogout timeoutMinutes={15} />
      </StrictMode>
    );
    auth.getSession.mockResolvedValue({ data: { session: { id: 'new-login' } }, error: null });
    await act(() => advance(LIMIT));
    expect(auth.getSession).toHaveBeenCalledTimes(1);
    expect(auth.signOut).not.toHaveBeenCalled();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
