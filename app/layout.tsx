import type { Metadata } from 'next';
import './globals.css';

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
        <div className="min-h-screen flex flex-col">
          {children}
        </div>
      </body>
    </html>
  );
}
