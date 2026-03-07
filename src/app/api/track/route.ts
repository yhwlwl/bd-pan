import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export async function POST(req: Request) {
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase 未配置' }, { status: 500 });
    }

    try {
        const body = await req.json();

        const headers = req.headers;
        const ip = headers.get('x-forwarded-for') || headers.get('x-real-ip') || '127.0.0.1';
        const city = headers.get('x-vercel-ip-city') || body.city || 'Unknown';
        const country = headers.get('x-vercel-ip-country') || body.country || 'Unknown';
        const region = headers.get('x-vercel-ip-country-region') || body.region || 'Unknown';

        await supabase.from('view_logs').insert([
            {
                visit_time: body.time || new Date().toISOString(),
                ip_address: (body.ip || ip).split(',')[0].trim(),
                user_agent: body.device || '',
                city: city,
                region: region,
                country: country,
                page_source: body.source || 'pan',
            }
        ]);

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
