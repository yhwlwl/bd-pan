import { NextResponse } from 'next/server';
import { pgInsert } from '../../../lib/pg-adapter';
import { hashDeviceCode } from '../../../lib/fingerprint';
import { getRequestContext } from '../../../lib/deny-tracker';
import { verifyToken } from '../_auth';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const ctx = getRequestContext(req);
    const tokenUser = verifyToken(req.headers.get('authorization') || undefined);
    const actionType = typeof body.action_type === 'string'
      ? body.action_type.replace(/[\r\n]/g, '').slice(0, 120)
      : '未知操作';
    const actionItem = typeof body.action_item === 'string'
      ? body.action_item.replace(/[\r\n]/g, '').slice(0, 1000)
      : '';
    const sessionId = typeof body.session_id === 'string' ? body.session_id.replace(/[\r\n]/g, '').slice(0, 200) : '';
    const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint.replace(/[\r\n]/g, '').slice(0, 200) : '';
    // 账号必须来自签名 Token；绝不接受 body.username，否则任何游客都能伪造
    // 账号操作日志并污染后续 IP/设备/账号关联封禁。
    const username = tokenUser?.username || '游客';
    const ip = ctx.ip === 'unknown' ? '未知IP' : ctx.ip;
    const source = process.env.APP_SOURCE || 'pan';

    // IP 定位优先用 Vercel headers（更快），fallback ip-api.com
    let location = '未知定位';
    const vCity = req.headers.get('x-vercel-ip-city');
    const vRegion = req.headers.get('x-vercel-ip-country-region');
    const vCountry = req.headers.get('x-vercel-ip-country');
    if (vCity || vCountry) {
      location = [vCountry, vRegion, vCity].filter(Boolean).join(' ').trim() || '未知定位';
    } else if (ip !== '未知IP' && ip !== '::1' && ip !== '127.0.0.1') {
      try {
        const locRes = await fetch(`http://ip-api.com/json/${ip}?lang=zh-CN`);
        const locData = await locRes.json();
        if (locData.status === 'success') location = `${locData.country} ${locData.regionName} ${locData.city}`.trim();
      } catch {}
    }

    const dateStr = new Date(new Date().getTime() + 8 * 3600 * 1000).toISOString().split('T')[0];
    const log_text = `${username} (${ip}: ${location}) 于 ${dateStr}, ${actionType}了文件 ${actionItem}`;

    const finalDeviceCode = hashDeviceCode(ctx.deviceCode || '') || '';
    const { error: insertErr } = await pgInsert('bdpan_action_logs', { username, action_type: actionType, action_item: actionItem, ip, location, log_text, created_at: new Date().toISOString(), session_id: sessionId, fingerprint, device_code: finalDeviceCode, source });
    if (insertErr) console.error('[log-action] 写入失败:', insertErr.message);
    return NextResponse.json({ code: insertErr ? 500 : 200 });
  } catch (error: any) {
    console.error('Log action error:', error);
    return NextResponse.json({ code: 500, error: error.message });
  }
}
