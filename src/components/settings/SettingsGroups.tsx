'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  SETTINGS_TABS,
  resolveSettingsTab,
  settingsHref,
  settingsTarget,
  type SettingsTab,
} from '@/lib/settings-navigation';

function subscribeLocation(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener('popstate', onChange);
  };
}

const currentLocation = () => window.location.href;
const serverLocation = () => null;

export default function SettingsGroups({ panels }: { panels: Record<SettingsTab, ReactNode> }) {
  // Next updates this hook for query-only Link navigations; fragments need the
  // browser subscription too. Wait for that first browser snapshot before
  // mounting a form so legacy hash links do not briefly open the wrong group.
  const searchParams = useSearchParams();
  const location = useSyncExternalStore<string | null>(
    subscribeLocation,
    currentLocation,
    serverLocation
  );
  const hash = location ? new URL(location).hash : '';
  const activeTab = location ? resolveSettingsTab(searchParams, hash) : null;
  const [visited, setVisited] = useState<SettingsTab[]>([]);
  // Adjust on selection, retaining each visited panel for this Settings visit.
  // This intentionally preserves in-progress forms and one-time token reveals.
  if (activeTab && !visited.includes(activeTab)) setVisited([...visited, activeTab]);
  const target = activeTab ? settingsTarget(searchParams, hash) : '';

  useEffect(() => {
    if (!activeTab || !target) return;
    const panel = document.getElementById(`settings-panel-${activeTab}`);
    if (!panel) return;
    const revealTarget = () => {
      const destination = document.getElementById(target);
      if (!destination || !panel.contains(destination)) return false;
      let ancestor: Element | null = destination;
      while (ancestor && ancestor !== panel) {
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
        ancestor = ancestor.parentElement;
      }
      const focusTarget =
        destination.querySelector<HTMLElement>('[data-settings-focus], h2, h3, summary') ??
        destination.closest('details')?.querySelector('summary') ??
        destination;
      if (!focusTarget.hasAttribute('tabindex')) focusTarget.setAttribute('tabindex', '-1');
      destination.scrollIntoView({ block: 'start' });
      focusTarget.focus({ preventScroll: true });
      return true;
    };
    if (revealTarget()) return;
    // Source cards may arrive after their status request. Observe only this
    // panel and stop once its destination is ready or the route changes.
    const observer = new MutationObserver(() => {
      if (revealTarget()) observer.disconnect();
    });
    observer.observe(panel, { childList: true, subtree: true });
    const timeout = window.setTimeout(() => observer.disconnect(), 10_000);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [activeTab, location, target]);

  useEffect(() => {
    const selected = document.querySelector<HTMLElement>(
      '[data-settings-tab][aria-current="page"]'
    );
    const navigation = selected?.closest('nav');
    if (selected && navigation) {
      // Move only the horizontal bar; scrolling the link into view vertically
      // would undo a deep link's scroll to its source card farther down.
      navigation.scrollTo({ left: Math.max(0, selected.offsetLeft - navigation.offsetLeft - 12) });
    }
  }, [activeTab]);

  return (
    <div className="min-w-0 space-y-5" id="settings-content">
      <nav aria-label="Settings sections" className="min-w-0 overflow-x-auto pb-2">
        <div
          className="flex w-max min-w-full gap-2 border-b pb-2"
          style={{ borderColor: 'var(--border-card)' }}
        >
          {SETTINGS_TABS.map((tab) => (
            <Link
              key={tab.id}
              data-settings-tab
              href={settingsHref(tab.id, undefined, searchParams.toString(), hash)}
              scroll={false}
              aria-current={activeTab === tab.id ? 'page' : undefined}
              className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{
                color: activeTab === tab.id ? 'var(--color-sage)' : 'var(--color-text-muted)',
                backgroundColor: activeTab === tab.id ? 'rgba(129, 178, 154, 0.12)' : undefined,
              }}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </nav>
      {!activeTab && (
        <p role="status" className="text-sm">
          Loading settings…
        </p>
      )}
      {SETTINGS_TABS.filter((tab) => visited.includes(tab.id)).map((tab) => (
        <section
          key={tab.id}
          id={`settings-panel-${tab.id}`}
          hidden={activeTab !== tab.id}
          aria-labelledby={`settings-heading-${tab.id}`}
          className="min-w-0 space-y-5"
        >
          <h2 id={`settings-heading-${tab.id}`} className="text-lg font-semibold">
            {tab.label}
          </h2>
          {panels[tab.id]}
        </section>
      ))}
    </div>
  );
}
