import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export async function POST(req: Request) {
  if (!supabase) {
    return NextResponse.json({ code: 500, message: 'Supabase 未配置' });
  }

  try {
    const body = await req.json();
    const { username = '游客', action_type, action_item } = body;
    
    // 提取 IP
    const forwardedFor = req.headers.get('x-forwarded-for');
    const realIp = req.headers.get('x-real-ip');
    let ip = forwardedFor ? forwardedFor.split(',')[0].trim() : (realIp || '未知IP');

    // 尝试获取地理位置
    let location = '未知定位';
    if (ip !== '未知IP' && ip !== '::1' && ip !== '127.0.0.1') {
      try {
        const locRes = await fetch(`http://ip-api.com/json/${ip}?lang=zh-CN`);
        const locData = await locRes.json();
        if (locData.status === 'success') {
          location = `${locData.country} ${locData.regionName} ${locData.city}`.trim();
        }
      } catch (e) {
        console.warn('获取定位异常:', e);
      }
    }

    const now = new Date();
    // 格式化为北京时间日期
    const dateStr = new Date(now.getTime() + 8 * 3600 * 1000).toISOString().split('T')[0];
    
    const log_text = `${username} (${ip}: ${location}) 于 ${dateStr}, ${action_type}了文件 ${action_item}`;

    const { error } = await supabase.from('bdpan_action_logs').insert([
      {
        username,
        action_type,
        action_item,
        ip,
        location,
        log_text
      }
    ]);

    if (error) throw error;

    return NextResponse.json({ code: 200, message: '日志记录成功' });
  } catch (error: any) {
    console.error('Log action error:', error);
    return NextResponse.json({ code: 500, message: '日志记录失败', error: error.message });
  }
}
