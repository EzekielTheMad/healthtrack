/**
 * Register the service worker and handle updates.
 */
export async function registerServiceWorker(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');

    // If there is already a waiting worker, prompt user to refresh
    if (reg.waiting) {
      notifyUpdateReady(reg);
    }

    // Detect when a new service worker is installed and waiting
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New version available — prompt to refresh
          notifyUpdateReady(reg);
        }
      });
    });

    // When the controlling service worker changes (after SKIP_WAITING), reload
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  } catch (error) {
    console.error('Service worker registration failed:', error);
  }
}

function notifyUpdateReady(reg: ServiceWorkerRegistration): void {
  // For now, auto-apply the update. A more polished UX could show a toast
  // asking the user to click "Update" before calling skipWaiting.
  if (reg.waiting) {
    reg.waiting.postMessage('SKIP_WAITING');
  }
}
