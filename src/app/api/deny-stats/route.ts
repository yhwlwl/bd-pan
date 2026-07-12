/**
 * GET+POST /api/deny-stats — 管理面板风险仪表板 API
 *
 * GET: 返回 deny 事件列表 + 风险实体 + 统计数据
 * POST: 管理员操作（解封/清分/配置阈值）
 */
import { verifyToken } from '../_auth';
import { getRiskDashboard, adminUnban, adminResetScore, adminAdjustScore, adminBanEntity } from '../../../lib/deny-tracker';
import { getSettings, updateSettings } from '../../../lib/users';

export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get('authorization') || undefined;
  const user = verifyToken(authHeader);
  if (!user) {
    return new Response(JSON.stringify({ code: 401, message: '请先登录' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  if (user.role !== 'admin' && user.role !== 'manager') {
    return new Response(JSON.stringify({ code: 403, message: '权限不足' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  try {
    const dashboard = await getRiskDashboard();
    return new Response(JSON.stringify({ code: 200, ...dashboard }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ code: 500, message: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  const authHeader = request.headers.get('authorization') || undefined;
  const user = verifyToken(authHeader);
  if (!user || user.role !== 'admin') {
    return new Response(JSON.stringify({ code: 403, message: '仅管理员可操作' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  try {
    const body = await request.json();
    const { action, entity_type, entity_value } = body;

    if (action === 'unban' && entity_type && entity_value) {
      await adminUnban(entity_type, entity_value);
      return new Response(JSON.stringify({ code: 200, message: '已解封' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    if (action === 'ban_ip' && entity_type && entity_value && typeof body.ban_hours === 'number') {
      await adminBanEntity(entity_type, entity_value, body.ban_hours);
      return new Response(JSON.stringify({ code: 200, message: '已标记封禁' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    if (action === 'clear_score' && entity_type && entity_value) {
      await adminResetScore(entity_type, entity_value);
      return new Response(JSON.stringify({ code: 200, message: '已清分' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    if (action === 'adjust_score' && entity_type && entity_value && typeof body.delta === 'number') {
      await adminAdjustScore(entity_type, entity_value, body.delta);
      return new Response(JSON.stringify({ code: 200, message: `分数已调整 (${body.delta >= 0 ? '+' : ''}${body.delta})` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    if (action === 'config_thresholds') {
      const settings = await getSettings();
      const dt = (settings as any).denyTracking || {};
      const newDT = {
        ...dt,
        enabled: body.enabled !== undefined ? body.enabled : dt.enabled,
        warnThreshold: body.warn_threshold ?? dt.warnThreshold,
        deviceBanThreshold: body.device_ban_threshold ?? dt.deviceBanThreshold,
        ipBanThreshold: body.ip_ban_threshold ?? dt.ipBanThreshold,
        banDurationHours: body.ban_duration_hours ?? dt.banDurationHours,
      };
      await updateSettings({ denyTracking: newDT } as any);
      return new Response(JSON.stringify({ code: 200, message: '配置已更新' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    return new Response(JSON.stringify({ code: 400, message: '未知操作' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ code: 500, message: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}
