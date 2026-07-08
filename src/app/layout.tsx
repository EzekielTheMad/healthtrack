import type { Metadata, Viewport } from 'next';
import { Fraunces, Nunito, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin'],
  axes: ['SOFT'],
});

const nunito = Nunito({
  variable: '--font-nunito',
  subsets: ['latin'],
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'HealthTrack',
  description: 'Personal health tracking - medical history, labs, vitals, and medications in one place.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'HealthTrack',
  },
};

export const viewport: Viewport = {
  themeColor: '#E07A5F',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${nunito.variable} ${jetbrainsMono.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-bg-primary text-text-primary font-[family-name:var(--font-nunito)]">
        <a href="#main-content" className="skip-to-content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
