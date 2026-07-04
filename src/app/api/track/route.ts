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
        const city = headers.get('x-vercel-ip-city') || body.city || 'Unknown';
        const country = headers.get('x-vercel-ip-country') || body.country || 'Unknown';
        const region = headers.get('x-vercel-ip-country-region') || body.region || 'Unknown';

        await pgInsert('view_logs', {
            visit_time: new Date().toISOString(),
            ip_address: (body.ip || ip).split(',')[0].trim(),
            user_agent: body.device || '',
            city, region, country,
            page_source: body.source || 'pan',
            username: body.username || '访客',
            session_id: body.session_id || '',
            blocked: body.blocked || false,
        });
        return NextResponse.json({ code: 200 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
