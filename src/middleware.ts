import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * API 全局 CORS 中间件
 * 解决新站点（如 weilaimeng.cdqzsta.tech）跨域请求主站 API 的问题
 */
export function middleware(request: NextRequest) {
  // 仅拦截 /api/ 路径
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // OPTIONS 预检请求：直接返回 204 + CORS 头
  if (request.method === 'OPTIONS') {
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

  // 正常 API 请求：加上 CORS 头后继续
  const response = NextResponse.next();
  response.headers.set('Access-Control-Allow-Origin', '*');
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
