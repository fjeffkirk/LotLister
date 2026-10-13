import { lookup } from 'dns/promises';
import { YoutubeUserError } from './types';

export type DnsLookup = (hostname: string) => Promise<string[]>;

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google.com',
]);

export function isBlockedAddress(input: string): boolean {
  const ip = input.toLowerCase().replace(/^::ffff:/, '');
  if (ip.includes(':')) return isBlockedIpv6(ip);
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && parts[2] === 2) return true;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
  if (a === 203 && b === 0 && parts[2] === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  if (ip === '::' || ip === '::1') return true;
  const head = ip.split(':').filter(Boolean)[0] ?? '';
  const prefix = Number.parseInt(head, 16);
  if (Number.isNaN(prefix)) return true;
  if ((prefix & 0xfe00) === 0xfc00) return true;
  if ((prefix & 0xffc0) === 0xfe80) return true;
  if ((prefix & 0xff00) === 0xff00) return true;
  if (head.toLowerCase() === '2001' && ip.toLowerCase().startsWith('2001:db8')) return true;
  return false;
}

export function assertAddressesPublic(addresses: string[]): void {
  if (addresses.length === 0) {
    throw new YoutubeUserError('unsafe_url', 'The source host did not resolve to a public address.');
  }
  if (addresses.some((address) => isBlockedAddress(address))) {
    throw new YoutubeUserError('unsafe_url', 'Refusing a source URL that resolves to a private, loopback, link-local, or metadata address.');
  }
}

export function validateUrlShape(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new YoutubeUserError('unsafe_url', 'The source URL is not a valid URL.');
  }
  if (url.protocol !== 'https:') {
    throw new YoutubeUserError('unsafe_url', 'Source URLs must use https. Sandbox, http, and file URLs are rejected.');
  }
  if (url.username || url.password) {
    throw new YoutubeUserError('unsafe_url', 'Source URLs cannot contain a username or password.');
  }
  if (url.port && url.port !== '443') {
    throw new YoutubeUserError('unsafe_url', 'Source URLs must use port 443.');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    BLOCKED_HOSTS.has(host)
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || /^\d+$/.test(host)
    || /^0x/i.test(host)
  ) {
    throw new YoutubeUserError('unsafe_url', 'That source host is not allowed.');
  }
  if (isIpLiteral(host) && isBlockedAddress(host)) {
    throw new YoutubeUserError('unsafe_url', 'Refusing a source URL that points at a private or internal address.');
  }
  return url;
}

function isIpLiteral(host: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':');
}

export async function screenUrl(raw: string, resolve: DnsLookup = defaultLookup): Promise<URL> {
  const url = validateUrlShape(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIpLiteral(host)) {
    assertAddressesPublic([host]);
    return url;
  }
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new YoutubeUserError('unsafe_url', 'The source host could not be resolved.');
  }
  assertAddressesPublic(addresses);
  return url;
}

async function defaultLookup(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

export function resolveRedirect(current: URL, location: string): URL {
  let next: URL;
  try {
    next = new URL(location, current);
  } catch {
    throw new YoutubeUserError('unsafe_url', 'The source URL redirected to an invalid address.');
  }
  return next;
}
