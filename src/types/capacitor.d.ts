interface Window {
  Capacitor?: {
    isNativePlatform(): boolean;
    getPlatform(): string;
  };
}
