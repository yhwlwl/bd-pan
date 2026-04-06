import { NextResponse } from 'next/server';
import { verifyToken } from '../_auth';
import {
    canAssignFilePermissionTarget,
    canManageFilePermissions,
    filterRuleUsersByActor,
    getSettings,
    getUsers,
    updateSettings,
} from '../../../lib/users';
import type { FilePermissionRule } from '../../../lib/users';

async function authorize(request: Request) {
    const authHeader = request.headers.get('authorization') || undefined;
    const user = verifyToken(authHeader);
    if (!user) return null;
    const allowed = await canManageFilePermissions(user.username, user.role);
    if (!allowed) return null;
    return user;
}

export async function GET(request: Request) {
    const user = await authorize(request);
    if (!user) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
    }

    const settings = await getSettings();
    const allUsers = (await getUsers()).map((item) => ({ username: item.username, role: item.role }));
    const manageableUsers = allUsers.filter((item) => canAssignFilePermissionTarget(user.role, item.role, item.username));
    const visibleRules = (settings.filePermissionRules || [])
        .map((rule) => filterRuleUsersByActor(rule, user.role, allUsers))
        .filter(Boolean);

    return NextResponse.json({
        users: manageableUsers,
        rules: visibleRules,
    });
}

export async function POST(request: Request) {
    const user = await authorize(request);
    if (!user) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const submittedRules = Array.isArray(body?.rules) ? (body.rules as FilePermissionRule[]) : [];
        const settings = await getSettings();
        const allUsers = (await getUsers()).map((item) => ({ username: item.username, role: item.role }));
        const manageableUsernames = new Set(
            allUsers
                .filter((item) => canAssignFilePermissionTarget(user.role, item.role, item.username))
                .map((item) => item.username),
        );

        const sanitizedRules = submittedRules
            .map((rule) => filterRuleUsersByActor(rule, user.role, allUsers))
            .filter(Boolean) as FilePermissionRule[];

        const preservedRules = (settings.filePermissionRules || []).filter((rule) => {
            const touchesManageableUser = rule.users.some((username) => manageableUsernames.has(username));
            return !touchesManageableUser;
        });

        const mergedRules = [...preservedRules, ...sanitizedRules];
        await updateSettings({ filePermissionRules: mergedRules });

        return NextResponse.json({ ok: true, rules: sanitizedRules });
    } catch {
        return NextResponse.json({ error: '接口异常' }, { status: 500 });
    }
}
