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
            .select('action_type, created_at, username, ip, action_item')
            .gte('created_at', cutoffString)
            .order('created_at', { ascending: false });

        if (error) throw error;

        let todayDownloads = 0;
        let totalDownloads = 0;
        
        const channelStats = { ecs: 0, cf: 0, raw: 0, vercel: 0, direct302: 0, other: 0 };
        const ipStats: Record<string, { count: number, lastActive: string, lastUser: string }> = {};
        const highRiskLogs: any[] = [];

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        
        const riskTypes = ['上传', '删除', '重命名', '建立文件夹'];

        (logs || []).forEach(log => {
            // Stats
            if (log.ip) {
                if (!ipStats[log.ip]) ipStats[log.ip] = { count: 0, lastActive: log.created_at, lastUser: log.username };
                ipStats[log.ip].count++;
            }

            const isDownload = log.action_type.startsWith('下载 -');
            if (isDownload) {
                totalDownloads++;
                if (new Date(log.created_at) >= todayStart) todayDownloads++;
                
                if (log.action_type.includes('阿里云服务器极速下载')) channelStats.ecs++;
                else if (log.action_type.includes('Cloudflare 边缘加速')) channelStats.cf++;
                else if (log.action_type.includes('复制直链')) channelStats.raw++;
                else if (log.action_type.includes('vercel服务器中转下载')) channelStats.vercel++;
                else if (log.action_type.includes('302 直链跳转')) channelStats.direct302++;
                else channelStats.other++;
            }

            // High risk events
            if (riskTypes.some(rt => log.action_type.includes(rt))) {
                if (highRiskLogs.length < 50) { // Keep top 50 recent
                    highRiskLogs.push({
                        username: log.username,
                        action: log.action_type,
                        item: log.action_item,
                        time: log.created_at,
                        ip: log.ip
                    });
                }
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
