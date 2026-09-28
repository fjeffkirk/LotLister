'use client';

import { ReactNode, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useUser } from './UserProvider';
import { LogoMark } from './ui/Logo';
import { AlertIcon, BoltIcon, ShieldIcon, TableIcon } from './ui/icons';

// eBay links to the privacy page from its consent screen, so it must stay public.
const PUBLIC_PATHS = ['/privacy'];

const FEATURES = [
  { icon: <BoltIcon size={16} />, title: 'Photos to listings in minutes', text: 'Drop front and back scans and every pair becomes a card.' },
  { icon: <ShieldIcon size={16} />, title: 'PSA import', text: 'Paste cert numbers to pull grades, details, and slab images.' },
  { icon: <TableIcon size={16} />, title: 'Spreadsheet speed', text: 'Fill down, paste from Sheets, then list the whole lot at once.' },
];

const SHOWCASE = [
  { player: 'Shohei Ohtani', set: '2023 Topps Chrome', price: '$24.99', grade: 'PSA 10', hue: 'from-sky-500/80 via-indigo-600/80 to-violet-700/80', rotate: '-rotate-[12deg]', offset: '-translate-x-44 translate-y-10', delay: '0s' },
  { player: 'Julio Rodríguez', set: '2022 Bowman', price: '$12.50', grade: 'Raw NM', hue: 'from-emerald-400/80 via-teal-600/80 to-cyan-800/80', rotate: 'rotate-[10deg]', offset: 'translate-x-44 translate-y-14', delay: '1.2s' },
  { player: 'Ken Griffey Jr.', set: '1989 Upper Deck', price: '$89.00', grade: 'PSA 9', hue: 'from-amber-400/85 via-orange-500/80 to-rose-600/80', rotate: 'rotate-0', offset: '-translate-y-4', delay: '0.6s' },
];

function ShowcaseCard({ card }: { card: (typeof SHOWCASE)[number] }) {
  return (
    <div className={`absolute ${card.offset}`}>
      <div className={`${card.rotate}`}>
        <div className="animate-float" style={{ animationDelay: card.delay }}>
          <div className="w-52 rounded-2xl p-2 bg-white/[0.06] border border-white/15 backdrop-blur-md shadow-pop">
            <div className={`h-60 rounded-xl bg-gradient-to-br ${card.hue} relative overflow-hidden`}>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.35),transparent_45%)]" />
              <div className="absolute inset-x-3 bottom-3 rounded-lg bg-black/35 backdrop-blur px-2.5 py-1.5">
                <div className="text-[13px] font-semibold text-white truncate">{card.player}</div>
                <div className="text-[10px] text-white/70">{card.set}</div>
              </div>
              <span className="absolute top-3 right-3 chip bg-black/40 border-white/20 text-white">{card.grade}</span>
            </div>
            <div className="flex items-center justify-between px-1.5 pt-2 pb-0.5">
              <span className="text-[11px] text-surface-300">Ready to list</span>
              <span className="text-sm font-semibold text-white tabular-nums">{card.price}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SignInGate({ children }: { children: ReactNode }) {
  const { username, isLoading } = useUser();
  const pathname = usePathname();
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('signin') === 'error') {
      setError(params.get('message') || 'eBay sign-in failed.');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('ebay') === 'declined') {
      setError('eBay sign-in was cancelled.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  if (PUBLIC_PATHS.includes(pathname)) return <>{children}</>;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LogoMark size={44} />
      </div>
    );
  }

  if (username) return <>{children}</>;

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="relative flex flex-col justify-between px-6 sm:px-12 lg:px-16 py-10">
        <div className="flex items-center gap-2.5">
          <LogoMark size={34} />
          <span className="text-lg font-semibold tracking-tight text-white">LotLister</span>
        </div>

        <div className="max-w-md py-12 animate-slide-up">
          <span className="chip chip-info mb-5">For eBay card sellers</span>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.08] text-white">
            List a whole lot of cards,{' '}
            <span className="bg-gradient-to-r from-primary-300 via-primary-400 to-accent-400 bg-clip-text text-transparent">fast.</span>
          </h1>
          <p className="mt-4 text-surface-400 leading-relaxed">
            Turn a stack of photos into finished eBay listings. Sign in with the eBay account you sell from; your lots are tied to it.
          </p>

          {error && (
            <div className="mt-6 flex items-start gap-2.5 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-200 text-sm">
              <AlertIcon className="mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setRedirecting(true);
              window.location.href = '/api/ebay/connect';
            }}
            disabled={redirecting}
            className="btn btn-primary w-full sm:w-auto mt-8 px-6 py-3 text-[15px]"
          >
            {redirecting ? <div className="spinner w-4 h-4 border-white/30 border-t-white" /> : null}
            Sign in with eBay
          </button>

          <ul className="mt-10 space-y-4">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="flex gap-3">
                <span className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.08] text-primary-300 flex items-center justify-center flex-shrink-0">
                  {feature.icon}
                </span>
                <span>
                  <span className="block text-sm font-medium text-surface-100">{feature.title}</span>
                  <span className="block text-sm text-surface-400">{feature.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-surface-500">
          <a href="/privacy" className="hover:text-surface-300">Privacy policy</a>
        </p>
      </div>

      <div className="relative hidden lg:flex items-center justify-center overflow-hidden border-l border-white/[0.06] bg-[radial-gradient(700px_500px_at_50%_45%,rgba(74,118,251,0.22),transparent_70%),radial-gradient(500px_400px_at_75%_75%,rgba(154,102,255,0.18),transparent_70%)]">
        <div className="absolute inset-0 opacity-[0.07] bg-[linear-gradient(rgba(255,255,255,0.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.6)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(circle_at_center,black,transparent_70%)]" />
        <div className="relative w-full h-full flex items-center justify-center">
          {SHOWCASE.map((card) => (
            <ShowcaseCard key={card.player} card={card} />
          ))}
        </div>
      </div>
    </div>
  );
}
