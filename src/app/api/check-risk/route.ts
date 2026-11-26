/**
 * GET /api/check-risk — 检查当前设备/IP 的风险评分
 * 无需鉴权，自动从请求头提取 IP 和 device_code
 */
import { calculateDecayedScore, getEntityRisk, getRequestContext, denyAndLog } from '../../../lib/deny-tracker';
import { hashDeviceCode } from '../../../lib/fingerprint';
import { verifyToken } from '../_auth';

export async function GET(request: Request): Promise<Response> {
  const ctx = getRequestContext(request);
  const dcHash = hashDeviceCode(ctx.deviceCode || '');

  try {
    const auth = verifyToken(request.headers.get('authorization') || undefined);
    const { ban, ipRow, deviceRow, decayWindowHours } = await getEntityRisk(ctx.ip, dcHash, auth?.role, auth?.username);
    if (ban.banned) {
      return denyAndLog(request, 'api_entity_banned', 403, '当前访问已被限制，请联系管理员', auth?.username);
    }
    const ipScore = ipRow ? calculateDecayedScore(ipRow.current_score, ipRow.last_offense_at, decayWindowHours) : 0;
    const dcScore = deviceRow ? calculateDecayedScore(deviceRow.current_score, deviceRow.last_offense_at, decayWindowHours) : 0;
    const lastReason = ipRow?.last_offense_reason || deviceRow?.last_offense_reason || '';
    const maxScore = Math.round(Math.max(ipScore, dcScore));
    const warning = maxScore >= 30
      ? `⚠️ 风控提醒：检测到您的设备异常行为。如继续触发安全规则，可能会触发风控（risk_score=${maxScore}, reason="${lastReason}"）`
      : null;

    return Response.json({ ipScore, dcScore, lastReason, warning }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return Response.json({ code: 503, message: '风控状态暂时无法读取' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}


