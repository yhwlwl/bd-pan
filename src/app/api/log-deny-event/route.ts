/**
 * POST /api/log-deny-event — 公共 deny 日志端点
 *
 * 供 deny.tantantan.tech 的 403.html 跨域回调使用。
 * Origin 校验防伪造，CORS 由 Nginx /pan/ location 全局处理。
 * 无需鉴权——deny 事件本身就来自未认证请求。
 */
import { logDenyEvent } from '../../../lib/deny-tracker';

const ALLOWED_ORIGINS = [
  'deny.tantantan.tech',
  'pan.tantantan.tech',
  'pan.cdqzsta.tech',
  'localhost',
];

function isValidOrigin(request: Request): boolean {
  const origin = request.headers.get('origin') || '';
  const referer = request.headers.get('referer') || '';

  const checkOrigin = (url: string) => {
    if (!url) return false;
    try {
      const host = new URL(url).hostname;
      return ALLOWED_ORIGINS.some(a => host === a || host.endsWith('.' + a));
    } catch {
      return false;
    }
  };

  // 服务端直接调用（无 Origin/Referer）→ 放行
  if (!origin && !referer) return true;
  return checkOrigin(origin) || checkOrigin(referer);
}

export async function POST(request: Request): Promise<Response> {
  if (!isValidOrigin(request)) {
    return new Response(JSON.stringify({ code: 403, message: '来源不被允许' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const {
      deny_source = 'nginx',
      deny_reason = 'nginx_unknown',
      ip = 'unknown',
      device_code,
      user_agent,
      request_path,
      username,
      geo_country,
      geo_city,
      geo_region,
    } = body;

    const result = await logDenyEvent({
      denySource: deny_source,
      denyReason: deny_reason,
      ip,
      deviceCode: device_code,
      userAgent: user_agent,
      requestPath: request_path,
      username,
      geoCountry: geo_country,
      geoCity: geo_city,
      geoRegion: geo_region,
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ recorded: false, error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
  });
}
