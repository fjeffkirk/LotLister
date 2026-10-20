'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';

interface Advertiser {
  advertiserId: string;
  name: string;
  currency: string | null;
  timezone: string | null;
  selected: boolean;
}

interface Policy {
  advertiserId: string;
  dailyBudgetUsd: number;
  peakSpendAuthorizedUsd: number | null;
  targetCpaUsd: number;
  observationHours: number;
  reportingDelayHours: number;
  minPurchasesBeforePause: number;
  scheduledReviewEnabled: boolean;
  safetyRulesEnabled: boolean;
  emergencyPaused: boolean;
  totalTestCapUsd: number | null;
  endDate: string | null;
  managedDailyUsd: number;
}

interface Settings {
  configured: boolean;
  missingEnv: string[];
  callbackUrl: string;
  connection: {
    status: string;
    statusDetail: string | null;
    grantedScope: string;
    advertisers: Advertiser[];
    note: string;
  } | null;
  capabilities: Array<{ kind: string; read: boolean; create: boolean; reason: string }>;
  budget: { message: string; peakDailyUsd: number | null; weeklyCeilingUsd: number | null; hardDailyCap: false };
  policies: Policy[];
  recentChanges: Array<{ id: string; action: string; reason: string; status: string; createdAt: string }>;
  scheduledReview: string;
}

const EMPTY: Settings = {
  configured: false,
  missingEnv: [],
  callbackUrl: '',
  connection: null,
  capabilities: [],
  budget: { message: '', peakDailyUsd: null, weeklyCeilingUsd: null, hardDailyCap: false },
  policies: [],
  recentChanges: [],
  scheduledReview: '',
};

export function TiktokSettings() {
  const [settings, setSettings] = useState<Settings>(EMPTY);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [advertiserId, setAdvertiserId] = useState('');
  const [dailyBudgetUsd, setDailyBudgetUsd] = useState('20');
  const [authorizePeak, setAuthorizePeak] = useState(false);
  const [targetCpaUsd, setTargetCpaUsd] = useState('15');
  const [observationHours, setObservationHours] = useState('72');
  const [reportingDelayHours, setReportingDelayHours] = useState('6');
  const [minPurchases, setMinPurchases] = useState('5');
  const [scheduledReviewEnabled, setScheduledReviewEnabled] = useState(false);
  const [safetyRulesEnabled, setSafetyRulesEnabled] = useState(false);
  const [totalTestCapUsd, setTotalTestCapUsd] = useState('');
  const [endDate, setEndDate] = useState('');
  const [previewId, setPreviewId] = useState('');
  const [performanceText, setPerformanceText] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch('/api/tiktok/settings', { cache: 'no-store' });
    const body = await res.json();
    if (!res.ok || !body.success) throw new Error(body.error || 'Could not load TikTok settings');
    const data = { ...EMPTY, ...body.data } as Settings;
    setSettings(data);
    const selected = data.connection?.advertisers.find((item) => item.selected);
    if (selected) setAdvertiserId(selected.advertiserId);
    const policy = data.policies.find((item) => item.advertiserId === (selected?.advertiserId ?? data.policies[0]?.advertiserId));
    if (policy) {
      setDailyBudgetUsd(String(policy.dailyBudgetUsd));
      setAuthorizePeak(policy.peakSpendAuthorizedUsd != null);
      setTargetCpaUsd(String(policy.targetCpaUsd));
      setObservationHours(String(policy.observationHours));
      setReportingDelayHours(String(policy.reportingDelayHours));
      setSafetyRulesEnabled(policy.safetyRulesEnabled);
      setScheduledReviewEnabled(policy.scheduledReviewEnabled);
      setMinPurchases(String(policy.minPurchasesBeforePause));
      setTotalTestCapUsd(policy.totalTestCapUsd == null ? '' : String(policy.totalTestCapUsd));
      setEndDate(policy.endDate ? policy.endDate.slice(0, 10) : '');
    }
  }

  useEffect(() => {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load TikTok settings'));
    const params = new URLSearchParams(window.location.search);
    if (params.get('tiktok') === 'connected') setMessage(`TikTok connected. ${params.get('advertisers') ?? '0'} advertiser account(s) were returned. Select one before any change.`);
    if (params.get('tiktok') === 'error') setError(params.get('message') || 'TikTok connection failed');
  }, []);

  async function post(url: string, payload: unknown, okText: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || 'Request failed');
      setMessage(okText);
      await refresh();
      return body.data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function savePolicy(event: FormEvent) {
    event.preventDefault();
    await post('/api/tiktok/policy', {
      advertiserId,
      dailyBudgetUsd: Number(dailyBudgetUsd),
      authorizePeak,
      targetCpaUsd: Number(targetCpaUsd),
      observationHours: Number(observationHours),
      reportingDelayHours: Number(reportingDelayHours),
      minPurchasesBeforePause: Number(minPurchases),
      scheduledReviewEnabled,
      safetyRulesEnabled,
      totalTestCapUsd: totalTestCapUsd.trim() ? Number(totalTestCapUsd) : null,
      endDate: endDate || null,
    }, authorizePeak ? 'Policy saved. The peak day is authorized.' : 'Policy saved. Launch stays blocked until you authorize the peak day.');
  }

  async function loadPerformance() {
    if (!advertiserId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tiktok/performance?advertiserId=${encodeURIComponent(advertiserId)}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not load performance');
      const rows = Array.isArray(body.data?.rows) ? body.data.rows.length : 0;
      setPerformanceText(`${rows} reporting row(s) for this advertiser. Purchases in the report are TikTok-attributed and are not matched to store orders.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load performance');
    } finally {
      setBusy(false);
    }
  }

  const selected = settings.connection?.advertisers.find((item) => item.advertiserId === advertiserId) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/lots" className="text-sm text-surface-400 hover:text-surface-200">Dashboard</Link>
        <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-white">TikTok ads</h1>
        <p className="mt-1 text-sm text-surface-400">Box Buddy tests for the advertiser account you select. @obdcollect is a profile, not the ad account id.</p>
      </div>

      {message && <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">{message}</p>}
      {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</p>}

      <section className="panel p-5 sm:p-6 space-y-4">
        <h2 className="font-semibold text-white">Connection</h2>
        <p className="text-sm text-surface-300">{settings.connection ? `Status: ${settings.connection.status}` : 'No TikTok advertiser is connected.'}</p>
        {settings.connection?.grantedScope && <p className="text-sm text-surface-400 break-words">Permissions: {settings.connection.grantedScope}</p>}
        {settings.connection?.statusDetail && <p className="text-sm text-amber-100">{settings.connection.statusDetail}</p>}
        {settings.connection?.note && <p className="text-sm text-surface-400">{settings.connection.note}</p>}
        {!settings.configured && (
          <p className="text-sm text-amber-100">
            Add {settings.missingEnv.join(', ') || 'the TikTok variables'} on Render. Register this redirect URI:{' '}
            <code className="font-mono text-surface-100 break-all">{settings.callbackUrl || 'https://lotlister.onrender.com/api/tiktok/callback'}</code>
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-2">
          <a className="btn btn-primary" href="/api/tiktok/connect">Connect TikTok advertiser</a>
          <button type="button" className="btn btn-secondary" disabled={busy || !settings.connection} onClick={() => post('/api/tiktok/disconnect', {}, 'TikTok disconnected on LotLister.')}>Disconnect</button>
        </div>
      </section>

      <section className="panel p-5 sm:p-6 space-y-4">
        <h2 className="font-semibold text-white">Advertiser account</h2>
        {settings.connection && settings.connection.advertisers.length > 0 ? (
          <>
            <label className="block text-sm text-surface-300">
              Account
              <select className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-white" value={advertiserId} onChange={(event) => setAdvertiserId(event.target.value)}>
                <option value="">Select an advertiser</option>
                {settings.connection.advertisers.map((item) => (
                  <option key={item.advertiserId} value={item.advertiserId}>
                    {item.name} ({item.advertiserId}) {item.currency ?? ''} {item.timezone ?? ''}
                  </option>
                ))}
              </select>
            </label>
            {selected && <p className="text-sm text-surface-400">{selected.currency ?? 'Currency unknown'} · {selected.timezone ?? 'Timezone unknown'}</p>}
            <button type="button" className="btn btn-secondary" disabled={busy || !advertiserId} onClick={() => post('/api/tiktok/select', { advertiserId }, 'Advertiser selected. Other accounts will not be changed.')}>Use this account</button>
          </>
        ) : (
          <p className="text-sm text-surface-400">Advertiser accounts appear here after the authorization. LotLister will not guess which one to use.</p>
        )}
      </section>

      <section className="panel p-5 sm:p-6 space-y-3">
        <h2 className="font-semibold text-white">What this connection can do</h2>
        {settings.capabilities.map((item) => (
          <p key={item.kind} className="text-sm text-surface-300">
            <span className="text-white">{item.kind}</span>: {item.create ? 'create and read' : item.read ? 'read only' : 'not available'}. {item.reason}
          </p>
        ))}
        <p className="text-sm text-surface-400">{settings.budget.message}</p>
        {settings.budget.peakDailyUsd != null && (
          <p className="text-sm text-surface-400">Peak day ${settings.budget.peakDailyUsd}. Week ${settings.budget.weeklyCeilingUsd}. This is not a hard daily cap.</p>
        )}
      </section>

      <form className="panel p-5 sm:p-6 space-y-4" onSubmit={savePolicy}>
        <h2 className="font-semibold text-white">Box Buddy policy</h2>
        <p className="text-sm text-surface-400">$20 is the total dynamic daily average for managed campaigns, not $20 per ad. TikTok can spend 125% of that average on one day. Authorizing the peak does not raise the budget sent to TikTok.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Daily average USD" value={dailyBudgetUsd} onChange={setDailyBudgetUsd} />
          <Field label="Target CPA USD" value={targetCpaUsd} onChange={setTargetCpaUsd} />
          <Field label="Observation hours" value={observationHours} onChange={setObservationHours} />
          <Field label="Reporting delay hours" value={reportingDelayHours} onChange={setReportingDelayHours} />
          <Field label="Purchases before a pause" value={minPurchases} onChange={setMinPurchases} />
          <Field label="Optional total test cap USD" value={totalTestCapUsd} onChange={setTotalTestCapUsd} />
          <label className="block text-sm text-surface-300">
            Optional end date
            <input type="date" className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-white" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
        </div>
        <label className="flex items-start gap-2 text-sm text-surface-200">
          <input type="checkbox" checked={authorizePeak} onChange={(event) => setAuthorizePeak(event.target.checked)} />
          I authorize a peak day of 125% of this daily average. The amount sent to TikTok stays the daily average.
        </label>
        <label className="flex items-start gap-2 text-sm text-surface-200">
          <input type="checkbox" checked={scheduledReviewEnabled} onChange={(event) => setScheduledReviewEnabled(event.target.checked)} />
          Enable the optional scheduled review. This does not make ChatGPT run continuously.
        </label>
        <label className="flex items-start gap-2 text-sm text-surface-200">
          <input type="checkbox" checked={safetyRulesEnabled} onChange={(event) => setSafetyRulesEnabled(event.target.checked)} />
          Allow the review to pause a managed campaign after the observation window when CPA is above the goal.
        </label>
        <p className="text-sm text-surface-500">{settings.scheduledReview}</p>
        <button className="btn btn-primary" type="submit" disabled={busy || !advertiserId}>Save policy</button>
      </form>

      <section className="panel p-5 sm:p-6 space-y-3">
        <h2 className="font-semibold text-white">Authorize a reviewed preview</h2>
        <p className="text-sm text-surface-400">ChatGPT can prepare a preview. Only this signed-in page can authorize the first launch. The campaign is still created paused.</p>
        <label className="block text-sm text-surface-300">
          Preview id
          <input className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-white" value={previewId} onChange={(event) => setPreviewId(event.target.value)} />
        </label>
        <button type="button" className="btn btn-secondary" disabled={busy || previewId.length < 8} onClick={() => post('/api/tiktok/authorize', { previewId }, 'Preview authorized. ChatGPT can now create that paused campaign.')}>Authorize this preview</button>
      </section>

      <section className="panel p-5 sm:p-6 space-y-3">
        <h2 className="font-semibold text-white">Recent performance and changes</h2>
        <button type="button" className="btn btn-secondary" disabled={busy || !advertiserId} onClick={loadPerformance}>Load recent performance</button>
        {performanceText && <p className="text-sm text-surface-300">{performanceText}</p>}
        {settings.recentChanges.length === 0 ? <p className="text-sm text-surface-400">No TikTok changes yet.</p> : (
          <ul className="space-y-2">
            {settings.recentChanges.map((change) => (
              <li key={change.id} className="text-sm text-surface-300">
                <span className="text-white">{change.action}</span> · {change.status} · {change.reason}
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="btn btn-secondary" disabled={busy || !advertiserId} onClick={() => post('/api/tiktok/pause', { advertiserId }, 'Emergency pause is on. Managed campaigns were paused.')}>Emergency pause managed campaigns</button>
      </section>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm text-surface-300">
      {label}
      <input className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-white" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
