'use client';

// Safe imports that work in both web and native contexts
export function isNativeApp(): boolean {
  // Check if running inside Capacitor native shell
  return typeof window !== 'undefined' &&
    window.Capacitor !== undefined &&
    window.Capacitor.isNativePlatform();
}

export function getPlatform(): 'web' | 'android' | 'ios' {
  if (typeof window === 'undefined') return 'web';
  if (window.Capacitor?.getPlatform() === 'android') return 'android';
  if (window.Capacitor?.getPlatform() === 'ios') return 'ios';
  return 'web';
}
