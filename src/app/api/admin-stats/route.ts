import { NextResponse } from 'next/server';
import { verifyToken } from '../_auth';
import { getUserPermissions } from '../../../lib/users';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export async function GET(request: Request) {
    try {
        const authHeader = request.headers.get('authorization') || undefined;
        const user = verifyToken(authHeader);
        if (!user) {
            return NextResponse.json({ code: 401, message: '请先登录' }, { status: 401 });
        }
        if (user.role !== 'admin') {
            const perms = await getUserPermissions(user.username, user.role);
            const canViewLogs = perms.viewStats || perms.viewActionLogs || perms.viewIpStats || perms.viewDownloadLogs;
            if (!canViewLogs) {
                return NextResponse.json({ code: 401, message: '无权限访问统计信息' }, { status: 401 });
            }
        }

        if (!supabase) {
            return NextResponse.json({ code: 500, message: '系统未配置数据库' }, { status: 500 });
        }

        const { data: logs, error } = await supabase
            .from('bdpan_action_logs')
            .select('action_type, created_at, username, ip, action_item, location')
            .order('created_at', { ascending: false });

        if (error) throw error;

        const { data: viewLogs, error: viewLogsError, count } = await supabase
            .from('view_logs')
            .select('visit_time, ip_address, user_agent, city, region, country, page_source, username', { count: 'exact' })
            .eq('page_source', 'pan')
            .order('visit_time', { ascending: false });

        if (viewLogsError) {
            console.error('[stats] view_logs error:', viewLogsError);
            throw viewLogsError;
        }

        let totalPanVisits = count || 0;

        let past24hDownloads = 0;
        let totalDownloads = 0;
        
        const channelStats: Record<string, { past24h: number, total: number, logs: any[] }> = { 
            ecs: { past24h: 0, total: 0, logs: [] }, 
            cf: { past24h: 0, total: 0, logs: [] }, 
            raw: { past24h: 0, total: 0, logs: [] }, 
            vercel: { past24h: 0, total: 0, logs: [] }, 
            direct302: { past24h: 0, total: 0, logs: [] }, 
            other: { past24h: 0, total: 0, logs: [] } 
        };
        const ipStats: Record<string, { count: number, lastActive: string, lastUser: string, location: string }> = {};
        const recentActions: any[] = [];
        const allDownloadLogs: any[] = [];

        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        (logs || []).forEach(log => {
            const isDownload = log.action_type.startsWith('下载 -') || log.action_type.startsWith('下载');
            const isPast24h = new Date(log.created_at) >= twentyFourHoursAgo;

            if (isDownload) {
                totalDownloads++;
                if (isPast24h) past24hDownloads++;

                let key = 'other';
                if (log.action_type.includes('阿里云服务器极速下载')) key = 'ecs';
                else if (log.action_type.includes('Cloudflare 边缘加速')) key = 'cf';
                else if (log.action_type.includes('复制直链')) key = 'raw';
                else if (log.action_type.includes('vercel服务器中转下载')) key = 'vercel';
                else if (log.action_type.includes('302 直链跳转')) key = 'direct302';

                channelStats[key].total++;
                if (isPast24h) channelStats[key].past24h++;

                const logObj = {
                    username: log.username,
                    ip: log.ip,
                    location: log.location || '未知定位',
                    time: log.created_at,
                    item: log.action_item
                };
                channelStats[key].logs.push(logObj);
                allDownloadLogs.push({ ...logObj, channel: key });
            }

            // 非 admin 看不到 admin 的操作日志
            if (user.role !== 'admin' && log.username === 'admin') return;

            // 所有操作都收集（不再过滤）
            recentActions.push({
                username: log.username,
                action: log.action_type,
                item: log.action_item,
                time: log.created_at,
                ip: log.ip,
                location: log.location || '未知定位',
            });
        });

        (viewLogs || []).forEach(log => {
            const ip = log.ip_address;
            if (!ip) return;
            const location = [log.country, log.region, log.city].filter(Boolean).join(' ') || '未知定位';
            if (!ipStats[ip]) ipStats[ip] = { count: 0, lastActive: log.visit_time, lastUser: log.username || '访客', location };
            ipStats[ip].count++;
            if (new Date(log.visit_time) > new Date(ipStats[ip].lastActive)) {
                ipStats[ip].lastActive = log.visit_time;
                ipStats[ip].lastUser = log.username || '访客';
                ipStats[ip].location = location;
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
                totalPanVisits,
                past24hDownloads,
                totalDownloads,
                channelStats,
                recentActions,
                topIps,
                allDownloadLogs,
                viewLogs: viewLogs || []
            }
        });

    } catch (e: any) {
        console.error('[stats] error:', e);
        return NextResponse.json({ code: 500, message: e.message }, { status: 500 });
    }
}
