import Link from 'next/link';
import { AppHeader } from '../../../components/ui/AppHeader';
import { prisma } from '../../../lib/db';
import { listLowStockItems } from '../../../lib/queries/ops';
import { shopifyAdminUrl } from '../../../lib/shopify/admin-url';
import { getAppSettings } from '../../../lib/queries/app-settings';

export const dynamic = 'force-dynamic';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default async function InventoryPage() {
  const [rows, settings] = await Promise.all([
    prisma ? listLowStockItems(prisma) : Promise.resolve([]),
    getAppSettings(),
  ]);
  const shop = settings?.shopifyShopDomain ?? null;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">Low stock</h1>
          <p className="mt-1 text-sm text-surface-400">Shopify products at or below their reorder threshold.</p>
        </div>
        {rows.length === 0 ? (
          <div className="panel p-10 text-center text-sm text-surface-500">Nothing is below reorder right now.</div>
        ) : (
          <div className="panel overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-surface-500 border-b border-white/[0.06]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Product</th>
                  <th className="px-4 py-2.5 font-medium">SKU</th>
                  <th className="px-4 py-2.5 font-medium text-right">On hand</th>
                  <th className="px-4 py-2.5 font-medium text-right">Reorder at</th>
                  <th className="px-4 py-2.5 font-medium text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const href = shopifyAdminUrl(shop, 'products', row.shopifyProductId);
                  return (
                    <tr key={row.id} className="border-t border-white/[0.04]">
                      <td className="px-4 py-3">
                        {href ? (
                          <a href={href} target="_blank" rel="noreferrer" className="text-white hover:text-primary-200">
                            {row.title}
                          </a>
                        ) : (
                          <span className="text-white">{row.title}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-surface-400 font-mono text-xs">{row.sku || '—'}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${row.available <= 0 ? 'text-red-300' : 'text-white'}`}>
                        {row.available}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-surface-300">{row.threshold}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-surface-300">
                        {row.costBasis != null ? money.format(row.costBasis) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-6 text-xs text-surface-500">
          <Link href="/lots" className="text-primary-300 hover:text-white">Back to dashboard</Link>
          {' · '}
          <Link href="/settings#shopify" className="text-primary-300 hover:text-white">Shopify settings</Link>
        </p>
      </main>
    </div>
  );
}
