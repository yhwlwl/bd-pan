import { NextResponse } from 'next/server';
import { pgInsert } from '../../../lib/pg-adapter';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const headers = req.headers;
        const ipRaw = headers.get('x-forwarded-for') || headers.get('x-real-ip') || '127.0.0.1';
        const ip = ipRaw.startsWith('::ffff:') ? ipRaw.slice(7) : ipRaw;
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
            ip_address: (body.ip || ip).split(',')[0].trim(),
            user_agent: body.device || '',
            city, region, country,
            page_source: body.source || process.env.APP_SOURCE || 'weilaimeng',
            username: body.username || '访客',
            session_id: body.session_id || '',
            blocked: body.blocked || false,
        });
        return NextResponse.json({ code: 200 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
