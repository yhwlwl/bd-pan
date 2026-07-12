import { NextResponse } from 'next/server';
import { verifyToken } from '../_auth';
import { pgFetch, pgInsert } from '../../../lib/pg-adapter';

const PREFIX = process.env.DB_TABLE_PREFIX || '';

const TABLES = [
  { name: `${PREFIX}bdpan_users`, label: 'users' },
  { name: `${PREFIX}bdpan_settings`, label: 'settings' },
  { name: 'bdpan_action_logs', label: 'action_logs' },
  { name: 'bdpan_deny_events', label: 'deny_events' },
  { name: 'bdpan_risk_scores', label: 'risk_scores' },
  { name: 'view_logs', label: 'view_logs' },
];

export async function POST(request: Request) {
  const user = verifyToken(request.headers.get('authorization') || undefined);
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: '仅管理员可操作' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const label = body.label || '手动备份';

    // 读取所有表
    const data: Record<string, any[]> = {};
    for (const table of TABLES) {
      try {
        const res = await pgFetch<any>('GET', `${table.name}?select=*&limit=50000`);
        data[table.label] = (res.data || []);
      } catch { data[table.label] = []; }
    }

    // 存入备份表
    const backupRow = {
      created_at: new Date().toISOString(),
      label,
      data: data,
    };

    const { error } = await pgInsert(`${PREFIX}bdpan_backups`, backupRow);
    if (error) {
      return NextResponse.json({ error: '备份写入失败: ' + error.message }, { status: 500 });
    }

    // 清理旧备份（保留最近 10 条）
    try {
      const { data: allBackups } = await pgFetch<{ id: number }>('GET', `${PREFIX}bdpan_backups?select=id&order=created_at.desc&limit=100`);
      if (allBackups && allBackups.length > 10) {
        const toDelete = allBackups.slice(10);
        for (const b of toDelete) {
          await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/${PREFIX}bdpan_backups?id=eq.${b.id}`, {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              ...(process.env.PG_DB_TOKEN ? { 'X-DB-Token': process.env.PG_DB_TOKEN } : {}),
            },
          }).catch(() => {});
        }
      }
    } catch {}

    const totalRows = Object.values(data).reduce((sum, arr) => sum + arr.length, 0);
    return NextResponse.json({
      code: 200,
      message: `备份完成: ${totalRows} 条记录`,
      tables: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const user = verifyToken(request.headers.get('authorization') || undefined);
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: '仅管理员可操作' }, { status: 403 });
  }

  try {
    const { data: backups } = await pgFetch<any>('GET', `${PREFIX}bdpan_backups?select=id,created_at,label&order=created_at.desc&limit=20`);
    return NextResponse.json({ code: 200, backups: backups || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
