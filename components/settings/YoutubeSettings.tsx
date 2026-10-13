'use client';

import { useEffect, useState } from 'react';
import { AlertIcon, CheckCircleIcon, CopyIcon } from '../ui/icons';

interface YoutubeConnection {
  connectionId: string;
  channelId: string;
  channelTitle: string;
  channelHandle: string | null;
  status: string;
  statusDetail: string | null;
  connectedAt: string;
}

interface YoutubeSettingsData {
  configured: boolean;
  missingEnv: string[];
  callbackUrl: string;
  maxUploadBytes: number;
  connections: YoutubeConnection[];
}

const EMPTY: YoutubeSettingsData = {
  configured: false,
  missingEnv: [],
  callbackUrl: '',
  maxUploadBytes: 0,
  connections: [],
};

export function YoutubeSettings() {
  const [settings, setSettings] = useState<YoutubeSettingsData>(EMPTY);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch('/api/youtube/settings', { cache: 'no-store' });
    const body = await res.json();
    if (body.success) setSettings({ ...EMPTY, ...body.data });
  }

  useEffect(() => {
    refresh().catch(() => setError('Could not load YouTube settings'));
    const params = new URLSearchParams(window.location.search);
    const notice = params.get('youtube');
    if (notice === 'connected') setMessage(`YouTube connected${params.get('channel') ? `: ${params.get('channel')}` : ''}. Confirm the channel id below before uploading.`);
    if (notice === 'error') setError(params.get('message') || 'YouTube connection failed');
  }, []);

  async function disconnect(connectionId: string, channelTitle: string) {
    if (!window.confirm(`Disconnect ${channelTitle}? Uploads to this channel will stop until you connect it again.`)) return;
    setBusyId(connectionId);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/youtube/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not disconnect YouTube');
      setMessage(body.data?.note || 'YouTube disconnected');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect YouTube');
    } finally {
      setBusyId(null);
    }
  }

  const megabytes = Math.round(settings.maxUploadBytes / (1024 * 1024));

  return (
    <section id="youtube" className="panel p-5 sm:p-6 scroll-mt-24 space-y-5">
      <div>
        <h2 className="font-semibold text-white">YouTube</h2>
        <p className="mt-1 text-sm text-surface-400">
          Connect a channel, then use its connection id for uploads. Each Google login is stored separately so a video is not sent to the wrong channel.
        </p>
      </div>

      {settings.connections.length === 0 ? (
        <Status ok={false} text="No YouTube channel is connected yet" />
      ) : (
        <div className="space-y-3">
          {settings.connections.map((connection) => (
            <div key={connection.connectionId} className="rounded-xl border border-white/[0.08] p-4 space-y-2">
              <Status
                ok={connection.status === 'connected'}
                text={connection.status === 'connected'
                  ? `Connected to ${connection.channelTitle}`
                  : `${connection.channelTitle} needs to be reconnected`}
              />
              {connection.channelHandle && <p className="text-sm text-surface-300">{connection.channelHandle}</p>}
              <CopyLine label="Channel ID" value={connection.channelId} />
              <CopyLine label="Connection ID" value={connection.connectionId} />
              {connection.statusDetail && <p className="text-sm text-amber-100">{connection.statusDetail}</p>}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busyId === connection.connectionId}
                onClick={() => disconnect(connection.connectionId, connection.channelTitle)}
              >
                {busyId === connection.connectionId ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          ))}
        </div>
      )}

      {!settings.configured && (
        <p className="text-sm text-amber-100">
          Add {settings.missingEnv.join(', ') || 'the Google OAuth variables'} on Render. In Google Cloud, set the authorized redirect URI to{' '}
          <code className="font-mono text-surface-100">{settings.callbackUrl || 'https://lotlister.onrender.com/api/youtube/callback'}</code>.
        </p>
      )}

      {settings.configured && (
        <a href="/api/youtube/connect" className="btn btn-primary btn-sm inline-flex">
          {settings.connections.length > 0 ? 'Connect another channel' : 'Connect YouTube'}
        </a>
      )}

      <div className="text-sm text-surface-400 space-y-2 leading-6">
        <p>On Google’s screen, choose the account that owns the channel you want. If YouTube asks which channel, pick that channel. Compare the channel id here with YouTube Studio → Settings → Channel → Advanced settings. If it is the wrong channel, disconnect it and connect again.</p>
        <p>Uploads stay private unless a tool call sets publication intent. Refresh tokens from an OAuth app left in Testing expire after 7 days. Publishing the consent screen to production is required for ongoing access, and tokens can still be revoked.</p>
        <p>Video files are stored on this server’s existing disk, up to about {megabytes || 400} MB each. Custom thumbnails also require phone verification on that specific channel.</p>
      </div>

      {settings.callbackUrl && <CopyLine label="OAuth redirect URI" value={settings.callbackUrl} />}
      {message && <p className="text-sm text-emerald-300">{message}</p>}
      {error && <p className="text-sm text-red-300">{error}</p>}
    </section>
  );
}

function Status({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-0.5 ${ok ? 'text-emerald-300' : 'text-amber-300'}`}>
        {ok ? <CheckCircleIcon size={18} /> : <AlertIcon size={18} />}
      </span>
      <span className="text-sm text-surface-200">{text}</span>
    </div>
  );
}

function CopyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="text-xs font-medium text-surface-400 mb-1">{label}</div>
      <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-surface-950/60 pl-3 pr-1 py-1">
        <code className="flex-1 text-xs sm:text-sm break-all font-mono text-surface-200">{value}</code>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <CheckCircleIcon size={14} className="text-emerald-300" /> : <CopyIcon size={14} />}
        </button>
      </div>
    </div>
  );
}
