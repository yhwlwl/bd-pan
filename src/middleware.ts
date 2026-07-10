import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// CORS 由 Nginx 处理，此中间件仅保持文件存在

export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
