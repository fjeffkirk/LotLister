import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { UserProvider } from '../components/UserProvider';
import { SignInGate } from '../components/SignInGate';
import { CommandPaletteProvider } from '../components/CommandPalette';

export const metadata: Metadata = {
  title: 'LotLister - Card Lot Management',
  description: 'Manage trading card lots, import photos, and export to eBay',
};

export const viewport: Viewport = {
  themeColor: '#0a0c10',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <UserProvider>
          <SignInGate>
            <CommandPaletteProvider>
              <div className="min-h-screen flex flex-col">
                {children}
              </div>
            </CommandPaletteProvider>
          </SignInGate>
        </UserProvider>
      </body>
    </html>
  );
}
