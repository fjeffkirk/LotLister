export const DASHBOARD_RANGES = [7, 30, 90] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export type DashboardSection<T> =
  | { status: 'ok'; data: T }
  | { status: 'reconnect'; message: string }
  | { status: 'error'; message: string };

export interface SalesSummary {
  /** Item + shipping, before tax — the amount eBay charges final value fees on. */
  gross: number;
  /** gross minus eBay marketplace fees and refunds. */
  net: number;
  fees: number;
  refunds: number;
  orders: number;
  units: number;
  avgItemPrice: number;
  /** Gross per local calendar day, oldest first. */
  daily: number[];
}

export interface PlayerStat {
  name: string;
  units: number;
  revenue: number;
}

export interface RangeStats {
  summary: SalesSummary;
  players: PlayerStat[];
  unidentifiedUnits: number;
}

export interface RecentSale {
  itemId: string | null;
  title: string;
  price: number;
  quantity: number;
  soldAt: string;
  player: string | null;
}

export interface SalesData {
  ranges: Record<`${DashboardRange}`, RangeStats>;
  recent: RecentSale[];
  /** Sold listings whose player name has not been looked up yet (picked up on a later load). */
  pendingLookups: number;
}

export interface ShippingData {
  orders: number;
  units: number;
  overdue: number;
  nextShipBy: string | null;
}

export interface ListingsData {
  count: number;
  value: number;
  watchers: number;
  scheduled: number;
}

export interface DashboardData {
  state: 'ok' | 'not_configured' | 'not_connected';
  account: string | null;
  fetchedAt: string;
  sales: DashboardSection<SalesData>;
  shipping: DashboardSection<ShippingData>;
  listings: DashboardSection<ListingsData>;
}
