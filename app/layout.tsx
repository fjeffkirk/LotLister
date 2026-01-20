import type { Metadata } from 'next';
import './globals.css';
import { UserProvider } from '../components/UserProvider';
import { EmailModal } from '../components/EmailModal';

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
          <EmailModal />
          <div className="min-h-screen flex flex-col">
            {children}
          </div>
        </UserProvider>
      </body>
    </html>
  );
}
