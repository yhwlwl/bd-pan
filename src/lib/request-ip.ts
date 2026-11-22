import { isIP } from 'node:net';

// Keep risk keys compatible with existing IP bans, rejecting ambiguous lists.
export function normalizeIp(raw: string | null | undefined): string {
  let value = (raw || '').trim();
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  if (value.startsWith('::ffff:')) value = value.slice(7);
  if (!value || value.length > 128 || /[\r\n]/.test(value) || isIP(value) === 0) return 'unknown';
  return value;
}

type Runtime = { vercel: boolean; production: boolean };

/** Select trusted headers using server-side deployment configuration, never request claims. */
export function resolveRequestIp(headers: Headers, runtime: Runtime = {
  vercel: process.env.VERCEL === '1',
  production: process.env.NODE_ENV === 'production',
}): string {
  if (runtime.vercel) {
    // Vercel supplies these headers at its ingress; ignore custom origin-proxy headers.
    const platformIp = headers.get('x-vercel-forwarded-for');
    return normalizeIp(platformIp === null ? headers.get('x-forwarded-for') : platformIp);
  }

  // ECS ingress must overwrite this header and keep the application listener private.
  const proxyIp = headers.get('x-wlm-client-ip');
  if (proxyIp !== null || runtime.production) return normalizeIp(proxyIp);
  return normalizeIp(headers.get('x-real-ip') || headers.get('x-forwarded-for')?.split(',').map(item => item.trim()).filter(Boolean).pop());
}
