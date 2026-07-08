/**
 * GET /api/deny-redirect — Nginx 403 拦截后的服务端日志 + 302 跳转
 *
 * Nginx error_page 403 不再直接 302 到 deny.tantantan.tech，
 * 而是代理到此端点：先服务端记录 deny 事件，再 302。
 * 这样 curl/脚本/DDoS 等非浏览器客户端也能被日志追踪。
 *
 * 403.html 的 JS 回调作为补充（提供设备码 + 地理信息），不重复计分。
 */
import { logDenyEvent } from '../../../lib/deny-tracker';

const ALLOWED_ORIGINS = ['deny.tantantan.tech', 'pan.tantantan.tech', 'pan.cdqzsta.tech', 'localhost'];

function isValidOrigin(request: Request): boolean {
  const origin = request.headers.get('origin') || '';
  const referer = request.headers.get('referer') || '';
  const check = (url: string) => {
    try { return ALLOWED_ORIGINS.some(a => new URL(url).hostname === a); } catch { return false; }
  };
  if (!origin && !referer) return true;
  return check(origin) || check(referer);
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') || '';
  const ip = searchParams.get('ip') || (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') || 'unknown'
  );
  const time = searchParams.get('time') || '';
  const ua = searchParams.get('ua') || '';

  // 服务端记录 deny（无需等浏览器 JS）
  logDenyEvent({
    denySource: 'nginx',
    denyReason: from.startsWith('/db/') ? 'nginx_db_token'
      : from.startsWith('/pdf-preview/') ? 'nginx_pdf_referer'
      : from.match(/\.(env|git|sql|bak|yml|yaml|htaccess)$/i) ? 'nginx_sensitive_file'
      : from.includes('.well-known') ? 'nginx_well_known'
      : 'nginx_unknown',
    ip,
    requestPath: from,
    userAgent: ua,
  }).catch(() => {});

  // 跳转到 deny 页面
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://deny.tantantan.tech/?from=${encodeURIComponent(from)}&ip=${encodeURIComponent(ip)}&time=${encodeURIComponent(time)}&ua=${encodeURIComponent(ua)}`,
    },
  });
}
