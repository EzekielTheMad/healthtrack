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
  // Absolute base for og:/twitter: image URLs — without it Next falls back to
  // http://localhost:3000 in social embeds. APP_URL is this instance's origin.
  metadataBase: new URL(process.env.APP_URL ?? 'http://localhost:3000'),
  title: 'HealthTrack',
  description: 'Personal health tracking - medical history, labs, vitals, and medications in one place.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'HealthTrack',
  },
  openGraph: {
    title: 'HealthTrack',
    description: 'Personal health tracking - medical history, labs, vitals, and medications in one place.',
    siteName: 'HealthTrack',
    type: 'website',
    images: ['/icon-512.png'],
  },
  twitter: {
    card: 'summary',
    title: 'HealthTrack',
    description: 'Personal health tracking - medical history, labs, vitals, and medications in one place.',
    images: ['/icon-512.png'],
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
