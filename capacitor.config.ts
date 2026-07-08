import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.healthtrack.app',
  appName: 'HealthTrack',
  webDir: 'out',
  server: {
    // For development, point to local dev server
    // url: 'http://localhost:3000',
    // cleartext: true,
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#0B0F1A',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0B0F1A',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
