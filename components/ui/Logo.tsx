import Link from 'next/link';

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <span
      className="relative inline-flex items-center justify-center rounded-[10px] shadow-glow flex-shrink-0"
      style={{ width: size, height: size, backgroundImage: 'linear-gradient(135deg, #6b95ff 0%, #3659ef 55%, #8347f5 100%)' }}
    >
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="6.5" y="3.5" width="11" height="15" rx="2" stroke="white" strokeOpacity="0.55" strokeWidth="1.6" transform="rotate(-10 12 11)" />
        <rect x="6.5" y="5.5" width="11" height="15" rx="2" fill="white" fillOpacity="0.18" stroke="white" strokeWidth="1.8" />
        <path d="M9.5 16.5h5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function Logo({ href = '/lots', size = 32 }: { href?: string; size?: number }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 group" aria-label="LotLister home">
      <LogoMark size={size} />
      <span className="text-[17px] font-semibold tracking-tight text-white group-hover:text-primary-100 transition-colors">
        LotLister
      </span>
    </Link>
  );
}
