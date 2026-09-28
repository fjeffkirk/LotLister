import type { Metadata } from 'next';
import './globals.css';
import { UserProvider } from '../components/UserProvider';
import { SignInGate } from '../components/SignInGate';

export const metadata: Metadata = {
  title: 'LotLister - Card Lot Management',
  description: 'Manage trading card lots, import photos, and export to eBay',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <UserProvider>
          <SignInGate>
            <div className="min-h-screen flex flex-col">
              {children}
            </div>
          </SignInGate>
        </UserProvider>
      </body>
    </html>
  );
}
