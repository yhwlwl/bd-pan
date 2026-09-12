import { NextResponse } from 'next/server';
import { pgInsert } from '../../../lib/pg-adapter';
import { getRequestContext } from '../../../lib/deny-tracker';
import { verifyToken } from '../_auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const headers = req.headers;
        const ctx = getRequestContext(req);
        const tokenUser = verifyToken(headers.get('authorization') || undefined);
        const ip = ctx.ip;
        let city = 'Unknown', country = 'Unknown', region = 'Unknown';
        // 优先 Vercel headers，fallback ip-api.com
        if (headers.get('x-vercel-ip-city') || headers.get('x-vercel-ip-country')) {
          city = headers.get('x-vercel-ip-city') || 'Unknown';
          country = headers.get('x-vercel-ip-country') || 'Unknown';
          region = headers.get('x-vercel-ip-country-region') || 'Unknown';
        } else if (ip !== '127.0.0.1' && ip !== '::1') {
          try {
            const locRes = await fetch(`http://ip-api.com/json/${ip}?lang=zh-CN`);
            const locData = await locRes.json();
            if (locData.status === 'success') {
              city = locData.city; country = locData.country; region = locData.regionName;
            }
          } catch {}
        }

        await pgInsert('view_logs', {
            visit_time: new Date().toISOString(),
            // body.ip 来自浏览器，不能作为审计 IP。
            ip_address: ip,
            user_agent: typeof body.device === 'string' ? body.device.replace(/[\r\n]/g, '').slice(0, 1000) : '',
            city, region, country,
            page_source: process.env.APP_SOURCE || 'pan',
            username: tokenUser?.username || '访客',
            session_id: typeof body.session_id === 'string' ? body.session_id.replace(/[\r\n]/g, '').slice(0, 200) : '',
            blocked: body.blocked === true,
        });
        return NextResponse.json({ code: 200 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
