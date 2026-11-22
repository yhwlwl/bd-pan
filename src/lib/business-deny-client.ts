// Only explicit, server-confirmed business bans navigate away; ordinary 401/403 remain local.
export const BUSINESS_DENY_URL = 'https://deny.tantantan.tech/#business-ban';

export function getBusinessApiBase(): string {
  if (typeof window === 'undefined') return (process.env.NEXT_PUBLIC_API_BASE || '').replace(/\/+$/, '');
  return window.location.hostname === 'pan.tantantan.tech' &&
    /^\/pan(?:\/|$)/.test(window.location.pathname) ? '/pan' : '';
}

let fallbackDeviceCode = '';
export function ensureBusinessDeviceCode(): string {
  if (typeof window === 'undefined') return '';
  let value = '';
  try { value = window.localStorage.getItem('BDPAN_DEVICE_CODE') || ''; } catch {}
  if (!/^wlm-v2-[a-z0-9-]{16,80}$/i.test(value)) {
    value = fallbackDeviceCode || `wlm-v2-${window.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`}`;
    fallbackDeviceCode = value;
    try { window.localStorage.setItem('BDPAN_DEVICE_CODE', value); } catch {}
  }

  // This is an existing pseudonymous device identifier, not an auth credential.
  // Mirror it to a host-only cookie so full-page requests also carry the device.
  try {
    const cookie = `BDPAN_DEVICE_CODE=${encodeURIComponent(value)}`;
    if (!document.cookie.split(';').some(part => part.trim() === cookie)) {
      document.cookie = `${cookie}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`;
    }
  } catch {}
  return value;
}

export function redirectBusinessBan(status: number, body: unknown): boolean {
  if (status !== 403 || typeof body !== 'object' || body === null || !('blocked' in body) || body.blocked !== true) return false;
  if (typeof window !== 'undefined') window.location.replace(BUSINESS_DENY_URL);
  return true;
}

export async function businessFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  try {
    const device = ensureBusinessDeviceCode();
    if (device && !headers.has('X-Device-Code')) headers.set('X-Device-Code', device);
  } catch {}
  const response = await fetch(url, { ...init, headers });
  if (response.status === 403 && (response.headers.get('content-type') || '').includes('application/json')) {
    const body = await response.clone().json().catch(() => null);
    redirectBusinessBan(response.status, body);
  }
  return response;
}
