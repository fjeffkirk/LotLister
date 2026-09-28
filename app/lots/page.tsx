'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { LotWithCount } from '../../lib/types';
import { COMPLETED_DELETE_DAYS, lotDeletesAt, MAX_LOT_AGE_DAYS } from '../../lib/card-fields';
import { AppHeader } from '../../components/ui/AppHeader';
import { EbayOverview } from '../../components/dashboard/EbayOverview';
import {
  CheckCircleIcon,
  ClockIcon,
  ImageIcon,
  LayersIcon,
  PlusIcon,
  RotateIcon,
  TagIcon,
  TrashIcon,
  BoltIcon,
  CloseIcon,
} from '../../components/ui/icons';

const DELETE_WARNING_DAYS = 7;

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function daysUntilDeleted(lot: LotWithCount): number {
  const completedAt = (lot as { completedAt?: string | Date | null }).completedAt ?? null;
  const deletesAt = lotDeletesAt({
    createdAt: lot.createdAt,
    completed: Boolean(lot.completed),
    completedAt: lot.completed ? completedAt ?? new Date() : null,
  });
  return Math.max(0, Math.ceil((deletesAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
}

function deletesInLabel(days: number): string {
  if (days === 0) return 'Deletes today';
  return `Deletes in ${days}d`;
}

export default function LotsPage() {
  const [lots, setLots] = useState<LotWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newLotName, setNewLotName] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchLots();
    if (new URLSearchParams(window.location.search).get('new') === '1') {
      setShowCreateModal(true);
      window.history.replaceState({}, '', '/lots');
    }
  }, []);

  async function fetchLots() {
    try {
      const res = await fetch('/api/lots');
      const data = await res.json();
      if (data.success) {
        setLots(data.data);
      } else {
        setLots([]);
      }
    } catch (err) {
      setError('Failed to load lots');
    } finally {
      setLoading(false);
    }
  }

  async function createLot(e: React.FormEvent) {
    e.preventDefault();
    if (!newLotName.trim()) return;

    setCreating(true);
    setError(null);

    try {
      const res = await fetch('/api/lots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newLotName.trim() }),
      });
      const data = await res.json();

      if (data.success) {
        setLots((prev) => [data.data, ...prev]);
        setNewLotName('');
        setShowCreateModal(false);
      } else {
        setError(data.error || 'Failed to create lot');
      }
    } catch (err) {
      setError('Failed to create lot');
    } finally {
      setCreating(false);
    }
  }

  async function deleteLot(id: string) {
    if (!confirm('Are you sure you want to delete this lot? All cards and images will be permanently removed.')) {
      return;
    }

    try {
      const res = await fetch(`/api/lots/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();

      if (data.success) {
        setLots((prev) => prev.filter((lot) => lot.id !== id));
      } else {
        setError(data.error || 'Failed to delete lot');
      }
    } catch (err) {
      setError('Failed to delete lot');
    }
  }

  async function toggleComplete(id: string, currentStatus: boolean) {
    try {
      const res = await fetch(`/api/lots/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !currentStatus }),
      });
      const data = await res.json();

      if (data.success) {
        setLots((prev) => prev.map((lot) =>
          lot.id === id ? { ...lot, completed: !currentStatus, completedAt: currentStatus ? null : new Date() } : lot
        ));
      } else {
        setError(data.error || 'Failed to update lot');
      }
    } catch (err) {
      setError('Failed to update lot');
    }
  }

  const inProgressLots = lots.filter(lot => !lot.completed);
  const completedLots = lots.filter(lot => lot.completed);

  const stats = useMemo(() => {
    let cards = 0;
    let ready = 0;
    let listed = 0;
    let value = 0;
    for (const lot of inProgressLots) {
      cards += lot._count.cardItems;
      ready += lot.summary?.readyCount ?? 0;
      listed += lot.summary?.listedCount ?? 0;
      value += lot.summary?.totalValue ?? 0;
    }
    return { cards, ready, listed, value };
  }, [inProgressLots]);

  return (
    <div className="min-h-screen">
      <AppHeader
        actions={
          <button onClick={() => setShowCreateModal(true)} className="btn btn-primary px-3 sm:px-4" aria-label="New lot">
            <PlusIcon size={16} strokeWidth={2.25} />
            <span className="hidden sm:inline">New lot</span>
          </button>
        }
      />

      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {error && (
          <div className="mb-6 flex items-center justify-between gap-4 p-3.5 bg-red-500/10 border border-red-500/30 rounded-xl text-red-200 text-sm animate-slide-up">
            {error}
            <button onClick={() => setError(null)} className="text-red-300 hover:text-red-100" aria-label="Dismiss">
              <CloseIcon />
            </button>
          </div>
        )}

        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-surface-400">How your eBay store is doing, and the lots you are working on.</p>
        </div>

        <EbayOverview />

        <div className="mt-12 mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-t border-white/[0.06] pt-8">
          <div>
            <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">Your lots</h2>
            <p className="mt-1 text-sm text-surface-400">Photograph, fill in, and list whole lots of cards at once.</p>
          </div>
          {!loading && lots.length > 0 && (
            <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <LotStat icon={<LayersIcon size={14} />} label="active lots" value={String(inProgressLots.length)} />
              <LotStat icon={<ImageIcon size={14} />} label="cards in progress" value={String(stats.cards)} />
              <LotStat icon={<BoltIcon size={14} className="text-emerald-300" />} label="ready to list" value={String(stats.ready)} />
              <LotStat icon={<TagIcon size={14} className="text-primary-300" />} label="asking" value={currency.format(stats.value)} />
            </dl>
          )}
        </div>

        {loading ? (
          <DashboardSkeleton />
        ) : lots.length === 0 ? (
          <EmptyState onCreate={() => setShowCreateModal(true)} />
        ) : (
          <div className="space-y-12">
            <section>
              <SectionHeader
                icon={<ClockIcon size={16} className="text-amber-300" />}
                title="In progress"
                count={inProgressLots.length}
                note={`Lots delete automatically ${MAX_LOT_AGE_DAYS} days after they're created`}
              />
              {inProgressLots.length === 0 ? (
                <div className="panel p-8 text-center text-sm text-surface-400">
                  Nothing in progress. Start a new lot or reopen a completed one.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
                  {inProgressLots.map((lot, index) => (
                    <LotCard
                      key={lot.id}
                      lot={lot}
                      index={index}
                      onToggleComplete={() => toggleComplete(lot.id, false)}
                      onDelete={() => deleteLot(lot.id)}
                    />
                  ))}
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="hidden sm:flex min-h-[18rem] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-white/[0.08] text-surface-400 hover:text-white hover:border-primary-500/40 hover:bg-primary-500/[0.04] transition-all"
                  >
                    <span className="w-11 h-11 rounded-full bg-white/[0.05] flex items-center justify-center">
                      <PlusIcon size={20} />
                    </span>
                    <span className="text-sm font-medium">New lot</span>
                  </button>
                </div>
              )}
            </section>

            {completedLots.length > 0 && (
              <section>
                <SectionHeader
                  icon={<CheckCircleIcon size={16} className="text-emerald-300" />}
                  title="Completed"
                  count={completedLots.length}
                  note={`Completed lots delete automatically after ${COMPLETED_DELETE_DAYS} days to free up storage`}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
                  {completedLots.map((lot, index) => (
                    <LotCard
                      key={lot.id}
                      lot={lot}
                      index={index}
                      onToggleComplete={() => toggleComplete(lot.id, true)}
                      onDelete={() => deleteLot(lot.id)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div
            className="modal-content w-full max-w-md mx-4 sm:mx-auto p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-5">
              <span className="w-10 h-10 rounded-xl bg-primary-500/15 text-primary-300 flex items-center justify-center">
                <LayersIcon size={20} />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-white">New lot</h2>
                <p className="text-xs text-surface-400">A lot is a batch of cards you list together.</p>
              </div>
            </div>
            <form onSubmit={createLot}>
              <label className="block text-xs font-medium text-surface-300 mb-1.5" htmlFor="lot-name">Lot name</label>
              <input
                id="lot-name"
                type="text"
                value={newLotName}
                onChange={(e) => setNewLotName(e.target.value)}
                placeholder="e.g. 2024 Topps Series 1 break"
                className="w-full mb-5"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn btn-ghost">
                  Cancel
                </button>
                <button type="submit" disabled={!newLotName.trim() || creating} className="btn btn-primary">
                  {creating ? (
                    <>
                      <div className="spinner w-4 h-4"></div>
                      Creating…
                    </>
                  ) : (
                    'Create lot'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function LotStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-surface-400">
      <span className="text-surface-400">{icon}</span>
      <dd className="font-semibold text-white tabular-nums">{value}</dd>
      <dt>{label}</dt>
    </div>
  );
}

function SectionHeader({ icon, title, count, note }: { icon: React.ReactNode; title: string; count: number; note: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 mb-4">
      <h2 className="flex items-center gap-2 text-base font-semibold text-white">
        {icon}
        {title}
        <span className="chip chip-neutral">{count}</span>
      </h2>
      <p className="text-xs text-surface-500">{note}</p>
    </div>
  );
}

function Mosaic({ thumbnails }: { thumbnails: string[] }) {
  if (thumbnails.length === 0) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-surface-500 bg-[radial-gradient(circle_at_30%_20%,rgba(74,118,251,0.14),transparent_60%),radial-gradient(circle_at_80%_90%,rgba(154,102,255,0.12),transparent_55%)]">
        <ImageIcon size={26} />
        <span className="text-xs">No photos yet</span>
      </div>
    );
  }
  const layout =
    thumbnails.length === 1 ? 'grid-cols-1' : thumbnails.length === 2 ? 'grid-cols-2' : 'grid-cols-2 grid-rows-2';
  return (
    <div className={`absolute inset-0 grid gap-0.5 ${layout}`}>
      {thumbnails.map((src, i) => (
        <div key={src + i} className={`relative overflow-hidden bg-surface-800 ${thumbnails.length === 3 && i === 0 ? 'row-span-2' : ''}`}>
          <img src={src} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
        </div>
      ))}
    </div>
  );
}

function LotCard({
  lot,
  index,
  onToggleComplete,
  onDelete,
}: {
  lot: LotWithCount;
  index: number;
  onToggleComplete: () => void;
  onDelete: () => void;
}) {
  const total = lot._count.cardItems;
  const summary = lot.summary ?? { readyCount: 0, listedCount: 0, totalValue: 0, thumbnails: [] };
  const done = summary.readyCount + summary.listedCount;
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  const days = daysUntilDeleted(lot);
  const warn = lot.completed || days <= DELETE_WARNING_DAYS;
  const completed = Boolean(lot.completed);

  return (
    <div
      className={`group relative panel overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift animate-slide-up ${completed ? 'opacity-80 hover:opacity-100' : ''}`}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <Link href={`/lots/${lot.id}`} className="absolute inset-0 z-[1]" aria-label={`Open ${lot.name}`} />

      <div className="relative h-40 bg-surface-850 overflow-hidden">
        <Mosaic thumbnails={summary.thumbnails} />
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface-900/90 to-transparent pointer-events-none" />
        <div className="absolute top-3 left-3 flex gap-1.5">
          {completed ? (
            <span className="chip chip-ready backdrop-blur-md"><CheckCircleIcon size={12} /> Completed</span>
          ) : total > 0 && done === total ? (
            <span className="chip chip-ready backdrop-blur-md"><BoltIcon size={12} /> All ready</span>
          ) : null}
        </div>
        <div className="absolute top-2.5 right-2.5 z-[2] flex gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            onClick={onToggleComplete}
            className="w-8 h-8 rounded-lg bg-black/55 backdrop-blur-md text-surface-100 hover:text-emerald-300 flex items-center justify-center"
            title={completed ? 'Move back to in progress' : `Mark completed. Completed lots delete automatically after ${COMPLETED_DELETE_DAYS} days.`}
          >
            {completed ? <RotateIcon size={15} /> : <CheckCircleIcon size={15} />}
          </button>
          <button
            onClick={onDelete}
            className="w-8 h-8 rounded-lg bg-black/55 backdrop-blur-md text-surface-100 hover:text-red-300 flex items-center justify-center"
            title="Delete lot"
          >
            <TrashIcon size={15} />
          </button>
        </div>
      </div>

      <div className="p-4 pt-3">
        <h3 className="font-semibold text-[15px] text-white truncate group-hover:text-primary-100 transition-colors" title={lot.name}>
          {lot.name}
        </h3>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-surface-400">
          <span>{total} {total === 1 ? 'card' : 'cards'}</span>
          {summary.totalValue > 0 && (
            <>
              <span className="text-surface-600">•</span>
              <span className="tabular-nums">{currency.format(summary.totalValue)}</span>
            </>
          )}
        </div>

        <div className="mt-3.5">
          <div className="flex h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div className="h-full bg-primary-500 transition-all duration-700" style={{ width: `${pct(summary.listedCount)}%` }} />
            <div className="h-full bg-emerald-400 transition-all duration-700" style={{ width: `${pct(summary.readyCount)}%` }} />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="text-surface-400">
              {total === 0
                ? 'Add cards to get started'
                : summary.listedCount > 0
                  ? `${summary.listedCount} listed · ${summary.readyCount} ready`
                  : `${summary.readyCount} of ${total} ready`}
            </span>
            {warn ? (
              <span className={`chip ${days <= 3 ? 'chip-danger' : 'chip-warn'}`}>
                <ClockIcon size={11} /> {deletesInLabel(days)}
              </span>
            ) : (
              <span className="text-surface-500">{new Date(lot.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="panel overflow-hidden">
            <div className="skeleton h-40 rounded-none" />
            <div className="p-4 space-y-3">
              <div className="skeleton h-4 w-3/4" />
              <div className="skeleton h-3 w-1/3" />
              <div className="skeleton h-1.5 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="panel relative overflow-hidden px-6 py-16 sm:py-20 text-center">
      <div className="absolute inset-0 bg-[radial-gradient(600px_300px_at_50%_0%,rgba(74,118,251,0.16),transparent_70%)] pointer-events-none" />
      <div className="relative">
        <div className="mx-auto mb-6 w-16 h-16 rounded-2xl bg-primary-500/15 text-primary-300 flex items-center justify-center shadow-glow animate-float">
          <LayersIcon size={30} />
        </div>
        <h2 className="text-xl font-semibold text-white">Start your first lot</h2>
        <p className="mt-2 text-sm text-surface-400 max-w-sm mx-auto">
          Drop in photos or PSA cert numbers, fill in the details in a spreadsheet-style grid, then list everything on eBay in one go.
        </p>
        <button onClick={onCreate} className="btn btn-primary mt-7 px-5 py-2.5">
          <PlusIcon size={16} strokeWidth={2.25} /> Create a lot
        </button>
      </div>
    </div>
  );
}
