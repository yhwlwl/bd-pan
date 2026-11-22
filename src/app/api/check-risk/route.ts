/**
 * GET /api/check-risk — 检查当前设备/IP 的风险评分
 * 无需鉴权，自动从请求头提取 IP 和 device_code
 */
import { calculateDecayedScore, getRequestContext, checkEntityBanned, denyAndLog } from '../../../lib/deny-tracker';
import { hashDeviceCode } from '../../../lib/fingerprint';
import { pgFetch } from '../../../lib/pg-adapter';
import { getSettings } from '../../../lib/users';
import { verifyToken } from '../_auth';

export async function GET(request: Request): Promise<Response> {
  const ctx = getRequestContext(request);
  const dcHash = hashDeviceCode(ctx.deviceCode || '');

  try {
    const auth = verifyToken(request.headers.get('authorization') || undefined);
    const result = await checkEntityBanned(ctx.ip, dcHash, auth?.role, auth?.username);
    if (result.banned) {
      return denyAndLog(request, 'api_entity_banned', 403, '当前访问已被限制，请联系管理员', auth?.username);
    }
  } catch {
    return new Response(JSON.stringify({ code: 503, message: '风控状态暂时无法读取' }), {
      status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  let ipScore = 0;
  let dcScore = 0;
  let lastReason = '';
  let warning: string | null = null;

  try {
    const settings = await getSettings();
    const decayWindowHours = settings.denyTracking?.decayWindowHours ?? 24;
    // 查 IP 风险分
    const { data: ipRows } = await pgFetch<{ current_score: number; last_offense_reason: string; last_offense_at: string | null }>(
      'GET',
      `bdpan_risk_scores?select=current_score,last_offense_reason,last_offense_at&entity_type=eq.ip&entity_value=eq.${encodeURIComponent(ctx.ip)}&limit=1`
    );
    if (ipRows && ipRows.length > 0) {
      ipScore = calculateDecayedScore(ipRows[0].current_score, ipRows[0].last_offense_at, decayWindowHours);
      lastReason = ipRows[0].last_offense_reason || lastReason;
    }

    // 查设备码风险分
    if (dcHash) {
      const { data: dcRows } = await pgFetch<{ current_score: number; last_offense_reason: string; last_offense_at: string | null }>(
        'GET',
        `bdpan_risk_scores?select=current_score,last_offense_reason,last_offense_at&entity_type=eq.device_code&entity_value=eq.${encodeURIComponent(dcHash)}&limit=1`
      );
      if (dcRows && dcRows.length > 0) {
        dcScore = calculateDecayedScore(dcRows[0].current_score, dcRows[0].last_offense_at, decayWindowHours);
        if (!lastReason) lastReason = dcRows[0].last_offense_reason || '';
      }
    }

    const maxScore = Math.round(Math.max(ipScore, dcScore));
    if (maxScore >= 30) {
      warning = `⚠️ 风控提醒：检测到您的设备异常行为。如继续触发安全规则，可能会触发风控（risk_score=${maxScore}, reason="${lastReason}"）`;
    }
  } catch {}

  return new Response(JSON.stringify({
    ipScore,
    dcScore,
    lastReason,
    warning,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}


