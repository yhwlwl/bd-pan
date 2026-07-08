import { NextResponse } from 'next/server';
import { pgInsert } from '../../../lib/pg-adapter';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { username = '游客', action_type, action_item, session_id, fingerprint, device_code = '' } = body;

    const forwardedFor = req.headers.get('x-forwarded-for');
    const realIp = req.headers.get('x-real-ip');
    let ip = forwardedFor ? forwardedFor.split(',')[0].trim() : (realIp || '未知IP');
    // 去除 IPv4-mapped IPv6 前缀（::ffff:x.x.x.x → x.x.x.x）
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);

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
    const log_text = `${username} (${ip}: ${location}) 于 ${dateStr}, ${action_type}了文件 ${action_item}`;

    const { error: insertErr } = await pgInsert('bdpan_action_logs', { username, action_type, action_item, ip, location, log_text, created_at: new Date().toISOString(), session_id: session_id || '', fingerprint: fingerprint || '', device_code: device_code || '' });
    if (insertErr) console.error('[log-action] 写入失败:', insertErr.message);
    return NextResponse.json({ code: insertErr ? 500 : 200 });
  } catch (error: any) {
    console.error('Log action error:', error);
    return NextResponse.json({ code: 500, error: error.message });
  }
}
