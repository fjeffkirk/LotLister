import Link from 'next/link';
import { AppHeader } from '../../../components/ui/AppHeader';
import { prisma } from '../../../lib/db';
import { listOpenFulfillment } from '../../../lib/queries/ops';
import { shopifyAdminUrl } from '../../../lib/shopify/admin-url';
import { getAppSettings } from '../../../lib/queries/app-settings';

export const dynamic = 'force-dynamic';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default async function OrdersPage() {
  const [rows, settings] = await Promise.all([
    prisma ? listOpenFulfillment(prisma) : Promise.resolve([]),
    getAppSettings(),
  ]);
  const overdue = rows.filter((row) => row.overdue);
  const open = rows.filter((row) => !row.overdue);
  const shop = settings?.shopifyShopDomain ?? null;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">Orders to ship</h1>
          <p className="mt-1 text-sm text-surface-400">Unfulfilled Shopify orders. eBay packing still lives in Seller Hub.</p>
        </div>
        {rows.length === 0 ? (
          <div className="panel p-10 text-center text-sm text-surface-500">Nothing waiting to ship on Shopify.</div>
        ) : (
          <div className="space-y-8">
            {overdue.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-red-300 mb-3">Past fulfill-by · {overdue.length}</h2>
                <OrderTable rows={overdue} shop={shop} />
              </section>
            )}
            <section>
              <h2 className="text-sm font-semibold text-white mb-3">Open · {open.length}</h2>
              {open.length === 0 ? (
                <div className="panel p-6 text-sm text-surface-500">No open orders still inside the SLA.</div>
              ) : (
                <OrderTable rows={open} shop={shop} />
              )}
            </section>
          </div>
        )}
        <p className="mt-6 text-xs text-surface-500">
          Need eBay shipments?{' '}
          <a href="https://www.ebay.com/sh/ord/?filter=status:AWAITING_SHIPMENT" className="text-primary-300 hover:text-white" target="_blank" rel="noreferrer">
            Open Seller Hub
          </a>
          {' · '}
          <Link href="/lots" className="text-primary-300 hover:text-white">Back to dashboard</Link>
        </p>
      </main>
    </div>
  );
}

function OrderTable({
  rows,
  shop,
}: {
  rows: Awaited<ReturnType<typeof listOpenFulfillment>>;
  shop: string | null;
}) {
  return (
    <div className="panel overflow-hidden">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-surface-500 border-b border-white/[0.06]">
          <tr>
            <th className="px-4 py-2.5 font-medium">Order</th>
            <th className="px-4 py-2.5 font-medium">Customer</th>
            <th className="px-4 py-2.5 font-medium">Fulfill by</th>
            <th className="px-4 py-2.5 font-medium text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = shopifyAdminUrl(shop, 'orders', row.shopifyOrderId);
            return (
              <tr key={row.id} className="border-t border-white/[0.04]">
                <td className="px-4 py-3">
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer" className="text-white hover:text-primary-200">
                      {row.orderName || row.shopifyOrderId}
                    </a>
                  ) : (
                    <span className="text-white">{row.orderName || row.shopifyOrderId}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-surface-300">{row.customerName || '—'}</td>
                <td className={`px-4 py-3 ${row.overdue ? 'text-red-300' : 'text-surface-300'}`}>
                  {row.fulfillBy ? row.fulfillBy.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-white">{money.format(row.total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
