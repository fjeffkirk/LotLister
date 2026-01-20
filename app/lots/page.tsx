'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { LotWithCount } from '../../lib/types';
import { useUser } from '../../components/UserProvider';

interface StorageInfo {
  usedMB: number;
  maxGB: number;
  percentUsed: number;
}

// Calculate days remaining before auto-delete
function getDaysRemaining(completedAt: string | Date | null): number {
  if (!completedAt) return 10;
  const completed = new Date(completedAt);
  const deleteDate = new Date(completed);
  deleteDate.setDate(deleteDate.getDate() + 10);
  const now = new Date();
  const diff = deleteDate.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export default function LotsPage() {
  const { userEmail, isLoading: userLoading } = useUser();
  const [lots, setLots] = useState<LotWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newLotName, setNewLotName] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);

  useEffect(() => {
    // Only fetch lots when we have a user email
    if (userEmail) {
      fetchLots();
      fetchStorage();
    } else if (!userLoading) {
      // Not loading and no email means modal is showing
      setLoading(false);
    }
  }, [userEmail, userLoading]);

  async function fetchLots() {
    try {
      const res = await fetch('/api/lots');
      const data = await res.json();
      if (data.success) {
        setLots(data.data);
      } else if (data.error === 'User email not set') {
        // Email cookie might have been cleared, will show modal
        setLots([]);
      }
    } catch (err) {
      setError('Failed to load lots');
    } finally {
      setLoading(false);
    }
  }

  async function fetchStorage() {
    try {
      const res = await fetch('/api/storage');
      const data = await res.json();
      if (data.success) {
        setStorage(data.data);
      }
    } catch (err) {
      // Silently fail - storage indicator is optional
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
          lot.id === id ? { ...lot, completed: !currentStatus } : lot
        ));
      } else {
        setError(data.error || 'Failed to update lot');
      }
    } catch (err) {
      setError('Failed to update lot');
    }
  }

  // Separate lots into in-progress and completed
  const inProgressLots = lots.filter(lot => !lot.completed);
  const completedLots = lots.filter(lot => lot.completed);

  // Don't render anything while checking for user
  if (userLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-950 via-surface-900 to-surface-950 flex items-center justify-center">
        <div className="spinner w-8 h-8"></div>
      </div>
    );
  }

  // If no email, the EmailModal will show - render minimal UI
  if (!userEmail) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-950 via-surface-900 to-surface-950">
        {/* Empty state - modal will overlay */}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-950 via-surface-900 to-surface-950">
      {/* Header */}
      <header className="border-b border-surface-800 bg-surface-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-700 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-primary-400 to-primary-200 bg-clip-text text-transparent">
              LotLister
            </h1>
          </div>
          <div className="flex items-center gap-4">
            {/* Storage Indicator */}
            {storage && (
              <div className="flex items-center gap-2 text-sm" title={`${storage.usedMB} MB of ${storage.maxGB} GB used`}>
                <svg className="w-4 h-4 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                </svg>
                <div className="flex items-center gap-1.5">
                  <div className="w-20 h-2 bg-surface-700 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all ${
                        storage.percentUsed > 90 ? 'bg-red-500' : 
                        storage.percentUsed > 70 ? 'bg-yellow-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${storage.percentUsed}%` }}
                    />
                  </div>
                  <span className={`text-xs ${
                    storage.percentUsed > 90 ? 'text-red-400' : 
                    storage.percentUsed > 70 ? 'text-yellow-400' : 'text-surface-400'
                  }`}>
                    {storage.percentUsed}%
                  </span>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 text-sm text-surface-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="max-w-[200px] truncate">{userEmail}</span>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn btn-primary"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Lot
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-300">
            {error}
            <button onClick={() => setError(null)} className="ml-4 text-red-400 hover:text-red-300">
              ✕
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="spinner w-8 h-8"></div>
          </div>
        ) : lots.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 mx-auto mb-6 bg-surface-800 rounded-full flex items-center justify-center">
              <svg className="w-10 h-10 text-surface-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-surface-200 mb-2">No lots yet</h2>
            <p className="text-surface-400 mb-6">Create your first lot to get started</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn btn-primary"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Lot
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            {/* In Progress Section */}
            <section>
              <h2 className="text-lg font-semibold text-surface-200 mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                In Progress ({inProgressLots.length})
              </h2>
              {inProgressLots.length === 0 ? (
                <div className="panel p-6 text-center text-surface-400">
                  No lots in progress. Create a new lot or move one from completed.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {inProgressLots.map((lot, index) => (
                    <div
                      key={lot.id}
                      className="panel p-5 hover:border-surface-600 transition-all duration-200 group animate-slide-up"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-lg text-surface-100 truncate group-hover:text-primary-400 transition-colors">
                            {lot.name}
                          </h3>
                          <p className="text-sm text-surface-400">
                            {lot._count.cardItems} {lot._count.cardItems === 1 ? 'card' : 'cards'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => toggleComplete(lot.id, lot.completed || false)}
                            className="btn-ghost p-2 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Mark as completed"
                          >
                            <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => deleteLot(lot.id)}
                            className="btn-ghost p-2 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Delete lot"
                          >
                            <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs text-surface-500">
                        <span>Created {new Date(lot.createdAt).toLocaleDateString()}</span>
                        <Link
                          href={`/lots/${lot.id}`}
                          className="btn btn-secondary text-sm py-1.5"
                        >
                          Open
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Completed Section */}
            {completedLots.length > 0 && (
              <section>
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-surface-200 flex items-center gap-2">
                    <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Completed ({completedLots.length})
                  </h2>
                  <p className="text-xs text-surface-500 mt-1 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Completed lots are automatically deleted after 10 days to free up storage
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {completedLots.map((lot, index) => (
                    <div
                      key={lot.id}
                      className="panel p-5 hover:border-surface-600 transition-all duration-200 group animate-slide-up opacity-75"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-lg text-surface-100 truncate group-hover:text-primary-400 transition-colors flex items-center gap-2">
                            <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            {lot.name}
                          </h3>
                          <p className="text-sm text-surface-400">
                            {lot._count.cardItems} {lot._count.cardItems === 1 ? 'card' : 'cards'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => toggleComplete(lot.id, lot.completed || false)}
                            className="btn-ghost p-2 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Move back to in progress"
                          >
                            <svg className="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => deleteLot(lot.id)}
                            className="btn-ghost p-2 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Delete lot"
                          >
                            <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className={`${getDaysRemaining((lot as Record<string, unknown>).completedAt as string | null) <= 3 ? 'text-red-400' : 'text-surface-500'}`}>
                          Auto-deletes in {getDaysRemaining((lot as Record<string, unknown>).completedAt as string | null)} days
                        </span>
                        <Link
                          href={`/lots/${lot.id}`}
                          className="btn btn-secondary text-sm py-1.5"
                        >
                          Open
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {/* Create Lot Modal */}
      {showCreateModal && (
        <div className="modal-overlay animate-fade-in" onClick={() => setShowCreateModal(false)}>
          <div
            className="modal-content w-full max-w-md p-6 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-semibold mb-4">Create New Lot</h2>
            <form onSubmit={createLot}>
              <input
                type="text"
                value={newLotName}
                onChange={(e) => setNewLotName(e.target.value)}
                placeholder="Lot name (e.g., 2024 Topps Baseball)"
                className="w-full mb-4"
                autoFocus
              />
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newLotName.trim() || creating}
                  className="btn btn-primary"
                >
                  {creating ? (
                    <>
                      <div className="spinner"></div>
                      Creating...
                    </>
                  ) : (
                    'Create Lot'
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
