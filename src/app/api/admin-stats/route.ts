import { NextResponse } from 'next/server';
import { verifyToken } from '../_auth';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export async function GET(request: Request) {
    try {
        const authHeader = request.headers.get('authorization') || undefined;
        const user = verifyToken(authHeader);
        if (!user || user.role !== 'admin') {
            return NextResponse.json({ code: 401, message: '无权限访问统计信息' }, { status: 401 });
        }

        if (!supabase) {
            return NextResponse.json({ code: 500, message: '系统未配置数据库' }, { status: 500 });
        }

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const cutoffString = sevenDaysAgo.toISOString();

        const { data: logs, error } = await supabase
            .from('bdpan_action_logs')
            .select('action_type, created_at, username, ip, action_item, location')
            .gte('created_at', cutoffString)
            .order('created_at', { ascending: false });

        if (error) throw error;

        let todayDownloads = 0;
        let totalDownloads = 0;
        
        const channelStats: Record<string, { today: number, total: number, logs: any[] }> = { 
            ecs: { today: 0, total: 0, logs: [] }, 
            cf: { today: 0, total: 0, logs: [] }, 
            raw: { today: 0, total: 0, logs: [] }, 
            vercel: { today: 0, total: 0, logs: [] }, 
            direct302: { today: 0, total: 0, logs: [] }, 
            other: { today: 0, total: 0, logs: [] } 
        };
        const ipStats: Record<string, { count: number, lastActive: string, lastUser: string, location: string }> = {};
        const highRiskLogs: any[] = [];

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        
        const riskTypes = ['上传', '删除', '重命名', '建立文件夹'];

        (logs || []).forEach(log => {
            // Stats
            if (log.ip) {
                if (!ipStats[log.ip]) ipStats[log.ip] = { count: 0, lastActive: log.created_at, lastUser: log.username, location: log.location || '未知定位' };
                ipStats[log.ip].count++;
            }

            const isDownload = log.action_type.startsWith('下载 -');
            const isToday = new Date(log.created_at) >= todayStart;

            if (isDownload) {
                totalDownloads++;
                if (isToday) todayDownloads++;
                
                let key = 'other';
                if (log.action_type.includes('阿里云服务器极速下载')) key = 'ecs';
                else if (log.action_type.includes('Cloudflare 边缘加速')) key = 'cf';
                else if (log.action_type.includes('复制直链')) key = 'raw';
                else if (log.action_type.includes('vercel服务器中转下载')) key = 'vercel';
                else if (log.action_type.includes('302 直链跳转')) key = 'direct302';
                
                channelStats[key].total++;
                if (isToday) channelStats[key].today++;
                
                channelStats[key].logs.push({
                    username: log.username,
                    ip: log.ip,
                    location: log.location || '未知定位',
                    time: log.created_at,
                    item: log.action_item
                });
            }

            // High risk events
            if (riskTypes.some(rt => log.action_type.includes(rt))) {
                highRiskLogs.push({
                    username: log.username,
                    action: log.action_type,
                    item: log.action_item,
                    time: log.created_at,
                    ip: log.ip,
                    location: log.location || '未知定位',
                });
            }
        });

        // Sort IP stats by count descending
        const topIps = Object.entries(ipStats)
            .map(([ip, data]) => ({ ip, ...data }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 30); // Top 30

        return NextResponse.json({
            code: 200,
            data: {
                todayDownloads,
                totalDownloads,
                channelStats,
                highRiskLogs,
                topIps
            }
        });

    } catch (e: any) {
        console.error('[stats] error:', e);
        return NextResponse.json({ code: 500, message: e.message }, { status: 500 });
    }
}
