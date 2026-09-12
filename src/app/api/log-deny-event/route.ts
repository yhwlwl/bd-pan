/**
 * POST /api/log-deny-event — 公共 deny 日志端点
 *
 * 供 deny.tantantan.tech 的 403.html 跨域回调使用。
 * Origin 校验防伪造，CORS 由 Nginx /pan/ location 全局处理。
 * 无需鉴权——deny 事件本身就来自未认证请求。
 */
import { getRequestContext, logDenyEvent } from '../../../lib/deny-tracker';
import { verifyToken } from '../_auth';

const ALLOWED_ORIGINS = [
  'deny.tantantan.tech',
  'pan.tantantan.tech',
  'pan.stacdqz.tech',
  'wlm.stacdqz.tech',
  'localhost',
];

const ALLOWED_REASONS = new Set([
  'nginx_db_token', 'nginx_sensitive_file', 'nginx_pdf_referer', 'nginx_well_known',
  'nginx_unknown', 'api_ip_banned', 'api_entity_banned', 'api_auth_failed',
  'api_login_failed', 'api_role_denied', 'api_permission_denied', 'api_file_rule_denied',
  'api_all_items_denied', 'api_pdf_download_denied', 'api_alist_token_denied',
  'api_path_scope_denied', 'api_pdf_link_redacted',
]);

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
      device_code,
      user_agent,
      request_path,
      session_id,
      geo_country,
      geo_city,
      geo_region,
    } = body;

    // IP、设备、账号的信任边界：IP 只来自 Nginx 覆盖写入的可信头，
    // 不接受 body.ip；公共回调也不能替任意账号制造关联风险记录。
    const ctx = getRequestContext(request);
    const tokenUser = verifyToken(request.headers.get('authorization') || undefined);
    const safeReason = typeof deny_reason === 'string' && ALLOWED_REASONS.has(deny_reason)
      ? deny_reason
      : 'nginx_unknown';
    const safeDenySource = deny_source === 'api' || deny_source === 'frontend' ? deny_source : 'nginx';
    const safeSource = process.env.APP_SOURCE || 'pan';

    const result = await logDenyEvent({
      denySource: safeDenySource,
      denyReason: safeReason,
      ip: ctx.ip,
      deviceCode: ctx.deviceCode || device_code,
      userAgent: user_agent,
      requestPath: request_path,
      username: tokenUser?.username,
      sessionId: session_id,
      geoCountry: geo_country,
      geoCity: geo_city,
      geoRegion: geo_region,
      source: safeSource,
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
