import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getRequestContext, checkEntityBanned, denyAndLog } from './lib/deny-tracker';
import { hashDeviceCode } from './lib/fingerprint';
import { verifyToken } from './app/api/_auth';
import { BUSINESS_DENY_URL } from './lib/business-deny-client';

// Next.js 16 Proxy uses the Node runtime, matching the existing risk engine.
export async function proxy(request: NextRequest): Promise<Response> {
  const pathname = request.nextUrl.pathname;
  const isApi = /^\/(?:pan\/)?api(?:\/|$)/.test(pathname);
  if (isApi && request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-Code, X-DB-Token',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const ctx = getRequestContext(request);
  try {
    const auth = verifyToken(request.headers.get('authorization') || undefined);
    const ban = await checkEntityBanned(ctx.ip, hashDeviceCode(ctx.deviceCode || ''), auth?.role, auth?.username);
    if (ban.banned) {
      const refusal = await denyAndLog(request, 'api_entity_banned', 403, '当前访问已被限制，请联系管理员', auth?.username);
      // Page navigations (including unknown paths) must not render protected content.
      // API fetches retain an explicit 403 marker for the client, not a cross-origin redirect.
      if (!isApi && (request.method === 'GET' || request.method === 'HEAD')) {
        return NextResponse.redirect(BUSINESS_DENY_URL, {
          status: 303,
          headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
        });
      }
      return refusal;
    }
  } catch {
    // Preserve existing availability behavior on a transient risk-service failure.
    // Route-level authentication and permission checks remain in place.
  }
  return NextResponse.next();
}

export const config = {
  // Public build assets are not business routes. All pages and APIs, including
  // /mg, unknown paths and future routes, use the same gate.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
