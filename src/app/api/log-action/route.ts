import { NextResponse } from 'next/server';
import { pgInsert } from '../../../lib/pg-adapter';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { username = '游客', action_type, action_item } = body;

    const forwardedFor = req.headers.get('x-forwarded-for');
    const realIp = req.headers.get('x-real-ip');
    let ip = forwardedFor ? forwardedFor.split(',')[0].trim() : (realIp || '未知IP');

    let location = '未知定位';
    if (ip !== '未知IP' && ip !== '::1' && ip !== '127.0.0.1') {
      try {
        const locRes = await fetch(`http://ip-api.com/json/${ip}?lang=zh-CN`);
        const locData = await locRes.json();
        if (locData.status === 'success') location = `${locData.country} ${locData.regionName} ${locData.city}`.trim();
      } catch {}
    }

    const dateStr = new Date(new Date().getTime() + 8 * 3600 * 1000).toISOString().split('T')[0];
    const log_text = `${username} (${ip}: ${location}) 于 ${dateStr}, ${action_type}了文件 ${action_item}`;

    await pgInsert('bdpan_action_logs', { username, action_type, action_item, ip, location, log_text });
    return NextResponse.json({ code: 200 });
  } catch (error: any) {
    console.error('Log action error:', error);
    return NextResponse.json({ code: 500, error: error.message });
  }
}
