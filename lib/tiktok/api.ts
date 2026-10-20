import { TiktokUserError, redactSecrets } from './policy';

const API = 'https://business-api.tiktok.com/open_api/v1.3';

export interface TiktokClient {
  get<T>(path: string, query: Record<string, string>): Promise<T>;
  post<T>(path: string, body: Record<string, unknown>): Promise<T>;
}

interface Envelope<T> {
  code?: number;
  message?: string;
  data?: T;
  request_id?: string;
}

export function createTiktokClient(token: string, fetchImpl: typeof fetch = fetch): TiktokClient {
  async function call<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetchImpl(`${API}${path}`, {
      ...init,
      headers: { 'Access-Token': token, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      redirect: 'manual',
    });
    if (response.status >= 300 && response.status < 400) {
      throw new TiktokUserError('upstream_redirect', 'TikTok returned a redirect. The access token was not forwarded.');
    }
    const text = await response.text();
    let body: Envelope<T>;
    try {
      body = JSON.parse(text) as Envelope<T>;
    } catch {
      throw new TiktokUserError('tiktok_error', 'TikTok returned a response that was not JSON.');
    }
    if (!response.ok || body.code !== 0) {
      const message = redactSecrets(body.message || `TikTok request failed (${response.status}).`);
      if (response.status === 401 || /access token/i.test(message)) {
        throw new TiktokUserError('reconnect_required', 'TikTok refused the access token. Connect the advertiser again.');
      }
      throw new TiktokUserError(String(body.code || response.status), message);
    }
    return body.data as T;
  }
  return {
    get: (path, query) => call(path.startsWith('/') ? `${path}?${new URLSearchParams(query)}` : `/${path}?${new URLSearchParams(query)}`, { method: 'GET' }),
    post: (path, body) => call(path, { method: 'POST', body: JSON.stringify(body) }),
  };
}

export const ENDPOINTS = {
  advertisers: '/oauth2/advertiser/get/',
  advertiserInfo: '/advertiser/info/',
  campaigns: '/campaign/get/',
  campaignCreate: '/campaign/create/',
  campaignStatus: '/campaign/status/update/',
  adgroups: '/adgroup/get/',
  adgroupUpdate: '/adgroup/update/',
  ads: '/ad/get/',
  adCreate: '/ad/create/',
  adUpdate: '/ad/update/',
  adStatus: '/ad/status/update/',
  adgroupStatus: '/adgroup/status/update/',
  report: '/report/integrated/get/',
  gmvReport: '/gmv_max/report/get/',
  pixelList: '/pixel/list/',
  identityGet: '/identity/get/',
  videoList: '/tt_video/list/',
  targetingSearch: '/targeting/search/',
} as const;
