'use client';

import { useState, useEffect } from 'react';
import { ExportProfile } from '@prisma/client';
import {
  LISTING_TYPE_OPTIONS,
  SCHEDULE_MODE_OPTIONS,
  DURATION_OPTIONS,
  RETURN_WINDOW_OPTIONS,
  SHIPPING_SERVICE_OPTIONS,
} from '../lib/types';

interface ExportSettingsModalProps {
  lotId: string;
  isOpen: boolean;
  onClose: () => void;
  onExport?: () => void; // If provided, shows export button (export mode)
  isExporting?: boolean;
}

const DEFAULT_PROFILE: Partial<ExportProfile> = {
  templateName: '7 Day Auction',
  ebayCategory: '261328',
  storeCategory: '0',
  listingType: 'Auction',
  startPriceDefault: 4.99,
  buyItNowPrice: null,
  durationDays: 7,
  scheduleMode: 'Scheduled',
  scheduleDate: null,
  scheduleTime: null,
  staggerEnabled: true,
  staggerIntervalSeconds: 15,
  shippingService: 'USPS Ground Advantage',
  handlingTimeDays: 3,
  freeShipping: false,
  shippingCost: 3.99,
  eachAdditionalItemCost: 1.49,
  immediatePayment: false,
  itemLocationCity: '',
  itemLocationState: '',
  itemLocationZip: '',
  returnsAccepted: true,
  returnWindowDays: 14,
  refundMethod: 'Money Back',
  shippingCostPaidBy: 'Seller',
  salesTaxEnabled: false,
};

export default function ExportSettingsModal({
  lotId,
  isOpen,
  onClose,
  onExport,
  isExporting = false,
}: ExportSettingsModalProps) {
  const isExportMode = !!onExport;
  const [profile, setProfile] = useState<Partial<ExportProfile>>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchProfile();
    }
  }, [isOpen, lotId]);

  async function fetchProfile() {
    setLoading(true);
    try {
      const res = await fetch(`/api/lots/${lotId}/export-profile`);
      const data = await res.json();
      if (data.success && data.data) {
        setProfile({ ...DEFAULT_PROFILE, ...data.data });
      } else {
        setProfile(DEFAULT_PROFILE);
      }
    } catch (err) {
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(closeAfter = true) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/lots/${lotId}/export-profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const data = await res.json();
      if (data.success) {
        if (closeAfter && !isExportMode) {
          onClose();
        }
        return true;
      } else {
        setError(data.error || 'Failed to save settings');
        return false;
      }
    } catch (err) {
      setError('Failed to save settings');
      return false;
    } finally {
      setSaving(false);
    }
  }
  
  // Validate all required fields for export
  function validateForExport(): string[] {
    const errors: string[] = [];
    
    if (!profile.templateName?.trim()) errors.push('Template Name');
    if (!profile.ebayCategory?.trim()) errors.push('eBay Category');
    if (!profile.listingType) errors.push('Listing Type');
    if (profile.startPriceDefault === null || profile.startPriceDefault === undefined) errors.push('Start Price');
    if (!profile.durationDays) errors.push('Duration');
    if (profile.storeCategory === null || profile.storeCategory === undefined || profile.storeCategory === '') errors.push('Store Category');
    
    // Schedule validation
    if (profile.scheduleMode === 'Scheduled') {
      if (!profile.scheduleDate) errors.push('Schedule Date');
      if (!profile.scheduleTime) errors.push('Schedule Time');
    }
    
    // Shipping validation
    if (!profile.shippingService) errors.push('Shipping Service');
    if (profile.handlingTimeDays === null || profile.handlingTimeDays === undefined) errors.push('Handling Time');
    if (!profile.freeShipping && (profile.shippingCost === null || profile.shippingCost === undefined)) {
      errors.push('Shipping Cost');
    }
    
    // Location validation
    if (!profile.itemLocationCity?.trim()) errors.push('City');
    if (!profile.itemLocationState?.trim()) errors.push('State');
    if (!profile.itemLocationZip?.trim()) errors.push('ZIP Code');
    
    return errors;
  }

  async function handleExport() {
    // Validate before export
    const validationErrors = validateForExport();
    if (validationErrors.length > 0) {
      setError(`Missing required fields: ${validationErrors.join(', ')}`);
      return;
    }
    
    const saved = await handleSave(false);
    if (saved && onExport) {
      onExport();
    }
  }

  const updateField = <K extends keyof ExportProfile>(
    field: K,
    value: ExportProfile[K]
  ) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div
        className="modal-content w-full max-w-3xl mx-4 sm:mx-auto animate-slide-up max-h-[90vh] sm:max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-surface-700 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-semibold truncate">
              {isExportMode ? 'eBay File Exchange Export' : 'Export Settings'}
            </h2>
            {isExportMode && (
              <p className="text-xs sm:text-sm text-surface-400 mt-1">
                Review your settings before exporting
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="btn-ghost p-2 rounded-lg flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 sm:space-y-6 flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="spinner w-8 h-8"></div>
            </div>
          ) : (
            <>
              {error && (
                <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
                  {error}
                </div>
              )}

              {/* Template Name */}
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-2">
                  Template Name
                </label>
                <input
                  type="text"
                  value={profile.templateName || ''}
                  onChange={(e) => updateField('templateName', e.target.value)}
                  className="w-full"
                />
              </div>

              {/* Listing Type & Category */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-2">
                    Listing Type
                  </label>
                  <select
                    value={profile.listingType || 'Auction'}
                    onChange={(e) => updateField('listingType', e.target.value)}
                    className="w-full"
                  >
                    {LISTING_TYPE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt === 'BuyItNow' ? 'Buy It Now' : opt}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-2">
                    eBay Category
                  </label>
                  <input
                    type="text"
                    value={profile.ebayCategory || ''}
                    onChange={(e) => updateField('ebayCategory', e.target.value)}
                    className="w-full"
                    placeholder="261328"
                  />
                </div>
              </div>

              {/* Pricing */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-2">
                    Start Price ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={profile.startPriceDefault || ''}
                    onChange={(e) => updateField('startPriceDefault', parseFloat(e.target.value) || 0)}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-2">
                    Duration (days)
                  </label>
                  <select
                    value={profile.durationDays || 7}
                    onChange={(e) => updateField('durationDays', parseInt(e.target.value))}
                    className="w-full"
                  >
                    {DURATION_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt} days
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-2">
                    Store Category
                  </label>
                  <input
                    type="text"
                    value={profile.storeCategory || ''}
                    onChange={(e) => updateField('storeCategory', e.target.value)}
                    className="w-full"
                    placeholder="0"
                  />
                </div>
              </div>

              {/* Schedule */}
              <div className="p-4 bg-surface-800/50 rounded-lg space-y-4">
                <h3 className="font-medium text-surface-200">Schedule</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Schedule Mode
                    </label>
                    <select
                      value={profile.scheduleMode || 'Scheduled'}
                      onChange={(e) => updateField('scheduleMode', e.target.value)}
                      className="w-full"
                    >
                      {SCHEDULE_MODE_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                  {profile.scheduleMode === 'Scheduled' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-surface-300 mb-2">
                          Schedule Date
                        </label>
                        <input
                          type="date"
                          value={profile.scheduleDate || ''}
                          onChange={(e) => updateField('scheduleDate', e.target.value)}
                          className="w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-surface-300 mb-2">
                          Schedule Time
                        </label>
                        <input
                          type="time"
                          value={profile.scheduleTime || ''}
                          onChange={(e) => updateField('scheduleTime', e.target.value)}
                          className="w-full"
                        />
                        {profile.scheduleDate && profile.scheduleTime && (
                          <p className="mt-1 text-xs text-surface-400">
                            eBay will see: {(() => {
                              try {
                                const localDate = new Date(`${profile.scheduleDate}T${profile.scheduleTime}:00`);
                                return localDate.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
                              } catch {
                                return 'Invalid date/time';
                              }
                            })()}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={profile.staggerEnabled ?? true}
                            onChange={(e) => updateField('staggerEnabled', e.target.checked)}
                            className="w-4 h-4 rounded border-surface-600"
                          />
                          <span className="text-sm text-surface-300">Enable stagger</span>
                        </label>
                        {profile.staggerEnabled && (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={profile.staggerIntervalSeconds || 15}
                              onChange={(e) => updateField('staggerIntervalSeconds', parseInt(e.target.value) || 15)}
                              className="w-20"
                              min={0}
                              max={3600}
                            />
                            <span className="text-sm text-surface-400">seconds</span>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Shipping */}
              <div className="p-4 bg-surface-800/50 rounded-lg space-y-4">
                <h3 className="font-medium text-surface-200">Shipping</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Shipping Service
                    </label>
                    <select
                      value={profile.shippingService || 'USPS Ground Advantage'}
                      onChange={(e) => updateField('shippingService', e.target.value)}
                      className="w-full"
                    >
                      {SHIPPING_SERVICE_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Handling Time (days)
                    </label>
                    <input
                      type="number"
                      value={profile.handlingTimeDays || 3}
                      onChange={(e) => updateField('handlingTimeDays', parseInt(e.target.value) || 3)}
                      className="w-full"
                      min={0}
                      max={30}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={profile.freeShipping ?? false}
                      onChange={(e) => updateField('freeShipping', e.target.checked)}
                      className="w-4 h-4 rounded border-surface-600"
                    />
                    <span className="text-sm text-surface-300">Free Shipping</span>
                  </label>
                  {!profile.freeShipping && (
                    <>
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-surface-300">Cost: $</label>
                        <input
                          type="number"
                          step="0.01"
                          value={profile.shippingCost || 3.99}
                          onChange={(e) => updateField('shippingCost', parseFloat(e.target.value) || 0)}
                          className="w-24"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-surface-300">Each add'l: $</label>
                        <input
                          type="number"
                          step="0.01"
                          value={profile.eachAdditionalItemCost || 1.49}
                          onChange={(e) => updateField('eachAdditionalItemCost', parseFloat(e.target.value) || 0)}
                          className="w-24"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Location */}
              <div className="p-4 bg-surface-800/50 rounded-lg space-y-4">
                <h3 className="font-medium text-surface-200">Item Location</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      City
                    </label>
                    <input
                      type="text"
                      value={profile.itemLocationCity || ''}
                      onChange={(e) => updateField('itemLocationCity', e.target.value)}
                      className="w-full"
                      placeholder="City"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      State
                    </label>
                    <input
                      type="text"
                      value={profile.itemLocationState || ''}
                      onChange={(e) => updateField('itemLocationState', e.target.value)}
                      className="w-full"
                      placeholder="CA"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      ZIP Code
                    </label>
                    <input
                      type="text"
                      value={profile.itemLocationZip || ''}
                      onChange={(e) => updateField('itemLocationZip', e.target.value)}
                      className="w-full"
                      placeholder="90210"
                    />
                  </div>
                </div>
              </div>

              {/* Returns */}
              <div className="p-4 bg-surface-800/50 rounded-lg space-y-4">
                <h3 className="font-medium text-surface-200">Returns</h3>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={profile.returnsAccepted ?? true}
                      onChange={(e) => updateField('returnsAccepted', e.target.checked)}
                      className="w-4 h-4 rounded border-surface-600"
                    />
                    <span className="text-sm text-surface-300">Accept Returns</span>
                  </label>
                </div>
                {profile.returnsAccepted && (
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-surface-300 mb-2">
                        Return Window
                      </label>
                      <select
                        value={profile.returnWindowDays || 14}
                        onChange={(e) => updateField('returnWindowDays', parseInt(e.target.value))}
                        className="w-full"
                      >
                        {RETURN_WINDOW_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt} days
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-surface-300 mb-2">
                        Refund Method
                      </label>
                      <select
                        value={profile.refundMethod || 'Money Back'}
                        onChange={(e) => updateField('refundMethod', e.target.value)}
                        className="w-full"
                      >
                        <option value="Money Back">Money Back</option>
                        <option value="Exchange">Exchange</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-surface-300 mb-2">
                        Return Shipping Paid By
                      </label>
                      <select
                        value={profile.shippingCostPaidBy || 'Seller'}
                        onChange={(e) => updateField('shippingCostPaidBy', e.target.value)}
                        className="w-full"
                      >
                        <option value="Seller">Seller</option>
                        <option value="Buyer">Buyer</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Payment */}
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={profile.immediatePayment ?? false}
                    onChange={(e) => updateField('immediatePayment', e.target.checked)}
                    className="w-4 h-4 rounded border-surface-600"
                  />
                  <span className="text-sm text-surface-300">Require Immediate Payment</span>
                </label>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 sm:gap-3 p-4 sm:p-5 border-t border-surface-700 flex-shrink-0">
          <button onClick={onClose} className="btn btn-secondary text-sm sm:text-base">
            Cancel
          </button>
          {!isExportMode && (
            <button
              onClick={() => handleSave(true)}
              disabled={loading || saving}
              className="btn btn-primary"
            >
              {saving ? (
                <>
                  <div className="spinner"></div>
                  Saving...
                </>
              ) : (
                'Save Settings'
              )}
            </button>
          )}
          {isExportMode && (
            <button
              onClick={handleExport}
              disabled={loading || saving || isExporting}
              className="btn btn-primary"
            >
              {isExporting || saving ? (
                <>
                  <div className="spinner"></div>
                  {saving ? 'Saving...' : 'Exporting...'}
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Export eBay CSV
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
