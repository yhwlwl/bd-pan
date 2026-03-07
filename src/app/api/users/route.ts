import { NextResponse } from 'next/server';
import { requireRole } from '../_auth';
import { getUsers, addUser, removeUser, updateUserRole, getSettings, updateSettings, updateAdminPassword } from '@/lib/users';
import type { Role, UserPermissions } from '@/lib/users';

// GET: 获取用户列表和全局设置（仅 admin）
export async function GET(request: Request) {
    const auth = requireRole(request.headers.get('authorization') || undefined, 'admin');
    if (!auth) {
        return NextResponse.json({ error: '需要管理员权限' }, { status: 401 });
    }

    return NextResponse.json({
        users: await getUsers(),
        settings: await getSettings(),
    });
}

// POST: 管理操作（仅 admin）
export async function POST(request: Request) {
    const auth = requireRole(request.headers.get('authorization') || undefined, 'admin');
    if (!auth) {
        return NextResponse.json({ error: '需要管理员权限' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { action } = body;

        switch (action) {
            case 'add': {
                const { username, password, role } = body as { username: string; password: string; role: Role };
                const result = await addUser(username, password, role);
                if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
                return NextResponse.json({ ok: true, users: await getUsers() });
            }

            case 'remove': {
                const { username } = body as { username: string };
                const result = await removeUser(username);
                if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
                return NextResponse.json({ ok: true, users: await getUsers() });
            }

            case 'updateRole': {
                const { username, role } = body as { username: string; role: Role };
                const result = await updateUserRole(username, role);
                if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
                return NextResponse.json({ ok: true, users: await getUsers() });
            }

            case 'updateSettings': {
                const { settings } = body as { settings: { allowGuestDownload?: boolean } };
                await updateSettings(settings);
                return NextResponse.json({ ok: true, settings: await getSettings(), users: await getUsers() });
            }

            case 'changeAdminPassword': {
                const { password } = body as { password?: string };
                if (!password) return NextResponse.json({ error: '新密码不能留空' }, { status: 400 });
                const result = await updateAdminPassword(password);
                if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
                return NextResponse.json({ ok: true });
            }

            case 'updatePermissions': {
                const { username, permissions } = body as { username: string; permissions: UserPermissions };
                const currentSettings = await getSettings();
                const globalPerms = currentSettings.permissions || {};
                globalPerms[username] = permissions;
                await updateSettings({ permissions: globalPerms });
                return NextResponse.json({ ok: true, users: await getUsers(), settings: await getSettings() });
            }

            default:
                return NextResponse.json({ error: `未知操作: ${action}` }, { status: 400 });
        }
    } catch {
        return NextResponse.json({ error: '接口异常' }, { status: 500 });
    }
}
