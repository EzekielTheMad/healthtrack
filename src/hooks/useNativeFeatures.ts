'use client';

import { isNativeApp, getPlatform } from '@/lib/capacitor';

export function useNativeFeatures() {
  const isNative = isNativeApp();
  const platform = getPlatform();

  // Haptic feedback (no-op on web)
  async function hapticImpact() {
    if (!isNative) return;
    try {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch {}
  }

  // Status bar styling (no-op on web)
  async function setStatusBarDark() {
    if (!isNative) return;
    try {
      const { StatusBar, Style } = await import('@capacitor/status-bar');
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.setBackgroundColor({ color: '#0B0F1A' });
    } catch {}
  }

  return { isNative, platform, hapticImpact, setStatusBarDark };
}
