// Only explicit, server-confirmed business bans navigate away; ordinary 401/403 remain local.
export const BUSINESS_DENY_URL = 'https://deny.tantantan.tech/#business-ban';

export function redirectBusinessBan(status: number, body: unknown): boolean {
  if (status !== 403 || typeof body !== 'object' || body === null || !('blocked' in body) || body.blocked !== true) return false;
  if (typeof window !== 'undefined') window.location.replace(BUSINESS_DENY_URL);
  return true;
}

export async function businessFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  try {
    const device = window.localStorage.getItem('BDPAN_DEVICE_CODE');
    if (device && !headers.has('X-Device-Code')) headers.set('X-Device-Code', device);
  } catch {}
  const response = await fetch(url, { ...init, headers });
  if (response.status === 403 && (response.headers.get('content-type') || '').includes('application/json')) {
    const body = await response.clone().json().catch(() => null);
    redirectBusinessBan(response.status, body);
  }
  return response;
}
